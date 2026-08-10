// Per-attempt budget arithmetic. Pure, and the whole failover chain rests on it.
//
// `integrations.md` section 5 works through why the obvious rule is wrong. With
// `min(provider maxTimeout, remaining)`, ScraperAPI's 75s per-attempt budget against a 90s
// global deadline means a timeout on attempt 1 consumes 75 of 90; attempt 2 gets 15s —
// enough to fail, not enough to succeed on a hard target — and attempt 3 gets nothing and
// returns BUDGET_EXCEEDED. Shipped defaults degraded to roughly 1.5 attempts, on exactly
// the failure the chain exists for, and put the README's three-provider claim out of reach.
//
// So each attempt RESERVES time for the hops behind it.

/**
 * Below this, an attempt cannot plausibly succeed against a hard target, and opening a
 * connection only burns the deadline that the next hop needs.
 */
export const MIN_USEFUL_ATTEMPT_MS = 8_000;

export interface HopBudget {
	readonly kind: 'attempt';
	readonly perAttemptMs: number;
}
export interface NoBudget {
	readonly kind: 'exhausted';
	readonly reason: string;
}

/**
 * How long this attempt may take.
 *
 * @param remainingMs  what is left of the caller's global deadline
 * @param hopsLeft     hops remaining AFTER this one
 * @param cap          provider.fastTimeoutMs, or maxTimeoutMs on the terminal hop
 */
export function hopBudget(
	remainingMs: number,
	hopsLeft: number,
	cap: number,
): HopBudget | NoBudget {
	if (remainingMs < MIN_USEFUL_ATTEMPT_MS) {
		// Refuse rather than open a connection that cannot finish. A doomed attempt is worse
		// than none: it spends money, and on a chargeable outcome it spends the user's.
		return {
			kind: 'exhausted',
			reason: `${remainingMs}ms left, below the ${MIN_USEFUL_ATTEMPT_MS}ms floor`,
		};
	}
	const reserve = hopsLeft * MIN_USEFUL_ATTEMPT_MS;
	const available = remainingMs - reserve;
	// clamp(min(cap, available), MIN_USEFUL_ATTEMPT_MS, cap). The lower clamp is what lets a
	// chain finish at all: when the reserve eats everything, this hop still gets the floor
	// rather than zero, and the LAST hop — hopsLeft 0, so no reserve — gets the remainder.
	const perAttemptMs = Math.max(MIN_USEFUL_ATTEMPT_MS, Math.min(cap, available));
	return { kind: 'attempt', perAttemptMs: Math.min(perAttemptMs, cap) };
}
