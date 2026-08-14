// `Server-Timing`, and the number the launch gate is measured against.
//
// `operations.md` section 1 asks for gateway-internal p95 under 50 ms "measured from a
// `Server-Timing: gw;dur=` header the router emits, NOT from end-to-end request time". The
// distinction is the whole point: end-to-end time is dominated by the provider, so a gate on it
// would measure ScraperAPI's afternoon rather than our routing.
//
// It is worth emitting in production for the same reason it is worth gating on. Section 1
// again: it is "the same number a user needs when they ask whether the gateway or the provider
// was slow" — a question this project otherwise answers with a shrug.

/** The subset of an attempt this needs. Structural, so `Attempt` satisfies it without import. */
export interface TimedAttempt {
	readonly upstreamMs: number;
}

export interface Timings {
	/** Everything the gateway did: routing, translate, parse, detect, cooldown bookkeeping. */
	readonly gatewayMs: number;
	/** Wall time inside provider calls, summed across every hop. */
	readonly upstreamMs: number;
	/** The handler start to finish. */
	readonly totalMs: number;
}

/**
 * Split a request's wall time into ours and theirs.
 *
 * BY SUBTRACTION, deliberately. The alternative is instrumenting every gateway segment and
 * summing them, which drifts the moment someone adds a step and forgets the timer — and it
 * fails silently, reporting a number that is too low. Subtracting measured provider time from
 * measured total time cannot miss a segment: anything unaccounted for lands in `gatewayMs`,
 * where it is visible and gets investigated.
 *
 * Clamped at zero. `totalMs` and the per-attempt figures come from separate `performance.now()`
 * readings, so rounding can make the sum a hair larger than the whole; a negative duration in a
 * header is worse than a zero.
 */
export function splitTimings(totalMs: number, attempts: readonly TimedAttempt[]): Timings {
	const upstreamMs = attempts.reduce((n, a) => n + a.upstreamMs, 0);
	return {
		gatewayMs: Math.max(0, totalMs - upstreamMs),
		upstreamMs,
		totalMs,
	};
}

/**
 * Format them as a `Server-Timing` header value.
 *
 * `up` is emitted alongside `gw` so the subtraction is auditable from the outside: a caller can
 * add them and check the total, which is what makes the gate's number trustworthy rather than
 * asserted. Durations are milliseconds per the spec, rounded to a tenth — finer is noise from
 * the timer, coarser loses the distinction between a 0.4 ms route and a 1.4 ms one.
 */
export function serverTimingHeader(t: Timings): string {
	const ms = (n: number): string => (Math.round(n * 10) / 10).toString();
	return `gw;dur=${ms(t.gatewayMs)}, up;dur=${ms(t.upstreamMs)}, total;dur=${ms(t.totalMs)}`;
}
