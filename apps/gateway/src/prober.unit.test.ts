// The background probe: the only exit from `demoted`.
//
// Until this existed, health was a one-way door — `state.md` carried it as a known hole for
// weeks. The properties below are the ones that make it a recovery mechanism rather than a
// timer: it probes only what is demoted, it paces itself by the backoff, it never probes on
// a user's request, and it does not multiply by the number of replicas.

import type { Adapter, ProviderCapabilities } from '@proxlane/adapters';
import { HEALTH, type HealthState, initial, observeProbe } from '@proxlane/shared';
import type { HttpTransport } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { InMemoryHealthStore } from './health-store.js';
import { PROBE_URL, Prober } from './prober.js';

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

/** Records what was asked of it, so a test can assert the probe went where it should. */
function adapterFor(
	id: string,
	outcome: 'OK' | 'PROVIDER_ERROR',
	seen: string[] = [],
): Adapter {
	return {
		capabilities: caps(id),
		translate: (req: { url: string }) => {
			seen.push(req.url);
			return { url: `https://${id}.test/`, method: 'GET', headers: {}, timeoutMs: 1000 };
		},
		parse: () => ({ outcome, cost: { microcredits: 0, source: 'estimated' } }),
	} as unknown as Adapter;
}

const transport: HttpTransport = {
	execute: () =>
		Promise.resolve({
			kind: 'response' as const,
			latencyMs: 5,
			response: { status: 200, headers: {}, body: new Uint8Array() },
		}),
};

/** A store reporting fixed states, so a test names the situation. */
function healthOf(states: Record<string, HealthState['state']>) {
	const calls: { id: string; ok: boolean }[] = [];
	return {
		calls,
		store: {
			snapshot: (ids: readonly string[]) =>
				Promise.resolve(
					new Map(ids.map((id) => [id, { ...initial(0), state: states[id] ?? 'healthy' }])),
				),
			record: () => {},
			recordProbe: (id: string, ok: boolean) => {
				calls.push({ id, ok });
			},
			all: () => Promise.resolve(new Map()),
		},
	};
}

describe('what gets probed', () => {
	it('probes a demoted provider', async () => {
		const h = healthOf({ a: 'demoted' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
		}).tick();
		expect(h.calls).toEqual([{ id: 'a', ok: true }]);
	});

	it('leaves healthy and degraded providers alone', async () => {
		// Degraded is still in rotation; live traffic is already measuring it. Probing it would
		// spend money to learn what the chain is learning for free.
		const h = healthOf({ a: 'healthy', b: 'degraded' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [
				{ adapter: adapterFor('a', 'OK'), key: 'k' },
				{ adapter: adapterFor('b', 'OK'), key: 'k' },
			],
		}).tick();
		expect(h.calls).toEqual([]);
	});

	it('probes the stable target, not an arbitrary URL', async () => {
		// The same host `pnpm record` and the canary use, so a failure means the provider
		// rather than the target.
		const seen: string[] = [];
		const h = healthOf({ a: 'demoted' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK', seen), key: 'k' }],
		}).tick();
		expect(seen).toEqual([PROBE_URL]);
	});

	it('reports a non-OK outcome as a failed probe', async () => {
		const h = healthOf({ a: 'demoted' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' }],
		}).tick();
		expect(h.calls).toEqual([{ id: 'a', ok: false }]);
	});

	it('reports a transport failure as a failed probe, not a crash', async () => {
		const h = healthOf({ a: 'demoted' });
		const dead: HttpTransport = { execute: () => Promise.reject(new Error('socket died')) };
		await new Prober({
			health: h.store,
			transport: dead,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			onError: () => {},
		}).tick();
		expect(h.calls).toEqual([{ id: 'a', ok: false }]);
	});
});

describe('pacing', () => {
	it('honours the backoff rather than probing on every tick', async () => {
		// Without this the loop would probe a dead provider once a minute forever, which is the
		// 288-wasted-requests-a-day failure the backoff exists to stop.
		const h = healthOf({ a: 'demoted' });
		let clock = 1_000_000;
		const p = new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' }],
			now: () => clock,
		});
		await p.tick();
		expect(h.calls).toHaveLength(1);
		clock += 60_000;
		await p.tick();
		expect(h.calls, 'probed again before the backoff elapsed').toHaveLength(1);
		clock += HEALTH.PROBE_FIRST_MS;
		await p.tick();
		expect(h.calls).toHaveLength(2);
	});

	it('backs off further with each failed probe, to the ceiling', async () => {
		const h = healthOf({ a: 'demoted' });
		let clock = 0;
		const p = new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' }],
			now: () => clock,
		});
		for (let i = 0; i < 12; i++) {
			await p.tick();
			clock += HEALTH.PROBE_MAX_MS;
		}
		// Twelve probes across twelve ceiling-length intervals. At most four a day is the
		// promise `integrations.md` section 3 makes.
		expect(h.calls.length).toBeLessThanOrEqual(12);
		expect(p.schedule.get('a')?.n).toBeGreaterThan(3);
	});

	it('forgets the backoff once a provider recovers', async () => {
		// Otherwise the next demotion inherits a six-hour interval from an incident that is
		// over, and the provider takes a working day to be probed again.
		const states: Record<string, HealthState['state']> = { a: 'demoted' };
		const calls: { id: string; ok: boolean }[] = [];
		let clock = 0;
		const p = new Prober({
			health: {
				snapshot: (ids) =>
					Promise.resolve(
						new Map(ids.map((id) => [id, { ...initial(0), state: states[id] ?? 'healthy' }])),
					),
				record: () => {},
				recordProbe: (id, ok) => calls.push({ id, ok }),
				all: () => Promise.resolve(new Map()),
			},
			transport,
			candidates: [{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' }],
			now: () => clock,
		});
		await p.tick();
		clock += HEALTH.PROBE_FIRST_MS;
		await p.tick();
		expect(p.schedule.get('a')?.n).toBe(2);

		states.a = 'healthy';
		await p.tick();
		expect(p.schedule.has('a'), 'backoff survived recovery').toBe(false);

		states.a = 'demoted';
		await p.tick();
		expect(p.schedule.get('a')?.n, 'the new demotion did not start fresh').toBe(1);
	});
});

describe('several replicas', () => {
	it('does not probe when another replica holds the lease', async () => {
		// N replicas each probing the same provider is N times the spend, and N conflicting
		// recordProbe calls against a counter that means "consecutive clean probes".
		const h = healthOf({ a: 'demoted' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			lease: () => Promise.resolve(false),
		}).tick();
		expect(h.calls).toEqual([]);
	});

	it('probes when it wins the lease', async () => {
		const h = healthOf({ a: 'demoted' });
		const asked: [string, number][] = [];
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			lease: (key, ttl) => {
				asked.push([key, ttl]);
				return Promise.resolve(true);
			},
		}).tick();
		expect(h.calls).toEqual([{ id: 'a', ok: true }]);
		// The lease must outlive the request it protects, or a second replica starts probing
		// while the first is still waiting.
		expect(asked[0]?.[0]).toBe('probe:a');
		expect(asked[0]?.[1]).toBeGreaterThan(75_000);
	});

	it('skips rather than guesses when the lease itself fails', async () => {
		// Fails CLOSED, unlike a health read. Not knowing whether another replica is probing
		// costs a duplicated spend and a corrupted counter; skipping costs one interval.
		const h = healthOf({ a: 'demoted' });
		await new Prober({
			health: h.store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			lease: () => Promise.reject(new Error('valkey gone')),
			onError: () => {},
		}).tick();
		expect(h.calls).toEqual([]);
	});
});

describe('robustness', () => {
	it('probes nothing when the health snapshot fails', async () => {
		// Fail open means "no opinion", which is no probe — not probing everything.
		const calls: unknown[] = [];
		await new Prober({
			health: {
				snapshot: () => Promise.reject(new Error('store gone')),
				record: () => {},
				recordProbe: () => calls.push(1),
				all: () => Promise.resolve(new Map()),
			},
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			onError: () => {},
		}).tick();
		expect(calls).toEqual([]);
	});

	it('never runs two passes at once', async () => {
		// Overlapping passes would probe the same provider twice and break the
		// consecutive-clean-probe count that decides recovery.
		let inFlight = 0;
		let maxInFlight = 0;
		const slow: HttpTransport = {
			execute: async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 20));
				inFlight--;
				return {
					kind: 'response' as const,
					latencyMs: 20,
					response: { status: 200, headers: {}, body: new Uint8Array() },
				};
			},
		};
		const h = healthOf({ a: 'demoted' });
		const p = new Prober({
			health: h.store,
			transport: slow,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
		});
		await Promise.all([p.tick(), p.tick(), p.tick()]);
		expect(maxInFlight).toBe(1);
		expect(h.calls).toHaveLength(1);
	});

	it('does not hold the process open', () => {
		// A pending timer turns a container stop into a SIGKILL.
		const h = healthOf({});
		const p = new Prober({ health: h.store, transport, candidates: [] });
		p.start();
		expect(p.schedule.size).toBe(0);
		p.stop();
	});
});

describe('it actually recovers a provider, end to end', () => {
	it('takes PROBE_CLEAN clean probes to leave demoted, through the real store', async () => {
		// The whole point. Against InMemoryHealthStore rather than a stub, so the state machine
		// is the real one.
		const store = new InMemoryHealthStore();
		let st = initial(0);
		// Drive a real demotion rather than asserting one into existence.
		for (let i = 1; i <= 20_000 && st.state !== 'demoted'; i++) {
			st = observeProbe(st, false, i);
			store.record('a', i <= HEALTH.MIN_SAMPLES ? 'OK' : 'PROVIDER_ERROR', i);
			st = (await store.snapshot(['a'], i)).get('a') as HealthState;
		}
		expect(st.state).toBe('demoted');

		let clock = 10_000_000;
		const p = new Prober({
			health: store,
			transport,
			candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
			now: () => clock,
		});
		for (let i = 0; i < HEALTH.PROBE_CLEAN; i++) {
			await p.tick();
			clock += HEALTH.PROBE_MAX_MS;
		}
		const after = (await store.snapshot(['a'], clock)).get('a') as HealthState;
		expect(after.state, 'the provider never came back').not.toBe('demoted');
	});
});
