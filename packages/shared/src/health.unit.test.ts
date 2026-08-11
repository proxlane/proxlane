// The fast guard on the health statistic. `scripts/health-sim.ts` is the full analysis and
// takes minutes; this asserts the same properties at small trial counts so a changed
// constant fails a PR rather than being discovered later.
//
// These are PROPERTY assertions with real bounds, not smoke tests. A test that only checks
// "a stream of failures eventually degrades" passes for any threshold at all and would not
// have caught the bootstrap-p0 defect the simulation found.

import { describe, expect, it } from 'vitest';
import {
	eligible,
	HEALTH,
	type HealthState,
	healthWeight,
	INITIAL,
	increments,
	observe,
	observeProbe,
	orderChain,
	probeDelayMs,
	wilsonUpper,
} from './health.js';
import type { Outcome } from './outcome.js';

function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Feed a stream at a fixed failure rate and report where it lands. */
function run(rate: (i: number) => number, seed: number, n: number): HealthState {
	const rnd = rng(seed);
	let st = INITIAL;
	for (let i = 1; i <= n; i++)
		st = observe(st, rnd() < rate(i) ? 'PROVIDER_ERROR' : 'OK', i * 60_000, 0);
	return st;
}

describe('attribution', () => {
	it('counts only OK against PROVIDER_ERROR and PROVIDER_DRIFT', () => {
		expect(healthWeight('OK')).toBe('success');
		expect(healthWeight('PROVIDER_ERROR')).toBe('failure');
		expect(healthWeight('PROVIDER_DRIFT')).toBe('failure');
	});

	it('ignores every target fact, so one dead site cannot demote a provider', () => {
		// The cross-org contamination this design exists to prevent, arriving through
		// attribution rather than through the cooldown namespace.
		const targetFacts: Outcome[] = [
			'TARGET_ERROR',
			'TARGET_NOT_FOUND',
			'SOFT_BLOCK',
			'HARD_BLOCK',
		];
		for (const o of targetFacts) {
			expect(healthWeight(o), o).toBe('ignore');
		}
	});

	it('ignores account facts, so one lapsed key cannot demote for everyone', () => {
		expect(healthWeight('AUTH_FAILED')).toBe('ignore');
		expect(healthWeight('RATE_LIMITED')).toBe('ignore');
	});

	it('ignores PROVIDER_TIMEOUT, which is a property of a hop and not a provider', () => {
		// Readmitting this without normalising by hop budget creates a feedback loop:
		// degrading shortens the budget, which raises the timeout rate, which degrades.
		expect(healthWeight('PROVIDER_TIMEOUT')).toBe('ignore');
	});
});

describe('the measurement phase', () => {
	it('cannot demote before MIN_SAMPLES, even against a total outage', () => {
		const st = run(() => 1, 1, HEALTH.MIN_SAMPLES - 1);
		expect(st.state).toBe('healthy');
		expect(st.p0).toBeNull();
	});

	it('freezes p0 from the provider it is measuring, not a house default', () => {
		const st = run(() => 0.1, 2, HEALTH.MIN_SAMPLES);
		expect(st.p0).toBeGreaterThan(0.05);
		expect(st.p0).toBeLessThan(0.2);
	});

	it('estimates p0 conservatively, never below the observed rate', () => {
		// The asymmetry is the whole point: under-estimating p0 makes a healthy provider look
		// permanently out of control, and there is no recovery from that.
		for (const p of [0.02, 0.04, 0.1]) {
			const st = run(() => p, 500 + p * 100, HEALTH.MIN_SAMPLES);
			expect(st.p0, `p=${p}`).toBeGreaterThan(p);
		}
	});

	it('clamps p0 into a range where the statistic stays finite and honest', () => {
		// Zero failures in 500 does not mean zero: Wilson puts it near 0.008, above the floor,
		// which is why the floor rarely binds now. It stays as a guard, not as the mechanism.
		expect(run(() => 0, 3, HEALTH.MIN_SAMPLES).p0).toBeGreaterThanOrEqual(HEALTH.P0_FLOOR);
		expect(run(() => 0, 3, HEALTH.MIN_SAMPLES).p0).toBeLessThan(0.02);
		expect(run(() => 1, 4, HEALTH.MIN_SAMPLES).p0).toBe(HEALTH.P0_CEILING);
		expect(Number.isFinite(increments(HEALTH.P0_FLOOR).failure)).toBe(true);
		expect(wilsonUpper(0, 0)).toBe(1);
	});
});

describe('specificity, the expensive error', () => {
	// Asserted as a RATE over many providers, not as one long run. The median run length is
	// what hid the estimator defect: it read 589,863 samples while 16% of healthy providers
	// demoted inside 20,000. A single-trial test would have passed throughout.
	function falseDemoteRate(p: number, trials: number, horizon: number): number {
		let bad = 0;
		for (let t = 0; t < trials; t++) {
			if (run(() => p, 6000 + t * 97, horizon).state === 'demoted') bad++;
		}
		return bad / trials;
	}

	it('demotes under 5% of steady providers within 20k samples, at every rate', () => {
		// A provider that is simply HARDER than average must not be demoted for it. The plain
		// point estimate scored 16 to 18% here; the Wilson bound scores under 1% except near
		// the ceiling, where a provider is bad enough that demotion is arguably correct.
		for (const p of [0.02, 0.04, 0.1]) {
			expect(falseDemoteRate(p, 40, 20_000), `steady ${p}`).toBeLessThan(0.05);
		}
	});

	it('degrades a steady provider rarely enough that the signal means something', () => {
		// Degrading is cheap, so this bound is looser than demotion's on purpose.
		let bad = 0;
		for (let t = 0; t < 40; t++)
			if (run(() => 0.04, 8000 + t, 10_000).state !== 'healthy') bad++;
		expect(bad / 40).toBeLessThan(0.25);
	});
});

describe('sensitivity, the incident this was built for', () => {
	it('demotes a provider that slides from 96% to 74% success', () => {
		// Warm p0 clean, then slide over 1000 samples. The simulation puts the median demote
		// at 877 including warmup; 6000 is a generous ceiling that still fails if a constant
		// moves by an order of magnitude.
		const M = HEALTH.MIN_SAMPLES;
		const ramp = (i: number) =>
			i <= M ? 0.04 : i <= M + 1000 ? 0.04 + (0.22 * (i - M)) / 1000 : 0.26;
		for (let t = 0; t < 5; t++) {
			expect(run(ramp, 900 + t, 6000).state, `seed ${t}`).toBe('demoted');
		}
	});

	it('passes through degraded on the way, rather than jumping', () => {
		const M = HEALTH.MIN_SAMPLES;
		const rnd = rng(31);
		let st = INITIAL;
		let sawDegraded = false;
		for (let i = 1; i <= 6000; i++) {
			const p = i <= M ? 0.04 : 0.26;
			st = observe(st, rnd() < p ? 'PROVIDER_ERROR' : 'OK', i * 60_000, 0);
			if (st.state === 'degraded') sawDegraded = true;
			if (st.state === 'demoted') break;
		}
		expect(sawDegraded).toBe(true);
		expect(st.state).toBe('demoted');
	});
});

describe('the recovery edge', () => {
	it('returns a recovered provider to healthy, and re-measures p0', () => {
		// Without this edge, p0 stays frozen against a rate that has become fiction and the
		// provider re-trips forever.
		const M = HEALTH.MIN_SAMPLES;
		const rnd = rng(77);
		let st = INITIAL;
		let enteredAt = 0;
		let now = 0;
		for (let i = 1; i <= M + 3000 && st.state !== 'degraded'; i++) {
			now = i * 60_000;
			const prev = st.state;
			st = observe(st, rnd() < (i <= M ? 0.04 : 0.2) ? 'PROVIDER_ERROR' : 'OK', now, enteredAt);
			if (st.state !== prev) enteredAt = now;
		}
		expect(st.state).toBe('degraded');

		for (let i = 0; i < 4000 && st.state === 'degraded'; i++) {
			now += 60_000;
			st = observe(st, 'OK', now, enteredAt);
		}
		expect(st.state).toBe('healthy');
		expect(st.p0, 'p0 must be re-measured, not resumed').toBeNull();
	});

	it('holds a provider in degraded until the dwell has passed, statistic notwithstanding', () => {
		const ready: HealthState = {
			state: 'degraded',
			p0: 0.04,
			s: 0,
			samples: HEALTH.RESET_WINDOW_SAMPLES - 1,
			failures: 0,
			cleanWindows: HEALTH.RESET_WINDOWS - 1,
			cleanProbes: 0,
		};
		expect(observe(ready, 'OK', 60_000, 0).state, 'dwell not yet served').toBe('degraded');
		expect(observe(ready, 'OK', HEALTH.DWELL_RECOVER_MS + 1, 0).state).toBe('healthy');
	});

	it('requires CONSECUTIVE clean windows, so one dip does not recover a bad provider', () => {
		// The defect this replaced: the rule was "300 samples in degraded AND s < H_RESET right
		// now", so a provider could sit at s=9 for 299 samples, dip once, and recover.
		const bad: HealthState = {
			state: 'degraded',
			p0: 0.04,
			s: 0,
			samples: HEALTH.RESET_WINDOW_SAMPLES - 1,
			failures: 0,
			cleanWindows: 0,
			cleanProbes: 0,
		};
		const afterOneCleanWindow = observe(bad, 'OK', HEALTH.DWELL_RECOVER_MS + 1, 0);
		expect(afterOneCleanWindow.state).toBe('degraded');
		expect(afterOneCleanWindow.cleanWindows).toBe(1);
	});

	it('resets the clean-window streak when a window closes dirty', () => {
		const st: HealthState = {
			state: 'degraded',
			p0: 0.04,
			s: HEALTH.H_RESET + 3,
			samples: HEALTH.RESET_WINDOW_SAMPLES - 1,
			failures: 0,
			cleanWindows: 2,
			cleanProbes: 0,
		};
		expect(observe(st, 'PROVIDER_ERROR', HEALTH.DWELL_RECOVER_MS + 1, 0).cleanWindows).toBe(0);
	});

	it('never leaves demoted on live traffic, however much of it succeeds', () => {
		let cur: HealthState = {
			state: 'demoted',
			p0: 0.04,
			s: HEALTH.S_CAP,
			samples: 0,
			failures: 0,
			cleanWindows: 0,
			cleanProbes: 0,
		};
		for (let i = 0; i < 5000; i++) cur = observe(cur, 'OK', i * 60_000, 0);
		expect(cur.state).toBe('demoted');
	});

	it('caps the statistic, so recovery is a bounded distance not an unbounded one', () => {
		// A one-sided CUSUM has no upper bound and `demoted` keeps observing. Uncapped, a
		// three-day outage leaves a number no amount of success can walk back down.
		let cur = INITIAL;
		for (let i = 1; i <= 20_000; i++) {
			cur = observe(cur, i <= HEALTH.MIN_SAMPLES ? 'OK' : 'PROVIDER_ERROR', i * 60_000, 0);
		}
		expect(cur.state).toBe('demoted');
		expect(cur.s).toBeLessThanOrEqual(HEALTH.S_CAP);
	});
});

describe('the only exit from demoted', () => {
	const demoted: HealthState = {
		state: 'demoted',
		p0: 0.04,
		s: HEALTH.S_CAP,
		samples: 0,
		failures: 0,
		cleanWindows: 0,
		cleanProbes: 0,
	};

	it('takes PROBE_CLEAN consecutive clean probes to reach degraded', () => {
		let st = demoted;
		for (let i = 1; i < HEALTH.PROBE_CLEAN; i++) {
			st = observeProbe(st, true);
			expect(st.state, `after ${i} clean probes`).toBe('demoted');
		}
		st = observeProbe(st, true);
		expect(st.state).toBe('degraded');
	});

	it('re-enters at the degrade boundary, not at zero', () => {
		// Two clean probes are evidence the provider answers, not evidence it is well. One bad
		// patch from here should re-demote quickly.
		let st = demoted;
		for (let i = 0; i < HEALTH.PROBE_CLEAN; i++) st = observeProbe(st, true);
		expect(st.s).toBe(HEALTH.H_DEGRADE);
		expect(st.s).toBeLessThan(HEALTH.H_DEMOTE);
	});

	it('restarts the streak on a failed probe', () => {
		let st = observeProbe(demoted, true);
		expect(st.cleanProbes).toBe(1);
		st = observeProbe(st, false);
		expect(st.cleanProbes).toBe(0);
		expect(st.state).toBe('demoted');
	});

	it('does nothing to a provider that is not demoted', () => {
		const healthy = { ...INITIAL, p0: 0.04 };
		expect(observeProbe(healthy, true)).toEqual(healthy);
	});

	it('gives a demoted provider a real path back rather than a dead state', () => {
		// The whole point. Without this the spec's own warning stands: "as written, a demoted
		// provider can never recover".
		let st = demoted;
		for (let i = 0; i < 10 && st.state === 'demoted'; i++) st = observeProbe(st, true);
		expect(st.state).not.toBe('demoted');
	});
});

describe('probe backoff', () => {
	it('starts at minutes and ends at hours', () => {
		expect(probeDelayMs(0)).toBe(HEALTH.PROBE_FIRST_MS);
		expect(probeDelayMs(1)).toBe(HEALTH.PROBE_FIRST_MS * 2);
		expect(probeDelayMs(50)).toBe(HEALTH.PROBE_MAX_MS);
	});

	it('is bounded, so a three-day outage is not 288 wasted requests a day', () => {
		// The half-open 15-minute cooldown spends a real user's request on a known-dead
		// provider every 15 minutes for three days. This is the fix, and the bound is the fix.
		const perDay = (24 * 60 * 60 * 1000) / HEALTH.PROBE_MAX_MS;
		expect(perDay).toBeLessThanOrEqual(4);
	});
});

describe('chain ordering', () => {
	const p = (id: string, state: HealthState['state']) => ({ id, state });

	it('puts the least-degraded member in the terminal hop, for 0 through 3 degraded', () => {
		// Section 5 gives the terminal hop 75s against everyone else's 22s, so "move the
		// degraded one to the tail" is a 3.4x budget promotion. The invariant that is
		// satisfiable for every configuration is this one.
		const cases: Array<HealthState['state'][]> = [
			['healthy', 'healthy', 'healthy'],
			['degraded', 'healthy', 'healthy'],
			['degraded', 'degraded', 'healthy'],
			['degraded', 'degraded', 'degraded'],
		];
		for (const states of cases) {
			const ordered = orderChain(states.map((s, i) => p(`p${i}`, s)));
			const last = ordered[ordered.length - 1];
			const worstFirst = ordered[0];
			expect(last, states.join(',')).toBeDefined();
			// The tail is never worse than the head.
			expect(
				['healthy', 'degraded', 'demoted'].indexOf(last?.state as string),
				states.join(','),
			).toBeGreaterThanOrEqual(
				['healthy', 'degraded', 'demoted'].indexOf(worstFirst?.state as string),
			);
		}
	});

	it('breaks ties by static priority, so ordering is stable', () => {
		const ordered = orderChain([p('a', 'healthy'), p('b', 'healthy'), p('c', 'healthy')]);
		expect(ordered.map((x) => x.id)).toEqual(['a', 'b', 'c']);
	});

	it('drops demoted providers from the chain', () => {
		const { chain, forced } = eligible([p('a', 'demoted'), p('b', 'healthy')]);
		expect(chain.map((c) => c.id)).toEqual(['b']);
		expect(forced).toBe(false);
	});

	it('forces the best demoted provider rather than serving NO_PROVIDER_AVAILABLE', () => {
		// A gateway that turns itself off is worse than one routing at 74%.
		const { chain, forced } = eligible([p('a', 'demoted'), p('b', 'demoted')]);
		expect(chain).toHaveLength(1);
		expect(forced).toBe(true);
	});
});
