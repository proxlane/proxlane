// Provider health: is this provider worse than it usually is?
//
// A different question from the routing scoreboard, which asks "which provider is best for
// this domain" and is phase 3. This one is self-referential: each provider against its own
// recent past. No cross-provider join, no rollup.
//
// WHY THIS EXISTS. A provider slid from 96% success to 74% over hours, then died for three
// days. Every cooldown trigger in `integrations.md` section 3 is a single request's outcome,
// so nothing tripped: at 74% no individual attempt says "this is dying", only the rate does.
//
// WHY A FROZEN BASELINE AND NOT TWO EWMAs. A fast window against a slow live baseline is the
// obvious design and it degrades exactly when it matters, because the baseline chases the
// slide. Measured, at a 20k-sample half-life:
//
//     ramp length    of a real 0.22 drop, the EWMA saw
//      1,000          0.217   (1% lost)
//      20,000         0.160   (27% lost)
//      120,000        0.055   (75% lost)
//
// The slower the decay, the less of it a live baseline can see. That is the case this was
// built for. `scripts/health-sim.ts` reproduces the table.
//
// TWO THINGS THAT NEARLY SHIPPED WRONG, both caught by simulation rather than by review.
//
// 1. An earlier design bootstrapped `p0` to a house default for providers with no history.
//    A provider genuinely running at 10% failure against a 5% bootstrap was falsely DEMOTED
//    after a median of 430 samples. A provider that is simply harder than average is not a
//    provider that is failing, and a fixed bootstrap cannot tell them apart. `p0` is now
//    measured from the provider's own history.
//
// 2. Measuring it as a plain rate was still wrong, and the failure was invisible in the
//    median. Estimated from 500 samples at a true 4%, `p0` lands below 0.028 about 7% of the
//    time; the provider then sits permanently above its own baseline and the statistic
//    ratchets. 16% of HEALTHY providers demoted within 20k samples while the median run
//    length read 589,863 — the median is the wrong statistic for a false-alarm rate, and it
//    said the design was fine. Taking the WILSON UPPER BOUND instead of the point estimate
//    drops that to under 1% and costs four samples of detection delay:
//
//        estimator             false demote in 20k, healthy provider at 2/4/10/20%
//        plain rate            18.3%  16.3%  16.3%  17.3%
//        wilson upper bound     0.0%   0.0%   0.3%   3.0%
//
//    Being wrong about `p0` in the low direction is unrecoverable; being wrong high only
//    costs sensitivity. The estimator is deliberately asymmetric for that reason.

/** Everything the statistic needs. Five fields, updated atomically, so a Lua script. */
export interface HealthState {
	readonly state: 'healthy' | 'degraded' | 'demoted';
	/** Frozen in-control failure rate. `null` until MIN_SAMPLES observations exist. */
	readonly p0: number | null;
	/** The CUSUM statistic. Never negative. */
	readonly s: number;
	/** Observations seen while `p0` was still being measured, or since entering this state. */
	readonly samples: number;
	/** Failures within those samples. Only meaningful while `p0` is null. */
	readonly failures: number;
}

export const INITIAL: HealthState = {
	state: 'healthy',
	p0: null,
	s: 0,
	samples: 0,
	failures: 0,
};

/**
 * Pinned constants. Every one is reproduced by `scripts/health-sim.ts`, which runs the
 * functions in this file rather than a copy of them, so the numbers cannot drift from the
 * code they describe.
 */
export const HEALTH = {
	/**
	 * Observations before `p0` is frozen and the statistic starts. Below this the provider is
	 * `healthy` by definition and cannot be demoted. 500 measured better than 200 or 1000:
	 * 200 leaves `p0` noisy enough to matter, 1000 buys nothing.
	 */
	MIN_SAMPLES: 500,
	/**
	 * `p0` is clamped into this range. The floor keeps `log(p1/p0)` finite when a provider
	 * had zero failures in its first 500. The ceiling is a provider we should not be routing
	 * to at all; clamping rather than trusting it stops a catastrophic first 500 from
	 * granting permanent immunity.
	 */
	P0_FLOOR: 0.005,
	P0_CEILING: 0.25,
	/**
	 * z for the Wilson upper bound on `p0`. 1.96 is the 95% one-sided-ish bound and is what
	 * the table above was measured at. Raising it buys specificity and costs sensitivity;
	 * do not change it without rerunning `scripts/health-sim.ts`.
	 */
	P0_Z: 1.96,
	/**
	 * The out-of-control rate, as a multiple of the provider's own `p0`. A multiple rather
	 * than an absolute drop is what stops a legitimately hard provider being flagged forever.
	 */
	P1_MULTIPLE: 3,
	/** Move down the chain. A false positive here costs a reordering, so it can be low. */
	H_DEGRADE: 7,
	/** Out of rotation. A false positive here removes a provider, so it is deliberately far. */
	H_DEMOTE: 10,
	/** The statistic must fall below this before recovery starts counting. */
	H_RESET: 2,
	/** Consecutive windows below H_RESET required to return to healthy. */
	RESET_WINDOWS: 3,
	/** Observations per reset window. */
	RESET_WINDOW_SAMPLES: 100,
	/** Minimum time in `degraded` before `healthy` is reachable, regardless of the statistic. */
	DWELL_RECOVER_MS: 30 * 60 * 1000,
	/** Probe backoff while demoted: first delay, multiplier, ceiling. */
	PROBE_FIRST_MS: 5 * 60 * 1000,
	PROBE_MULTIPLIER: 2,
	PROBE_MAX_MS: 6 * 60 * 60 * 1000,
	/** Consecutive clean probes to leave `demoted`. */
	PROBE_CLEAN: 2,
} as const;

/**
 * Which outcomes feed the statistic.
 *
 * Attribution is per-outcome, and that is only correct because every adapter already
 * discharges the provider-specific part in `parse`. All three launch providers can tell a
 * target failure from their own (`sa-statuscode`, `spb-initial-status-code`, Scrapfly's
 * `result` key), so by the time an `Outcome` exists the question "whose fault" is answered.
 * The conformance suite is what keeps that true for a fourth adapter.
 *
 * `PROVIDER_TIMEOUT` is deliberately absent. It is not a property of a provider but of a
 * provider AT A HOP: section 5 gives a non-terminal attempt 22s and a terminal one 75s.
 * Degrading a provider moves it down the chain, which shortens its budget, which raises its
 * timeout rate, which feeds the statistic that demoted it. A feedback loop against a frozen
 * baseline. The cost is real and stated: a provider dying purely by slow-then-timeout is
 * caught late. Phase 2 can readmit it normalised by hop budget.
 */
export const HEALTH_SUCCESS = ['OK'] as const;
export const HEALTH_FAILURE = ['PROVIDER_ERROR', 'PROVIDER_DRIFT'] as const;

/** Does this outcome move the statistic at all, and in which direction? */
export function healthWeight(outcome: string): 'success' | 'failure' | 'ignore' {
	if ((HEALTH_SUCCESS as readonly string[]).includes(outcome)) return 'success';
	if ((HEALTH_FAILURE as readonly string[]).includes(outcome)) return 'failure';
	return 'ignore';
}

/**
 * Wilson score interval, upper bound. A conservative estimate of the failure rate given
 * `failures` in `samples`.
 *
 * Used instead of `failures / samples` because the two errors are not symmetric. An
 * under-estimated `p0` makes a healthy provider look permanently out of control and there is
 * no recovery from it; an over-estimated one only delays detection. Wilson behaves at small
 * counts where the normal approximation does not, which is the regime a low-failure provider
 * lives in.
 */
export function wilsonUpper(
	failures: number,
	samples: number,
	z: number = HEALTH.P0_Z,
): number {
	if (samples === 0) return 1;
	const p = failures / samples;
	const z2 = z * z;
	const denom = 1 + z2 / samples;
	const centre = p + z2 / (2 * samples);
	const margin = z * Math.sqrt((p * (1 - p)) / samples + z2 / (4 * samples * samples));
	return (centre + margin) / denom;
}

/** Bernoulli CUSUM log-likelihood-ratio increments. */
export function increments(p0: number): { readonly failure: number; readonly success: number } {
	const p1 = Math.min(0.95, p0 * HEALTH.P1_MULTIPLE);
	return {
		failure: Math.log(p1 / p0),
		success: Math.log((1 - p1) / (1 - p0)),
	};
}

/**
 * Fold one observation into the state.
 *
 * Pure, and takes `now` rather than reading a clock, so the simulation and the tests drive
 * it deterministically. The Lua script is a transcription of this, not a second design.
 */
export function observe(
	prev: HealthState,
	outcome: string,
	now: number,
	enteredAt: number,
): HealthState {
	const w = healthWeight(outcome);
	if (w === 'ignore') return prev;
	const failed = w === 'failure';

	// Still measuring. No statistic, no demotion, and that is the point: an unmeasured
	// provider is one we have no opinion about, not one we assume is average.
	if (prev.p0 === null) {
		const samples = prev.samples + 1;
		const failures = prev.failures + (failed ? 1 : 0);
		if (samples < HEALTH.MIN_SAMPLES) return { ...prev, samples, failures };
		const measured = wilsonUpper(failures, samples);
		const p0 = Math.min(HEALTH.P0_CEILING, Math.max(HEALTH.P0_FLOOR, measured));
		return { state: 'healthy', p0, s: 0, samples: 0, failures: 0 };
	}

	const inc = increments(prev.p0);
	const s = Math.max(0, prev.s + (failed ? inc.failure : inc.success));
	const samples = prev.samples + 1;
	const next = { ...prev, s, samples, failures: prev.failures + (failed ? 1 : 0) };

	if (prev.state === 'demoted') return next;

	if (s >= HEALTH.H_DEMOTE) return { ...next, state: 'demoted', samples: 0, failures: 0 };
	if (s >= HEALTH.H_DEGRADE && prev.state === 'healthy') {
		return { ...next, state: 'degraded', samples: 0, failures: 0 };
	}
	// degraded -> healthy. Without this edge the first provider that ever degrades keeps its
	// baseline frozen against a rate that has since become fiction, and a one-sided statistic
	// against a stale-high p0 re-trips forever.
	if (
		prev.state === 'degraded' &&
		s < HEALTH.H_RESET &&
		samples >= HEALTH.RESET_WINDOWS * HEALTH.RESET_WINDOW_SAMPLES &&
		now - enteredAt >= HEALTH.DWELL_RECOVER_MS
	) {
		// p0 is re-measured from the recovered window rather than resumed. The pre-incident
		// value described a provider that no longer exists.
		return { state: 'healthy', p0: null, s: 0, samples: 0, failures: 0 };
	}
	return next;
}

/** Delay before the nth probe of a demoted provider. */
export function probeDelayMs(attempt: number): number {
	const raw = HEALTH.PROBE_FIRST_MS * HEALTH.PROBE_MULTIPLIER ** Math.max(0, attempt);
	return Math.min(HEALTH.PROBE_MAX_MS, raw);
}

/**
 * Chain order for a set of providers.
 *
 * "Never put a degraded provider in the terminal hop" is unsatisfiable the moment two of
 * three are degraded, and two simultaneous degradations is exactly the correlated scenario
 * this system exists for. So rank by (state, static priority) and let position fall out. The
 * invariant that survives every configuration: THE TERMINAL HOP IS THE LEAST-DEGRADED MEMBER
 * OF THE CHAIN, which matters because section 5 gives that hop 75s against everyone else's
 * 22s. Handing the least reliable member 3.4x the budget is a promotion, not a demotion.
 */
const RANK = { healthy: 0, degraded: 1, demoted: 2 } as const;

export function orderChain<
	T extends { readonly id: string; readonly state: HealthState['state'] },
>(providers: readonly T[]): readonly T[] {
	const byPriority = new Map(providers.map((p, i) => [p.id, i]));
	return [...providers].sort(
		(a, b) =>
			RANK[a.state] - RANK[b.state] ||
			(byPriority.get(a.id) as number) - (byPriority.get(b.id) as number),
	);
}

/**
 * The floor. Section 5 filters the chain by capability first, so with three launch adapters
 * a correlated false positive empties it and returns NO_PROVIDER_AVAILABLE. A gateway that
 * turns itself off is worse than one routing at 74%.
 */
export function eligible<
	T extends { readonly id: string; readonly state: HealthState['state'] },
>(providers: readonly T[]): { readonly chain: readonly T[]; readonly forced: boolean } {
	const ordered = orderChain(providers);
	const up = ordered.filter((p) => p.state !== 'demoted');
	if (up.length > 0) return { chain: up, forced: false };
	const best = ordered[0];
	return best === undefined ? { chain: [], forced: false } : { chain: [best], forced: true };
}
