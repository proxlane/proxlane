// The Valkey stores, against a real Valkey.
//
// The in-memory stores are correct for free, because JavaScript cannot interleave a
// read-modify-write. Across a network it can, and this file exists for the two interleavings
// that cost money. Neither is reachable in a unit test with a fake client: a fake that
// serialises calls proves the opposite of what is being asked.
//
// Container started by `tooling/vitest/containers.ts`, which supplies PROXLANE_VALKEY_URL.

import {
	arm,
	COOLDOWN,
	type CooldownEntry,
	claimProbe,
	type HealthState,
	initial,
	observe as observePure,
} from '@proxlane/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ValkeyCooldownStore, ValkeyHealthStore } from './valkey.js';

const URL = process.env.PROXLANE_VALKEY_URL;
let redis: Redis;

beforeAll(() => {
	// Fail loudly rather than skip. A suite that quietly skips when its container is missing
	// reports green for a run in which nothing was checked — the same vacuous pass the
	// non-zero-denominator rule exists to refuse.
	if (URL === undefined) {
		throw new Error(
			'PROXLANE_VALKEY_URL is not set. globalSetup should have started a Valkey container; ' +
				'a skipped run here would report green having verified nothing.',
		);
	}
	redis = new Redis(URL, { maxRetriesPerRequest: 2 });
});

afterEach(async () => {
	await redis.flushall();
});

afterAll(async () => {
	await redis.quit();
});

describe('the health store round-trips through a real server', () => {
	it('reads back exactly what the state machine produced', async () => {
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		store.record('a', 'PROVIDER_ERROR', 1000);
		await store.flush();
		const st = (await store.snapshot(['a'], 0)).get('a') as HealthState;
		expect(st.samples).toBe(1);
		expect(st.failures).toBe(1);
		expect(st.p0).toBeNull();
	});

	it('treats a provider it has never seen as freshly initialised, not absent', async () => {
		const store = new ValkeyHealthStore({ redis });
		const st = (await store.snapshot(['never'], 4242)).get('never');
		expect(st?.state).toBe('healthy');
		expect(st?.enteredAt).toBe(4242);
	});

	it('treats an unreadable record as no opinion rather than throwing', async () => {
		// A record written by an older version must not throw inside a routing decision.
		// Absent means healthy, which is the fail-open direction section 3 requires.
		await redis.set('hs:corrupt', '{not json');
		const store = new ValkeyHealthStore({ redis });
		const st = (await store.snapshot(['corrupt'], 7)).get('corrupt');
		expect(st?.state).toBe('healthy');
	});

	it('lists what it knows without KEYS, for the diagnostic endpoint', async () => {
		// SCAN, never KEYS: KEYS blocks the server for the length of the keyspace and this is
		// reachable from an HTTP endpoint. A diagnostic that can stall the gateway it is
		// diagnosing is worse than none.
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		for (const id of ['a', 'b', 'c']) store.record(id, 'OK', 1);
		await store.flush();
		expect([...(await store.all(0)).keys()].sort()).toEqual(['a', 'b', 'c']);
	});

	it('loses no observations to contention between two replicas', async () => {
		// The test that failed and was right to. The first version wrote one compare-and-set
		// per observation; under 400 concurrent writes to one provider's key — one busy
		// gateway, not a fleet — most lost the race and were DROPPED, so the statistic barely
		// accumulated at exactly the traffic level where it matters. Batching fixed it, and
		// this asserts the property rather than a threshold.
		const a = new ValkeyHealthStore({ redis, onError: () => {}, autoFlush: false });
		const b = new ValkeyHealthStore({ redis, onError: () => {}, autoFlush: false });
		for (let i = 0; i < 200; i++) {
			a.record('x', 'OK', 1000 + i);
			b.record('x', 'OK', 1000 + i);
		}
		// Concurrent flushes from both "replicas", so one of them must lose a CAS and requeue.
		await Promise.all([a.flush(), b.flush()]);
		await Promise.all([a.flush(), b.flush()]);
		const st = (await a.snapshot(['x'], 0)).get('x') as HealthState;
		expect(st.samples, 'observations were dropped under contention').toBe(400);
		expect(st.state).toBe('healthy');
	});

	it('a read never goes backwards relative to what this process just recorded', async () => {
		// A request that just recorded a failure must not then route on a snapshot that
		// predates it. Buffering makes that possible unless reads fold the buffer in.
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		store.record('y', 'PROVIDER_ERROR', 1000);
		const st = (await store.snapshot(['y'], 0)).get('y') as HealthState;
		expect(st.samples).toBe(1);
	});

	it('applies a buffered batch to exactly the state per-write would have reached', async () => {
		// `observe` is a pure fold, so a batch applied in order is the same state. If that
		// stops being true, batching has changed behaviour rather than just cost.
		const batched = new ValkeyHealthStore({ redis, autoFlush: false });
		// Seeded at the first observation's clock, which is what the store does for a provider
		// it has never seen — `enteredAt` is when we first heard of it, not process start.
		let byHand = initial(1);
		for (let i = 1; i <= 300; i++) {
			const o = i % 7 === 0 ? 'PROVIDER_ERROR' : 'OK';
			batched.record('z', o, i);
			byHand = observePure(byHand, o, i);
		}
		await batched.flush();
		const st = (await batched.snapshot(['z'], 0)).get('z') as HealthState;
		expect(st).toEqual(byHand);
	});
});

describe('the cooldown store, where atomicity actually matters', () => {
	it('hands the post-expiry probe to EXACTLY ONE of many concurrent callers', async () => {
		// The reason `claim` is a Lua script and not a GET followed by a SET. Twenty callers
		// racing for one probe slot: nineteen must lose. With a read-then-write, most win.
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.5 });
		const key = 'cd:blk:p:example.com';
		const expired = arm(undefined, 0, () => 0.001);
		await redis.set(key, JSON.stringify(expired));

		const now = expired.untilMs + 1;
		const results = await Promise.all(Array.from({ length: 20 }, () => store.claim(key, now)));
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it('refuses the probe while still cooling', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.9 });
		const key = 'cd:blk:p:cooling.example';
		const entry = arm(undefined, 1_000_000, () => 0.9);
		await redis.set(key, JSON.stringify(entry));
		expect(await store.claim(key, 1_000_001)).toBe(false);
	});

	it('lets a caller through when there is no entry at all', async () => {
		const store = new ValkeyCooldownStore({ redis });
		expect(await store.claim('cd:blk:p:nothing.example', Date.now())).toBe(true);
	});

	it('preserves the remaining TTL when it claims', async () => {
		// A claim must not extend or drop the cooldown. Dropping the TTL would make the record
		// immortal; extending it would punish the probe for existing.
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.5 });
		const key = 'cd:blk:p:ttl.example';
		const entry = arm(undefined, 0, () => 0.001);
		await redis.set(key, JSON.stringify(entry), 'PX', 60_000);
		await store.claim(key, entry.untilMs + 1);
		const ttl = await redis.pttl(key);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(60_000);
	});

	it('keeps the record after the cooldown lifts, so backoff stays exponential', async () => {
		// Expiring the record the instant the cooldown ends would reset `consecutive` every
		// time and quietly turn exponential backoff into a constant 30 seconds.
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.001 });
		const key = 'cd:blk:p:grace.example';
		store.arm(key, Date.now());
		await waitFor(async () => (await redis.get(key)) !== null);
		const ttl = await redis.pttl(key);
		expect(ttl).toBeGreaterThan(COOLDOWN.CAP_MS);
	});

	it('reports cooling, probe and open the same way the pure function does', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.9 });
		const cooling = 'cd:blk:p:a.example';
		const expired = 'cd:blk:p:b.example';
		await redis.set(cooling, JSON.stringify(arm(undefined, 1_000_000, () => 0.9)));
		await redis.set(expired, JSON.stringify(arm(undefined, 0, () => 0.001)));
		const got = await store.check([cooling, expired, 'cd:blk:p:c.example'], 1_000_001);
		expect(got.get(cooling)?.kind).toBe('cooling');
		expect(got.get(expired)?.kind).toBe('probe');
		expect(got.get('cd:blk:p:c.example')?.kind).toBe('open');
	});

	it('clears on success', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.9 });
		const key = 'cd:blk:p:clear.example';
		store.arm(key, Date.now());
		await waitFor(async () => (await redis.get(key)) !== null);
		store.clear(key);
		await waitFor(async () => (await redis.get(key)) === null);
		expect(await redis.get(key)).toBeNull();
	});
});

describe('the Lua claim and the pure claimProbe agree', () => {
	// `claimProbe` exists twice: in packages/shared, and as the CLAIM script, because Valkey
	// cannot call a JavaScript function and the decision must be atomic server-side. This is
	// what keeps the copies honest. Every row is a state the pure function distinguishes.
	const cases: { name: string; entry: CooldownEntry | undefined; now: number }[] = [
		{ name: 'no entry', entry: undefined, now: 1000 },
		{
			name: 'still cooling',
			entry: { untilMs: 5000, consecutive: 1, probeTaken: false },
			now: 4999,
		},
		{
			name: 'exactly at expiry',
			entry: { untilMs: 5000, consecutive: 1, probeTaken: false },
			now: 5000,
		},
		{
			name: 'expired, probe free',
			entry: { untilMs: 5000, consecutive: 3, probeTaken: false },
			now: 9999,
		},
		{
			name: 'expired, probe taken',
			entry: { untilMs: 5000, consecutive: 3, probeTaken: true },
			now: 9999,
		},
		{
			name: 'cooling, probe taken',
			entry: { untilMs: 9000, consecutive: 2, probeTaken: true },
			now: 100,
		},
	];

	it.each(cases)('agrees on: $name', async ({ entry, now }) => {
		const store = new ValkeyCooldownStore({ redis });
		const key = `cd:blk:p:diff-${Math.floor(now)}-${String(entry?.probeTaken)}.example`;
		if (entry !== undefined) await redis.set(key, JSON.stringify(entry));
		const fromLua = await store.claim(key, now);
		const fromPure = claimProbe(entry, now).claimed;
		expect(fromLua, 'the Lua and the pure function disagree').toBe(fromPure);
	});

	it('leaves the same entry behind as the pure function would', async () => {
		const store = new ValkeyCooldownStore({ redis });
		const key = 'cd:blk:p:diff-entry.example';
		const entry: CooldownEntry = { untilMs: 5000, consecutive: 3, probeTaken: false };
		await redis.set(key, JSON.stringify(entry));
		await store.claim(key, 9999);
		const after = JSON.parse((await redis.get(key)) as string) as CooldownEntry;
		expect(after).toEqual(claimProbe(entry, 9999).next);
	});
});

describe('robustness findings from the review panel', () => {
	it('bounds the buffer instead of growing without limit', async () => {
		// Requeue-on-failure is right, but with no ceiling it is a memory leak whose trigger is
		// any dependency blip. The ceiling drops the OLDEST: the statistic cares about the
		// recent past, and a stale backlog describes a provider that has since moved on.
		// A live client with autoFlush off, so nothing drains and the buffer is the only thing
		// under test. Reading through a DEAD client would just reject on the snapshot.
		const store = new ValkeyHealthStore({ redis, onError: () => {}, autoFlush: false });
		for (let i = 0; i < 8000; i++) store.record('flood', 'PROVIDER_ERROR', i);
		expect(store.droppedObservations, 'the buffer grew without bound').toBe(3000);

		// `samples` is NOT an observation count — `observe` resets it whenever it freezes p0 or
		// changes state — so the retained window is asserted through behaviour instead: 5,000
		// consecutive failures must still reach `demoted`, i.e. the survivors were applied.
		await store.flush();
		const st = (await store.snapshot(['flood'], 0)).get('flood');
		expect(st?.state).toBe('demoted');
	});

	it('does not buffer outcomes the statistic ignores', async () => {
		// They are pure no-ops in `observe`, so buffering them buys nothing and costs a write.
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		for (let i = 0; i < 500; i++) store.record('ignored', 'TARGET_NOT_FOUND', i);
		await store.flush();
		expect(await redis.get('hs:ignored'), 'a no-op produced a write').toBeNull();
	});

	it('a read does not go backwards while a flush is in flight', async () => {
		// The batch is detached from #pending before the first await. Parked nowhere, it exists
		// in neither place for the duration of the round trip, and a concurrent read reports
		// state older than what this process was already told.
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		store.record('inflight', 'PROVIDER_ERROR', 1000);
		const writing = store.flush();
		await Promise.resolve();
		const during = (await store.snapshot(['inflight'], 0)).get('inflight');
		expect(during?.samples, 'read went backwards mid-flush').toBe(1);
		await writing;
		expect((await store.snapshot(['inflight'], 0)).get('inflight')?.samples).toBe(1);
	});

	it('survives a reporter that throws, rather than dying of it', async () => {
		// Every #onError call site is inside a promise nobody awaits, so a throwing reporter
		// surfaced as an unhandled rejection — process death, on a path the hot path
		// deliberately does not await, so the chain's own try/catch could not see it.
		const dead = new Redis('redis://127.0.0.1:1', {
			maxRetriesPerRequest: 0,
			retryStrategy: () => null,
			lazyConnect: true,
			commandTimeout: 200,
		});
		const store = new ValkeyHealthStore({
			redis: dead,
			autoFlush: false,
			onError: () => {
				throw new Error('the reporter itself failed');
			},
		});
		store.record('boom', 'PROVIDER_ERROR', 1);
		await expect(store.flush()).resolves.toBeUndefined();
		dead.disconnect();
	});

	it('close() drains harder than a routine flush', async () => {
		const store = new ValkeyHealthStore({ redis, autoFlush: false });
		for (let i = 0; i < 50; i++) store.record('drain', 'OK', i);
		await store.close();
		expect(await redis.get('hs:drain')).not.toBeNull();
	});
});

describe('the Lua fails open on a record the JS side tolerates', () => {
	// parseCooldown treats an unreadable record as ABSENT, the fail-open direction section 3
	// requires. CLAIM raised on the same input, the claim rejected, and chain.ts failed open
	// into the herd the half-open design exists to prevent. The differential test below could
	// not catch it because every row it fed was a well-formed entry.
	const malformed = [
		'{not json',
		'5',
		'"a string"',
		'{"consecutive":1,"probeTaken":false}',
		'[]',
	];

	it.each(malformed)('claims rather than raising on %s', async (raw) => {
		const store = new ValkeyCooldownStore({ redis });
		const key = `cd:blk:p:malformed-${raw.length}-${raw.charCodeAt(1)}.example`;
		await redis.set(key, raw);
		await expect(store.claim(key, Date.now())).resolves.toBe(true);
	});

	it.each(malformed)('agrees with claimProbe on %s', async (raw) => {
		// The differential property, extended to the case that actually diverged.
		const store = new ValkeyCooldownStore({ redis });
		const key = `cd:blk:p:diffmal-${raw.length}-${raw.charCodeAt(1)}.example`;
		await redis.set(key, raw);
		const fromLua = await store.claim(key, Date.now());
		// Unreadable is absent on the JS side, and `claimProbe(undefined, …)` claims.
		expect(fromLua).toBe(claimProbe(undefined, Date.now()).claimed);
	});
});

describe('release hands the probe back', () => {
	it('clears probeTaken without touching the expiry or the exponent', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.5 });
		const key = 'cd:blk:p:release.example';
		const entry = arm(undefined, 0, () => 0.001);
		await redis.set(key, JSON.stringify(entry), 'PX', 60_000);
		await store.claim(key, entry.untilMs + 1);
		expect(JSON.parse((await redis.get(key)) as string).probeTaken).toBe(true);

		store.release(key);
		await waitFor(async () => {
			const e = JSON.parse((await redis.get(key)) as string) as CooldownEntry;
			return e.probeTaken === false;
		});
		const after = JSON.parse((await redis.get(key)) as string) as CooldownEntry;
		expect(after.untilMs).toBe(entry.untilMs);
		expect(after.consecutive).toBe(entry.consecutive);
		expect(await redis.pttl(key)).toBeGreaterThan(0);
	});

	it('is a no-op on a record that is gone', async () => {
		const store = new ValkeyCooldownStore({ redis });
		store.release('cd:blk:p:absent.example');
		await new Promise((r) => setTimeout(r, 50));
		expect(await redis.get('cd:blk:p:absent.example')).toBeNull();
	});
});

describe('both stores agree on the target Retry-After', () => {
	// The in-memory store honoured it and the Valkey one silently did not: `arm` took the
	// parameter and never used it, so backoff depended on which deployment you were running.
	// Caught by a lint warning about an unused parameter, not by a test — hence this one.
	it('waits as long as the target asked', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.0001 });
		const key = 'cd:blk:p:retryafter.example';
		const before = Date.now();
		store.arm(key, before, 120_000);
		await waitFor(async () => (await redis.get(key)) !== null);
		const e = JSON.parse((await redis.get(key)) as string) as CooldownEntry;
		// The jitter is pinned near zero, so anything near two minutes can only have come from
		// the header rather than from the backoff curve.
		expect(e.untilMs - before).toBeGreaterThan(110_000);
		expect(e.untilMs - before).toBeLessThan(130_000);
	});

	it('falls back to the backoff when the provider stripped it', async () => {
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.9 });
		const key = 'cd:blk:p:nora.example';
		const before = Date.now();
		store.arm(key, before);
		await waitFor(async () => (await redis.get(key)) !== null);
		const e = JSON.parse((await redis.get(key)) as string) as CooldownEntry;
		expect(e.untilMs - before).toBeLessThanOrEqual(COOLDOWN.BASE_MS + SLACK_MS);
	});

	it('gives the record a TTL that outlives the longer wait', async () => {
		// The grace exists so `consecutive` survives the cooldown. A honoured Retry-After makes
		// the cooldown longer than the jittered default, so the TTL has to follow it.
		const store = new ValkeyCooldownStore({ redis, rng: () => 0.0001 });
		const key = 'cd:blk:p:ttlfollow.example';
		store.arm(key, Date.now(), 120_000);
		await waitFor(async () => (await redis.get(key)) !== null);
		expect(await redis.pttl(key)).toBeGreaterThan(120_000);
	});
});

describe('a store whose server has gone away', () => {
	it('rejects on read rather than hanging, so the chain can fail open', async () => {
		// The chain catches this and routes as if healthy. What it cannot survive is a read
		// that never settles, which would hold the request open until the global deadline.
		const dead = new Redis('redis://127.0.0.1:1', {
			maxRetriesPerRequest: 0,
			retryStrategy: () => null,
			lazyConnect: true,
			commandTimeout: 500,
		});
		const store = new ValkeyHealthStore({ redis: dead, onError: () => {} });
		await expect(store.snapshot(['a'], 0)).rejects.toThrow();
		dead.disconnect();
	});

	it('does not throw out of a fire-and-forget write', async () => {
		// `record` returns void. An unhandled rejection here would crash the process on a path
		// the hot path deliberately does not await.
		const dead = new Redis('redis://127.0.0.1:1', {
			maxRetriesPerRequest: 0,
			retryStrategy: () => null,
			lazyConnect: true,
			commandTimeout: 500,
		});
		const errors: string[] = [];
		const store = new ValkeyHealthStore({ redis: dead, onError: (w) => errors.push(w) });
		expect(() => store.record('a', 'OK', 1)).not.toThrow();
		await waitFor(() => Promise.resolve(errors.length > 0), 3000);
		expect(errors[0]).toContain('health');
		dead.disconnect();
	});
});

// Elapsed-time assertions carry SLACK_MS, because `before` is captured before the code under
// test runs and the arm lands a millisecond or two later. Two of these failed in CI at
// exactly bound+1 while passing locally. The bounds are still tight enough to distinguish
// the source of the duration, which is what each test is actually about.
const SLACK_MS = 2_000;

/** Poll until a condition holds. Writes are fire-and-forget, so there is nothing to await. */
async function waitFor(cond: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await cond()) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error('condition never became true');
}
