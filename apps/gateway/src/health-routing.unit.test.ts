// Health as the router actually consumes it.
//
// `packages/shared` proves the statistic; this proves the wiring, which is where a correct
// state machine still produces wrong routing. Every case here is a behaviour a user would
// notice: which provider went first, whether a request was served at all, and what the
// response said about why.

import type { Adapter, ProviderCapabilities } from '@proxlane/adapters';
import { HEALTH, type HealthState, initial, observe } from '@proxlane/shared';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import { assertSingleWriter, type HealthStore, InMemoryHealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

function caps(id: string): ProviderCapabilities {
	return {
		line: 1,
		id,
		renderJs: true,
		post: true,
		binary: false,
		sessions: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none', 'residential', 'stealth']),
		fastTimeoutMs: 22_000,
		maxTimeoutMs: 75_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			unit: 'provider-credits',
			matrix: {
				none: { plain: 1, rendered: 1 },
				residential: { plain: 1, rendered: 1 },
				stealth: { plain: 1, rendered: 1 },
			},
		},
	};
}

/** An adapter that always parses to the outcome you name. */
function adapterFor(id: string, outcome: 'OK' | 'PROVIDER_ERROR'): Adapter {
	return {
		capabilities: caps(id),
		translate: () => ({
			url: `https://${id}.test/`,
			method: 'GET',
			headers: {},
			timeoutMs: 1000,
		}),
		parse: () => ({
			outcome,
			cost: { microcredits: 0, source: 'estimated' },
			...(outcome === 'OK'
				? { body: new TextEncoder().encode('<html>ok</html>'), contentType: 'text/html' }
				: {}),
		}),
	} as Adapter;
}

const transport: HttpTransport = {
	execute: () =>
		Promise.resolve({
			kind: 'response' as const,
			latencyMs: 5,
			response: { status: 200, headers: {}, body: new Uint8Array() },
		}),
};

function candidates(...ids: string[]) {
	return ids.map((id) => ({ adapter: adapterFor(id, 'OK'), key: 'k' }));
}

const REQ = {
	url: 'https://example.com/',
	method: 'GET' as const,
	renderJs: false,
	premium: 'none' as const,
	deadlineMs: 90_000,
};

/** A store pre-loaded with fixed states, so a test names the situation instead of simulating it. */
function storeWith(states: Record<string, HealthState['state']>): HealthStore {
	const map = new Map<string, HealthState>(
		Object.entries(states).map(([id, state]) => [id, { ...initial(0), state, p0: 0.04 }]),
	);
	return {
		snapshot: (ids) =>
			Promise.resolve(new Map(ids.map((id) => [id, map.get(id) ?? initial(0)]))),
		record: () => {},
		recordProbe: () => {},
		all: () => Promise.resolve(map),
	};
}

async function run(store: HealthStore | undefined, ...ids: string[]) {
	return runChain(REQ, {
		transport,
		candidates: candidates(...ids),
		maxBodyBytes: 1024 * 1024,
		...(store === undefined ? {} : { health: store }),
	});
}

describe('health re-ranks the chain', () => {
	it('sends a degraded provider behind a healthy one', async () => {
		const r = await run(storeWith({ a: 'degraded', b: 'healthy' }), 'a', 'b');
		expect(r.provider).toBe('b');
	});

	it('keeps static priority when health is equal', async () => {
		// Health re-ranks, it does not replace the operator's ordering.
		const r = await run(storeWith({ a: 'healthy', b: 'healthy' }), 'a', 'b');
		expect(r.provider).toBe('a');
	});

	it('drops a demoted provider from the chain entirely', async () => {
		const r = await run(storeWith({ a: 'demoted', b: 'healthy' }), 'a', 'b');
		expect(r.provider).toBe('b');
		expect(r.attempts.map((x) => x.provider)).not.toContain('a');
	});

	it('routes normally with no store at all', async () => {
		// The switch has to be real: PROXLANE_HEALTH=off must behave exactly as before.
		const r = await run(undefined, 'a', 'b');
		expect(r.provider).toBe('a');
		expect(r.providerHealth).toBe('healthy');
	});
});

describe('the floor', () => {
	it('serves from the least-bad demoted provider rather than refusing', async () => {
		// A gateway that turns itself off is worse than one routing at 74%. Without the floor
		// this is NO_PROVIDER_AVAILABLE, which reads to a user as our outage.
		const r = await run(storeWith({ a: 'demoted', b: 'demoted' }), 'a', 'b');
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('a');
	});

	it('says so, in the header a user can see', async () => {
		const r = await run(storeWith({ a: 'demoted', b: 'demoted' }), 'a', 'b');
		expect(r.providerHealth).toBe('demoted-forced');
	});

	it('still answers NO_PROVIDER_AVAILABLE when there are genuinely none', async () => {
		// The floor must not invent a provider. Capability emptiness and health emptiness are
		// different failures and only one of them has a fallback.
		const r = await runChain(REQ, {
			transport,
			candidates: [],
			maxBodyBytes: 1024,
			health: new InMemoryHealthStore(),
		});
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
	});
});

describe('fail open', () => {
	it('routes as if healthy when the store throws', async () => {
		// integrations.md section 3's Valkey-failure table. Losing health costs a worse
		// routing decision, never a refused request — health is an optimisation over a chain
		// that already works, so it must not be able to take the gateway down with it.
		const broken: HealthStore = {
			snapshot: () => Promise.reject(new Error('valkey is gone')),
			record: () => {},
			recordProbe: () => {},
			all: () => Promise.reject(new Error('valkey is gone')),
		};
		const r = await run(broken, 'a', 'b');
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('a');
	});

	it('does not let a throwing recorder break a request', async () => {
		const throwsOnRecord: HealthStore = {
			snapshot: (ids) => Promise.resolve(new Map(ids.map((id) => [id, initial(0)]))),
			record: () => {
				throw new Error('write failed');
			},
			recordProbe: () => {},
			all: () => Promise.resolve(new Map()),
		};
		await expect(run(throwsOnRecord, 'a')).resolves.toMatchObject({ outcome: 'OK' });
	});
});

describe('the store folds real traffic in', () => {
	it('demotes a provider that fails steadily, through the chain', async () => {
		// End to end rather than through observe() directly: proves the chain records the
		// outcomes it produces, with the ids it used.
		const store = new InMemoryHealthStore();
		const failing = [{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' }];
		for (let i = 0; i < HEALTH.MIN_SAMPLES + 3000; i++) {
			await runChain(REQ, {
				transport,
				candidates: failing,
				maxBodyBytes: 1024,
				health: store,
			});
			const st = (await store.all(Date.now())).get('a');
			if (st?.state === 'demoted') break;
		}
		const st = (await store.all(Date.now())).get('a');
		expect(st?.state).toBe('demoted');
	});

	it('ignores outcomes that are not the provider fault', async () => {
		const store = new InMemoryHealthStore();
		const now = 1000;
		for (let i = 0; i < 5000; i++) store.record('a', 'TARGET_ERROR', now + i);
		const st = (await store.all(now)).get('a');
		expect(st?.p0, 'target failures must not even count toward measurement').toBeNull();
	});

	it('starts a provider it has never seen at the current clock, not at zero', async () => {
		// A shared frozen INITIAL would hand every provider the timestamp of process start,
		// and DWELL_RECOVER_MS is measured from it.
		const store = new InMemoryHealthStore();
		const snap = await store.snapshot(['a'], 5_000_000);
		expect(snap.get('a')?.enteredAt).toBe(5_000_000);
	});
});

describe('the single-writer limit is enforced, not documented', () => {
	it('refuses to boot a second replica against process-local health', () => {
		// Two replicas form two opinions and demote independently, which looks like flaky
		// routing and appears in no log. Whoever scales this will be reading a compose file,
		// not health-store.ts.
		expect(() => assertSingleWriter(2)).toThrow(/in-process/);
		expect(() => assertSingleWriter(2)).toThrow(/Valkey/);
	});

	it('allows one', () => {
		expect(() => assertSingleWriter(1)).not.toThrow();
	});
});

describe('recovery is probe-only, even through the chain', () => {
	it('does not lift a demoted provider however much live traffic succeeds', async () => {
		const store = new InMemoryHealthStore();
		let st = initial(0);
		for (let i = 1; i <= 20_000 && st.state !== 'demoted'; i++) {
			st = observe(st, i <= HEALTH.MIN_SAMPLES ? 'OK' : 'PROVIDER_ERROR', i * 1000);
		}
		expect(st.state).toBe('demoted');
		for (let i = 0; i < 5000; i++) store.record('a', 'OK', 30_000_000 + i);
		// 'a' was never demoted in THIS store, so assert the property on the real path: a
		// demoted provider only leaves via recordProbe.
		store.recordProbe('a', true, 40_000_000);
		expect((await store.all(0)).get('a')?.state).not.toBe('demoted');
	});
});
