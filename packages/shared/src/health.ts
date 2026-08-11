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

import type { Outcome } from './outcome.js';

/** Everything the statistic needs. Updated atomically, so a Lua script rather than INCR. */
export interface HealthState {
	readonly state: 'healthy' | 'degraded' | 'demoted';
	/** Frozen in-control failure rate. `null` until MIN_SAMPLES observations exist. */
	readonly p0: number | null;
	/** The CUSUM statistic. Never negative, never above S_CAP. */
	readonly s: number;
	/** Observations while `p0` is being measured, or within the current recovery window. */
	readonly samples: number;
	/** Failures within those samples. Only meaningful while `p0` is null. */
	readonly failures: number;
	/** Consecutive recovery windows closed below H_RESET. Only meaningful in `degraded`. */
	readonly cleanWindows: number;
	/** Consecutive clean probes. Only meaningful in `demoted`. */
	readonly cleanProbes: number;
	/**
	 * When the current state was entered, epoch ms. `DWELL_RECOVER_MS` is measured from here.
	 *
	 * Part of the state rather than a parameter, and that is the correction: `observe` used to
	 * take it separately, which meant the record in Valkey had to carry a field this type did
	 * not declare. Whoever wrote the Lua script would have had to know that from reading the
	 * call site. A state machine whose persisted shape is wider than its type is one that
	 * round-trips wrong exactly once, in production, on the recovery edge.
	 */
	readonly enteredAt: number;
}

/**
 * A provider nothing has been observed about yet.
 *
 * A function rather than a constant because `enteredAt` is a clock reading, and a shared
 * frozen object would hand every provider the timestamp of process start.
 */
export function initial(now: number): HealthState {
	return {
		state: 'healthy',
		p0: null,
		s: 0,
		samples: 0,
		failures: 0,
		cleanWindows: 0,
		cleanProbes: 0,
		enteredAt: now,
	};
}

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
	/**
	 * A one-sided CUSUM has no upper bound, and `demoted` keeps observing. Without a cap the
	 * statistic runs away during an outage and a recovered provider would need thousands of
	 * clean requests to walk it back down. Capping it makes recovery a bounded distance.
	 */
	S_CAP: 20,
	/** The statistic must be below this at a window close for that window to count as clean. */
	H_RESET: 2,
	/**
	 * CONSECUTIVE windows below H_RESET required to return to healthy, and the observations
	 * per window. Consecutive, not cumulative: an earlier version required only 300 total
	 * samples in `degraded` plus `s < H_RESET` at that instant, so a provider could sit at
	 * s=9 for 299 samples, dip once, and recover. The constant was named for windows and the
	 * code counted samples.
	 */
	RESET_WINDOWS: 3,
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
 *
 * HOW MUCH OF THAT IS ENFORCED, precisely, because an earlier version of this comment
 * claimed "the conformance suite keeps that true for a fourth adapter" and it did not.
 *
 *   TARGET_ERROR      enforced. `target-error` is a required fixture category and
 *                     conformance asserts the outcome it must produce.
 *   PROVIDER_ERROR    NOT enforced, and structurally cannot be. It needs a provider 5xx,
 *                     which you cannot summon on demand any more than you can summon a
 *                     Cloudflare challenge — the same gap `/detect`'s corpus has. A
 *                     `provider-error` fixture is honoured if one is ever captured.
 *
 * So the failure term of this statistic rests on an adapter author mapping a provider 5xx
 * correctly, checked by review rather than by CI. Said out loud because the alternative is
 * a reader assuming the green board covers it.
 *
 * `PROVIDER_TIMEOUT` is deliberately absent. It is not a property of a provider but of a
 * provider AT A HOP: section 5 gives a non-terminal attempt 22s and a terminal one 75s.
 * Degrading a provider moves it down the chain, which shortens its budget, which raises its
 * timeout rate, which feeds the statistic that demoted it. A feedback loop against a frozen
 * baseline. The cost is real and stated: a provider dying purely by slow-then-timeout is
 * caught late. Phase 2 can readmit it normalised by hop budget.
 */
export const HEALTH_SUCCESS: readonly Outcome[] = ['OK'];
export const HEALTH_FAILURE: readonly Outcome[] = ['PROVIDER_ERROR', 'PROVIDER_DRIFT'];

/**
 * Does this outcome move the statistic, and in which direction?
 *
 * Typed on `Outcome` rather than `string`, so a misspelled member is a compile error rather
 * than a silent `ignore`. `ignore` is the answer that never looks wrong, which makes it the
 * dangerous default: an outcome that quietly stopped feeding the statistic reads exactly
 * like an outcome that was never meant to.
 */
export function healthWeight(outcome: Outcome): 'success' | 'failure' | 'ignore' {
	if (HEALTH_SUCCESS.includes(outcome)) return 'success';
	if (HEALTH_FAILURE.includes(outcome)) return 'failure';
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
export function observe(prev: HealthState, outcome: Outcome, now: number): HealthState {
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
		// Not a state change: the provider was `healthy` throughout measurement and still is,
		// so `enteredAt` is carried, not reset. Resetting it here would restart the dwell clock
		// on a transition that never happened.
		return { ...initial(prev.enteredAt), p0 };
	}

	const inc = increments(prev.p0);
	const s = Math.min(HEALTH.S_CAP, Math.max(0, prev.s + (failed ? inc.failure : inc.success)));
	const samples = prev.samples + 1;
	const next = {
		...prev,
		s,
		samples,
		failures: prev.failures + (failed ? 1 : 0),
	};

	// Live traffic never lifts a demoted provider. Only `observeProbe` does. It still moves
	// the statistic, because a forced attempt under the floor is real evidence.
	if (prev.state === 'demoted') return next;

	if (s >= HEALTH.H_DEMOTE) {
		return {
			...next,
			state: 'demoted',
			samples: 0,
			failures: 0,
			cleanWindows: 0,
			cleanProbes: 0,
			enteredAt: now,
		};
	}
	if (s >= HEALTH.H_DEGRADE && prev.state === 'healthy') {
		return {
			...next,
			state: 'degraded',
			samples: 0,
			failures: 0,
			cleanWindows: 0,
			enteredAt: now,
		};
	}
	if (prev.state !== 'degraded' || samples < HEALTH.RESET_WINDOW_SAMPLES) return next;

	// A recovery window just closed. Consecutive, not cumulative: a single dip below H_RESET
	// after a long bad stretch is noise, not recovery.
	const cleanWindows = s < HEALTH.H_RESET ? prev.cleanWindows + 1 : 0;
	const closed = { ...next, samples: 0, failures: 0, cleanWindows };

	// degraded -> healthy. Without this edge the first provider that ever degrades keeps its
	// baseline frozen against a rate that has since become fiction, and a one-sided statistic
	// against a stale-high p0 re-trips forever.
	if (cleanWindows >= HEALTH.RESET_WINDOWS && now - prev.enteredAt >= HEALTH.DWELL_RECOVER_MS) {
		// p0 is re-measured rather than resumed: the pre-incident value described a provider
		// that no longer exists.
		//
		// The cost is stated because it is not free: for the next MIN_SAMPLES observations
		// this provider has no statistic and cannot be demoted, so a provider that recovers
		// and immediately relapses is invisible for that window. The alternative is carrying
		// a baseline measured before an incident the provider has since been through, which
		// is a number about a provider that no longer exists.
		return initial(now);
	}
	return closed;
}

/**
 * Fold a background PROBE result into the state. The only exit from `demoted`.
 *
 * Separate from `observe` on purpose. Recovery must never ride on a user's request: the
 * half-open cooldown in section 3 spends a real request on a known-dead provider every 15
 * minutes, which is right for a transient block and actively harmful across a three-day
 * outage. A probe is ours, it is scheduled on `probeDelayMs`, and nobody is waiting on it.
 */
export function observeProbe(prev: HealthState, ok: boolean, now: number): HealthState {
	if (prev.state !== 'demoted') return prev;
	if (!ok) return { ...prev, cleanProbes: 0 };
	const cleanProbes = prev.cleanProbes + 1;
	if (cleanProbes < HEALTH.PROBE_CLEAN) return { ...prev, cleanProbes };
	// Back to `degraded`, not to `healthy`, and re-entering AT the degrade boundary rather
	// than at zero. Two clean probes are evidence the provider answers, not evidence it is
	// well. From here one bad patch re-demotes quickly and a genuinely recovered provider
	// walks the statistic down through the normal window process.
	return {
		...prev,
		state: 'degraded',
		s: HEALTH.H_DEGRADE,
		samples: 0,
		failures: 0,
		cleanWindows: 0,
		cleanProbes: 0,
		enteredAt: now,
	};
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
