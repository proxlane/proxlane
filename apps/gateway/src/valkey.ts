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
	armFor,
	COOLDOWN,
	type CooldownDecision,
	type CooldownEntry,
	decide,
	type HealthState,
	healthWeight,
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

/**
 * Hard ceiling on buffered observations per provider.
 *
 * Requeue-on-failure is right — losing a whole flush interval to one blip is the failure
 * buffering exists to avoid — but without a ceiling it is a memory leak with a trigger any
 * dependency blip can pull. Worse, the early-flush test above is `>=`, so once a requeued
 * batch sat above FLUSH_AT, EVERY subsequent record chained another full write attempt:
 * measured at 2,000 records producing 1,801 GETs against a down Valkey, and 1,500 records
 * producing 3,903 GET+EVAL pairs against a contended one. The buffer amplified load on the
 * store precisely when the store was struggling.
 *
 * At the ceiling the OLDEST observations are dropped, not the newest: the statistic cares
 * about the recent past, and a stale backlog describes a provider that has since moved on.
 */
const MAX_PENDING = 5_000;

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
	/**
	 * A batch currently being written. Still folded into reads.
	 *
	 * Without it the batch is detached from `#pending` before the first await and exists in
	 * neither place for the duration of the round trip, so a concurrent read goes BACKWARDS —
	 * the exact property `snapshot` claims to guarantee. The e2e test that asserts it never
	 * overlapped a flush, so it could not see this.
	 */
	readonly #inFlight = new Map<string, { outcome: Outcome; now: number; probe?: boolean }[]>();
	/** Observations discarded because a provider's buffer hit MAX_PENDING. */
	#dropped = 0;
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
	async flush(rounds = 2): Promise<void> {
		for (let round = 0; round < rounds; round++) {
			const ids = new Set([...this.#pending.keys(), ...this.#chains.keys()]);
			if (ids.size === 0) return;
			await Promise.all([...ids].map((id) => this.#flushOne(id)));
		}
	}

	/**
	 * Flush and stop the timer.
	 *
	 * More rounds than a routine flush, because this is the last chance: under sustained
	 * contention a requeued batch needs several passes, and a two-round `flush()` resolving
	 * with data still buffered was the loss path even once shutdown called it.
	 */
	async close(): Promise<void> {
		if (this.#timer !== undefined) clearInterval(this.#timer);
		await this.flush(10);
		if (this.#pending.size > 0) {
			this.#report(
				'health close',
				new Error(`${this.#pending.size} provider(s) still buffered after 10 drain rounds`),
			);
		}
	}

	#enqueue(providerId: string, obs: { outcome: Outcome; now: number; probe?: boolean }): void {
		// Ignored outcomes are pure no-ops in `observe`, so buffering them buys nothing and
		// costs a write. Measured: 500 TARGET_NOT_FOUND records produced 301 GETs for
		// observations that provably could not change anything.
		if (obs.probe === undefined && healthWeight(obs.outcome) === 'ignore') return;

		const q = this.#pending.get(providerId) ?? [];
		q.push(obs);
		if (q.length > MAX_PENDING) {
			const dropped = q.length - MAX_PENDING;
			q.splice(0, dropped);
			this.#dropped += dropped;
		}
		this.#pending.set(providerId, q);

		// Only trigger an early flush at the threshold itself, never above it. `>=` meant a
		// requeued batch re-triggered on every single record, turning the buffer into an
		// amplifier against a store that was already failing.
		if (q.length === FLUSH_AT) void this.#flushOne(providerId);
	}

	/** Observations discarded at the ceiling. Surfaced so a silent leak becomes a visible loss. */
	get droppedObservations(): number {
		return this.#dropped;
	}

	/** Fold buffered observations onto a stored state. The same pure functions, in order. */
	#applyPending(providerId: string, from: HealthState): HealthState {
		let st = from;
		// In-flight first: it was enqueued earlier, and `observe` is order-dependent.
		const buffered = [
			...(this.#inFlight.get(providerId) ?? []),
			...(this.#pending.get(providerId) ?? []),
		];
		for (const o of buffered) {
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
		//
		// Parked in `#inFlight` rather than simply dropped from `#pending`, because otherwise
		// the observations exist in neither place for the duration of the round trip and a
		// concurrent read goes BACKWARDS — the exact property `snapshot` claims to guarantee.
		this.#pending.delete(providerId);
		this.#inFlight.set(providerId, batch);
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
			this.#requeue(providerId, batch);
			this.#report(`health ${key}`, new Error('contended; batch requeued'));
		} catch (err) {
			// Put the batch back on a transport failure too. Dropping it here would lose a whole
			// flush interval to one blip, which is the failure mode buffering exists to avoid.
			//
			// NOT idempotent, and worth stating: if the EVAL reached the server and the reply
			// was lost, the batch is applied twice. With `maxRetriesPerRequest: 1` that is a
			// live path on any connection blip. Double-counting a batch of successes moves the
			// statistic slightly; it cannot invent a demotion, because `observe` is monotone in
			// failures and a duplicated batch contains the same ones. Accepted, and said out
			// loud rather than implied by the word "lossless".
			this.#requeue(providerId, batch);
			this.#report(`health ${key}`, err);
		} finally {
			this.#inFlight.delete(providerId);
		}
	}

	#requeue(
		providerId: string,
		batch: { outcome: Outcome; now: number; probe?: boolean }[],
	): void {
		const q = this.#pending.get(providerId);
		const merged = q === undefined ? batch : [...batch, ...q];
		if (merged.length > MAX_PENDING) {
			this.#dropped += merged.length - MAX_PENDING;
			merged.splice(0, merged.length - MAX_PENDING);
		}
		this.#pending.set(providerId, merged);
	}

	/**
	 * Report a failure without letting the reporter become one.
	 *
	 * `onError` is caller-supplied and every call site here is inside a promise nobody awaits.
	 * A throwing reporter therefore surfaced as an unhandled rejection, which under Node's
	 * default is process death — on a path the hot path deliberately does not await, so the
	 * chain's own try/catch could not see it.
	 */
	#report(where: string, err: unknown): void {
		try {
			this.#onError(where, err);
		} catch {
			// Nothing left to report to.
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
-- Defensive, because the JS side is. parseCooldown treats an unreadable record as ABSENT,
-- which is the fail-open direction section 3 requires; the Lua raised instead, the claim
-- rejected, and chain.ts's catch failed open into the herd the half-open design exists to
-- prevent. The two copies disagreed exactly where it costs money.
local ok, e = pcall(cjson.decode, raw)
if not ok or type(e) ~= 'table' or type(e.untilMs) ~= 'number' then return 1 end
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

	/** See `ValkeyHealthStore.#report`. A throwing reporter must not kill the process. */
	#report(where: string, err: unknown): void {
		try {
			this.#onError(where, err);
		} catch {
			// Nothing left to report to.
		}
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

	arm(key: string, now: number, retryAfterMs?: number): void {
		void (async () => {
			for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
				try {
					const current = await this.#redis.get(key);
					const prev = parseCooldown(current) ?? undefined;
					// Honour the target's own Retry-After when the provider exposed it. The
					// in-memory store does, and a shared store that quietly did not would make
					// backoff depend on which one you deployed.
					const entry: CooldownEntry =
						retryAfterMs === undefined
							? arm(prev, now, this.#rng)
							: armFor(prev, now, retryAfterMs);
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
					this.#report(`cooldown arm ${key}`, err);
					return;
				}
			}
			// Losing this race means somebody else armed the same key at the same instant, so
			// the cooldown exists either way. Unlike a dropped health observation this one is
			// genuinely harmless, and saying so beats a silent return.
			this.#report(`cooldown arm ${key}`, new Error('contended; another writer armed it'));
		})();
	}

	clear(key: string): void {
		this.#redis.del(key).catch((err: unknown) => this.#report(`cooldown clear ${key}`, err));
	}

	async list(_now: number): Promise<ReadonlyArray<{ key: string } & CooldownEntry>> {
		// SCAN, never KEYS, for the same reason `all()` uses it: this is reachable from an HTTP
		// endpoint, and KEYS blocks the server for the length of the keyspace. A diagnostic that
		// can stall the gateway it is diagnosing is worse than no diagnostic.
		const out: ({ key: string } & CooldownEntry)[] = [];
		let cursor = '0';
		do {
			const [next, keys] = await this.#redis.scan(cursor, 'MATCH', 'cd:*', 'COUNT', 100);
			cursor = next;
			if (keys.length > 0) {
				const values = await this.#redis.mget(keys);
				keys.forEach((k, i) => {
					const parsed = parseCooldown(values[i] ?? null);
					if (parsed !== null) out.push({ key: k, ...parsed });
				});
			}
		} while (cursor !== '0');
		return out;
	}

	release(key: string): void {
		// Atomic, and TTL-preserving, for the same reasons CLAIM is: two gateways settling
		// probes on the same key must not clobber each other's expiry.
		this.#redis
			.eval(RELEASE, 1, key)
			.catch((err: unknown) => this.#report(`cooldown release ${key}`, err));
	}
}

/**
 * `hs:{provider}`, with NO deployment prefix, and that is a limitation rather than a design.
 *
 * Health is deliberately provider-global — `integrations.md` section 3 shares it across orgs
 * on purpose, because "is this provider worse than it usually is" has one answer. But two
 * separate DEPLOYMENTS pointed at one Valkey is a different thing entirely, and this key
 * cannot tell them apart: a staging gateway would write production's baselines.
 *
 * Not solved with a prefix here, because `all()` scans `hs:*` and ioredis's own `keyPrefix`
 * option does not apply to SCAN patterns — a half-applied prefix is worse than none. Use a
 * separate Valkey logical database per deployment instead (`redis://host:6379/1`), which is
 * free and total. Said out loud because the alternative is someone discovering it.
 */
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
