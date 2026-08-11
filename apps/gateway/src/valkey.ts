// Valkey-backed health and cooldowns. The multi-replica half of the two in-memory stores.
//
// WHAT MAKES THIS MORE THAN A SWAP. Both in-memory stores are correct because JavaScript is
// single-threaded: a read-modify-write cannot interleave. Across a network it can, and two
// specific interleavings cost real money:
//
//   1. Two requests both read a cooldown that has just expired, both see `probeTaken: false`,
//      and both attempt a provider that is still blocking. The half-open design exists to
//      make that impossible, and a GET followed by a SET reintroduces it exactly.
//   2. Two replicas both fold an outcome into the same health record and one overwrites the
//      other. The lost observation is harmless; the lost STATE TRANSITION is not — a demote
//      can be silently undone by a concurrent write of a stale `healthy`.
//
// Health handles this with a generic compare-and-set: read, fold with the SAME `observe`
// the tests and the simulation exercise, write back only if nobody else changed it. No Lua
// knows anything about health.
//
// THE COOLDOWN CLAIM IS THE ONE EXCEPTION, and it is worth naming rather than glossing.
// Deciding and claiming must be one server-side step, and Valkey cannot call a JavaScript
// function, so `claimProbe`'s logic genuinely exists twice: once in
// `packages/shared/src/cooldown.ts` and once in `CLAIM` below. That is a second thing to
// keep right, so it is pinned by a DIFFERENTIAL TEST — `valkey.e2e.test.ts` runs a matrix of
// entry states through both and asserts they agree. Duplication that a test holds together
// is a cost; duplication nothing checks is a bug waiting for a Tuesday.
//
// The cost of that choice is one round trip per mutation, which is why `record` and `arm`
// are still fire-and-forget: nothing awaits them, and a failure is logged rather than raised.

import type { Outcome } from '@proxlane/adapters';
import {
	arm,
	COOLDOWN,
	type CooldownDecision,
	type CooldownEntry,
	decide,
	type HealthState,
	initial,
	observe,
	observeProbe,
} from '@proxlane/shared';
import type { Redis } from 'ioredis';
import type { CooldownStore } from './cooldown-store.js';
import type { HealthStore } from './health-store.js';

/**
 * Read, transform in JS, write back only if nobody else changed it.
 *
 * `WATCH`/`MULTI` would do this too, but a Lua script is one round trip instead of three and
 * cannot be left holding a watch when a client dies mid-transaction. The version field is an
 * explicit counter rather than a hash of the value: a hash makes two identical states look
 * like a conflict, and health writes an identical state constantly.
 */
const CAS = `
local current = redis.call('GET', KEYS[1])
-- A missing key reads as Lua false, never as the empty string, so comparing it directly
-- against an empty ARGV made the FIRST write to any key fail its own compare-and-set. Every
-- record silently failed to appear, retried three times, and was dropped as "contended".
if current == false then current = '' end
if current ~= ARGV[1] then return 0 end
if ARGV[3] == '0' then
  redis.call('SET', KEYS[1], ARGV[2])
else
  redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
end
return 1
`;

/** How many times a compare-and-set retries before giving up and dropping the update. */
const CAS_ATTEMPTS = 3;

export interface ValkeyStoreOptions {
	readonly redis: Redis;
	/** Called when a best-effort write fails. Defaults to writing one line to stderr. */
	readonly onError?: (where: string, err: unknown) => void;
}

function defaultOnError(where: string, err: unknown): void {
	process.stderr.write(
		`  valkey ${where} failed: ${err instanceof Error ? err.message : String(err)}\n`,
	);
}

/**
 * Health TTL.
 *
 * Long, because a baseline is expensive to rebuild — MIN_SAMPLES observations during which a
 * provider cannot be demoted. But not infinite: a provider removed from the config should not
 * leave a record forever, and a baseline measured a fortnight ago describes a provider that
 * has since been through changes nobody recorded.
 */
const HEALTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long observations are buffered before one write applies them all.
 *
 * BUFFERED, not written per attempt, and this was a correction rather than an optimisation.
 * The first version issued one compare-and-set per observation. Under 400 concurrent writes
 * to a single provider's key — which is one busy gateway, not a fleet — most of them lost
 * the race and were dropped, so the statistic barely accumulated at exactly the traffic level
 * where it matters most. The e2e concurrency test failed and it was right to.
 *
 * Buffering fixes both that and the hot-path cost: a batch of 200 observations is one round
 * trip rather than 200, and `observe` is a pure fold, so applying them in order gives exactly
 * the state a per-observation write would have reached.
 *
 * The cost is up to this many milliseconds of observations on an unclean shutdown. For a
 * statistic that needs hundreds of samples that is not a meaningful loss, and `close()`
 * flushes on a clean one.
 */
const FLUSH_INTERVAL_MS = 250;

/** Flush early once a provider has this many pending observations, so bursts stay bounded. */
const FLUSH_AT = 200;

export class ValkeyHealthStore implements HealthStore {
	readonly #redis: Redis;
	readonly #onError: (where: string, err: unknown) => void;
	/** Observations not yet written, per provider, in arrival order. */
	readonly #pending = new Map<string, { outcome: Outcome; now: number; probe?: boolean }[]>();
	/**
	 * The in-flight flush per key, so flushes SERIALISE instead of being skipped.
	 *
	 * A boolean "already flushing" flag was the first attempt and it silently dropped work:
	 * `flush()` returned immediately for a key mid-write, leaving that key's newer buffer
	 * unwritten and making an explicit flush a no-op under any concurrency. A promise chain
	 * queues behind the write in progress instead, so `await flush()` means what it says.
	 */
	readonly #chains = new Map<string, Promise<void>>();
	readonly #timer: NodeJS.Timeout | undefined;

	constructor(opts: ValkeyStoreOptions & { readonly autoFlush?: boolean }) {
		this.#redis = opts.redis;
		this.#onError = opts.onError ?? defaultOnError;
		if (opts.autoFlush !== false) {
			// `unref` so an idle timer never holds the process open, which is how a graceful
			// shutdown becomes a hang.
			this.#timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
			this.#timer.unref();
		}
	}

	async snapshot(
		ids: readonly string[],
		now: number,
	): Promise<ReadonlyMap<string, HealthState>> {
		if (ids.length === 0) return new Map();
		// One MGET rather than N GETs. This is on the hot path for every request, and N round
		// trips to decide an ordering is how a routing optimisation becomes a latency problem.
		const raw = await this.#redis.mget(ids.map(healthKey));
		return new Map(
			ids.map((id, i) => {
				const stored = parseHealth(raw[i] ?? null) ?? initial(now);
				// Apply anything still buffered, so a read never goes backwards relative to what
				// this process has already been told. Without it, a request that just recorded a
				// failure could route on a snapshot that predates it.
				return [id, this.#applyPending(id, stored)] as const;
			}),
		);
	}

	record(providerId: string, outcome: Outcome, now: number): void {
		this.#enqueue(providerId, { outcome, now });
	}

	recordProbe(providerId: string, ok: boolean, now: number): void {
		this.#enqueue(providerId, { outcome: 'OK', now, probe: ok });
	}

	async all(now: number): Promise<ReadonlyMap<string, HealthState>> {
		// SCAN, never KEYS: KEYS blocks the server for the length of the keyspace, and this is
		// reachable from an HTTP endpoint. A diagnostic that can stall the gateway it is
		// diagnosing is worse than no diagnostic.
		const out = new Map<string, HealthState>();
		let cursor = '0';
		do {
			const [next, keys] = await this.#redis.scan(cursor, 'MATCH', 'hs:*', 'COUNT', 100);
			cursor = next;
			if (keys.length > 0) {
				const values = await this.#redis.mget(keys);
				keys.forEach((k, i) => {
					const parsed = parseHealth(values[i] ?? null);
					const id = k.slice('hs:'.length);
					if (parsed !== null) out.set(id, this.#applyPending(id, parsed));
				});
			}
		} while (cursor !== '0');
		for (const id of this.#pending.keys()) {
			if (!out.has(id)) out.set(id, this.#applyPending(id, initial(now)));
		}
		return out;
	}

	/**
	 * Write every buffered observation, and wait for writes already in flight.
	 *
	 * Two rounds, because a batch that loses its compare-and-set is requeued rather than
	 * dropped: the first round drains what is pending, the second picks up anything a
	 * concurrent writer forced back into the queue.
	 */
	async flush(): Promise<void> {
		for (let round = 0; round < 2; round++) {
			const ids = new Set([...this.#pending.keys(), ...this.#chains.keys()]);
			if (ids.size === 0) return;
			await Promise.all([...ids].map((id) => this.#flushOne(id)));
		}
	}

	/** Flush and stop the timer. */
	async close(): Promise<void> {
		if (this.#timer !== undefined) clearInterval(this.#timer);
		await this.flush();
	}

	#enqueue(providerId: string, obs: { outcome: Outcome; now: number; probe?: boolean }): void {
		const q = this.#pending.get(providerId);
		if (q === undefined) this.#pending.set(providerId, [obs]);
		else q.push(obs);
		if ((this.#pending.get(providerId)?.length ?? 0) >= FLUSH_AT)
			void this.#flushOne(providerId);
	}

	/** Fold buffered observations onto a stored state. The same pure functions, in order. */
	#applyPending(providerId: string, from: HealthState): HealthState {
		let st = from;
		for (const o of this.#pending.get(providerId) ?? []) {
			st =
				o.probe === undefined
					? observe(st, o.outcome, o.now)
					: observeProbe(st, o.probe, o.now);
		}
		return st;
	}

	/** Queue a flush behind whatever is already writing this key. */
	#flushOne(providerId: string): Promise<void> {
		const prior = this.#chains.get(providerId) ?? Promise.resolve();
		const next = prior.then(() => this.#write(providerId));
		this.#chains.set(providerId, next);
		void next.finally(() => {
			// Only clear if nothing queued behind this one, or a later flush would lose its
			// place in the chain and run concurrently with an earlier write.
			if (this.#chains.get(providerId) === next) this.#chains.delete(providerId);
		});
		return next;
	}

	async #write(providerId: string): Promise<void> {
		const batch = this.#pending.get(providerId);
		if (batch === undefined || batch.length === 0) return;
		// Detach the batch before the first await: anything recorded during the write belongs
		// to the next flush, not this one, or it would be applied twice.
		this.#pending.delete(providerId);
		const key = healthKey(providerId);
		try {
			for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
				const current = await this.#redis.get(key);
				// A provider with no record enters `healthy` at its FIRST OBSERVATION, not at
				// process start — `enteredAt` drives DWELL_RECOVER_MS, and dating it from boot
				// would let a provider satisfy the dwell before it had been seen at all.
				let st = parseHealth(current) ?? initial(batch[0]?.now ?? 0);
				for (const o of batch) {
					st =
						o.probe === undefined
							? observe(st, o.outcome, o.now)
							: observeProbe(st, o.probe, o.now);
				}
				const ok = await this.#redis.eval(
					CAS,
					1,
					key,
					current ?? '',
					JSON.stringify(st),
					String(HEALTH_TTL_MS),
				);
				if (ok === 1) return;
			}
			// Contended past the retry budget. Put the batch back rather than dropping it: it
			// is a whole flush interval of observations, not one, and the next flush re-reads
			// and re-folds it onto whatever the winner wrote.
			const q = this.#pending.get(providerId);
			this.#pending.set(providerId, q === undefined ? batch : [...batch, ...q]);
			this.#onError(`health ${key}`, new Error('contended; batch requeued'));
		} catch (err) {
			// Put the batch back on a transport failure too. Dropping it here would lose a whole
			// flush interval to one blip, which is the failure mode buffering exists to avoid.
			const q = this.#pending.get(providerId);
			this.#pending.set(providerId, q === undefined ? batch : [...batch, ...q]);
			this.#onError(`health ${key}`, err);
		}
	}
}

/**
 * `claim` in one atomic step.
 *
 * Returns 1 when this caller took the probe. The read, the check and the write happen inside
 * Valkey, so two concurrent gateways cannot both succeed — which is the entire point, and the
 * thing a GET-then-SET silently fails to provide.
 */
const CLAIM = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 1 end
local e = cjson.decode(raw)
if tonumber(ARGV[1]) < e.untilMs then return 0 end
if e.probeTaken then return 0 end
e.probeTaken = true
local ttl = redis.call('PTTL', KEYS[1])
if ttl and ttl > 0 then
  redis.call('SET', KEYS[1], cjson.encode(e), 'PX', ttl)
else
  redis.call('SET', KEYS[1], cjson.encode(e))
end
return 1
`;

/**
 * Hand the probe slot back without touching the expiry or the backoff exponent.
 *
 * A no-op when the record is gone or the slot was never taken, so a late release racing a
 * concurrent `arm` cannot resurrect a claim against the new cooldown.
 */
const RELEASE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, e = pcall(cjson.decode, raw)
if not ok or type(e) ~= 'table' or not e.probeTaken then return 0 end
e.probeTaken = false
local ttl = redis.call('PTTL', KEYS[1])
if ttl and ttl > 0 then
  redis.call('SET', KEYS[1], cjson.encode(e), 'PX', ttl)
else
  redis.call('SET', KEYS[1], cjson.encode(e))
end
return 1
`;

/**
 * How long a cooldown record outlives the cooldown itself.
 *
 * Not zero, because `consecutive` is what makes backoff exponential: expiring the record the
 * instant the cooldown lifts would reset the exponent every time and turn exponential backoff
 * into a constant 30 seconds. The grace matches the in-memory sweep, so both implementations
 * forget at the same rate — a provider not blocked for an hour is not mid-incident.
 */
const COOLDOWN_GRACE_MS = 60 * 60 * 1000;

export class ValkeyCooldownStore implements CooldownStore {
	readonly #redis: Redis;
	readonly #onError: (where: string, err: unknown) => void;
	readonly #rng: () => number;

	constructor(opts: ValkeyStoreOptions & { readonly rng?: () => number }) {
		this.#redis = opts.redis;
		this.#onError = opts.onError ?? defaultOnError;
		this.#rng = opts.rng ?? Math.random;
	}

	async check(
		keys: readonly string[],
		now: number,
	): Promise<ReadonlyMap<string, CooldownDecision>> {
		if (keys.length === 0) return new Map();
		const raw = await this.#redis.mget([...keys]);
		return new Map(
			keys.map((k, i) => [k, decide(parseCooldown(raw[i] ?? null) ?? undefined, now)] as const),
		);
	}

	async claim(key: string, now: number): Promise<boolean> {
		const res = await this.#redis.eval(CLAIM, 1, key, String(now));
		return res === 1;
	}

	arm(key: string, now: number): void {
		void (async () => {
			for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
				try {
					const current = await this.#redis.get(key);
					const entry: CooldownEntry = arm(parseCooldown(current) ?? undefined, now, this.#rng);
					const ttl = Math.max(1, entry.untilMs - now + COOLDOWN_GRACE_MS);
					const ok = await this.#redis.eval(
						CAS,
						1,
						key,
						current ?? '',
						JSON.stringify(entry),
						String(ttl),
					);
					if (ok === 1) return;
				} catch (err) {
					this.#onError(`cooldown arm ${key}`, err);
					return;
				}
			}
			// Losing this race means somebody else armed the same key at the same instant, so
			// the cooldown exists either way. Unlike a dropped health observation this one is
			// genuinely harmless, and saying so beats a silent return.
			this.#onError(`cooldown arm ${key}`, new Error('contended; another writer armed it'));
		})();
	}

	clear(key: string): void {
		this.#redis.del(key).catch((err: unknown) => this.#onError(`cooldown clear ${key}`, err));
	}

	release(key: string): void {
		// Atomic, and TTL-preserving, for the same reasons CLAIM is: two gateways settling
		// probes on the same key must not clobber each other's expiry.
		this.#redis
			.eval(RELEASE, 1, key)
			.catch((err: unknown) => this.#onError(`cooldown release ${key}`, err));
	}
}

const healthKey = (providerId: string) => `hs:${providerId}`;

/**
 * Parse a stored record, treating anything unreadable as absent.
 *
 * A record written by an older version, or truncated, must not throw inside a routing
 * decision. Absent means "no opinion", which for health is `healthy` and for a cooldown is
 * `open` — both the fail-open direction `integrations.md` section 3 requires.
 */
function parseHealth(raw: string | null): HealthState | null {
	if (raw === null || raw === '') return null;
	try {
		const v = JSON.parse(raw) as Partial<HealthState>;
		if (typeof v.s !== 'number' || typeof v.enteredAt !== 'number') return null;
		if (v.state !== 'healthy' && v.state !== 'degraded' && v.state !== 'demoted') return null;
		return v as HealthState;
	} catch {
		return null;
	}
}

function parseCooldown(raw: string | null): CooldownEntry | null {
	if (raw === null || raw === '') return null;
	try {
		const v = JSON.parse(raw) as Partial<CooldownEntry>;
		if (typeof v.untilMs !== 'number' || typeof v.consecutive !== 'number') return null;
		return {
			untilMs: v.untilMs,
			consecutive: v.consecutive,
			probeTaken: v.probeTaken === true,
		};
	} catch {
		return null;
	}
}

export { COOLDOWN, COOLDOWN_GRACE_MS, HEALTH_TTL_MS };
