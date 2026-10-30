// Request-rate limits per caller. The hosted gateway's, first: `plan.md` section 2 limits by
// source address before a token is opened, and by provider key after.
//
// `operations.md` section 5 has asked for "per key, per IP, per org" limits since the scaffold.
// Self-host never needed them, because it has one caller and `InflightLimiter` bounds the
// process. Hosted has strangers, and the global ceiling alone lets one of them take every slot.
//
// A FIXED WINDOW, not a token bucket, deliberately. One counter per key and window is one INCR in
// Valkey and one map entry here, and the known weakness, up to twice the limit across a window
// boundary, is a burst of a few seconds that the in-flight ceiling still bounds. A bucket buys
// smoothness this gateway has no use for and costs a read-modify-write per request.
//
// NEVER FAILS CLOSED, like every store this gateway reads on the request path (`integrations.md`
// section 3): a limit that went down with Valkey and refused everyone would turn a cache outage
// into a full one. Nor fully open: `ValkeyRateLimiter` counts in memory until Valkey is back.

export interface RateLimit {
	/** Requests allowed per window. */
	readonly limit: number;
	readonly windowMs: number;
}

export type RateDecision =
	| { readonly ok: true }
	/** `retryAfterMs` is the time left in the window: when the next request will be counted fresh. */
	| { readonly ok: false; readonly retryAfterMs: number };

export interface RateLimiter {
	readonly rate: RateLimit;
	/** Count one request against `key`, and say whether it is within the limit. Never rejects. */
	take(key: string, now: number): Promise<RateDecision>;
}

/** Refuses a nonsense limit at construction, so a typo fails the boot rather than every request. */
export function checkRate(rate: RateLimit, what: string): RateLimit {
	if (!Number.isInteger(rate.limit) || rate.limit < 1) {
		throw new RangeError(`${what} must be a whole number of requests, at least 1`);
	}
	if (!Number.isInteger(rate.windowMs) || rate.windowMs < 1000) {
		throw new RangeError(`${what} needs a window of at least a second`);
	}
	return rate;
}

/** The window a moment falls in, aligned so every key and every replica agree on its edges. */
export function windowStart(now: number, windowMs: number): number {
	return now - (now % windowMs);
}

/**
 * One process's counters. Right for self-host and for a single hosted replica; more than one
 * replica needs `ValkeyRateLimiter`, or each enforces its own copy of the limit.
 *
 * ONE MAP PER WINDOW, dropped whole when the window rolls over. Windows are aligned, so every key
 * in the map belongs to the current one, and a new window is a new empty map: O(1) per request
 * however many callers there are. The first version swept a single map when it got large, and a
 * flood of distinct addresses made every request scan a hundred thousand entries that were all
 * still live. Memory is bounded by the callers one window sees, which is the best a limiter that
 * must not refuse strangers it has never seen can do.
 */
export class InMemoryRateLimiter implements RateLimiter {
	readonly rate: RateLimit;
	#start = -1;
	#counts = new Map<string, number>();

	constructor(rate: RateLimit) {
		this.rate = checkRate(rate, 'a rate limit');
	}

	async take(key: string, now: number): Promise<RateDecision> {
		const start = windowStart(now, this.rate.windowMs);
		if (start !== this.#start) {
			// A request from a window already behind us, which only a clock step backwards makes,
			// is counted in the current map rather than resetting it.
			if (start > this.#start) this.#counts = new Map();
			this.#start = Math.max(start, this.#start);
		}
		const count = (this.#counts.get(key) ?? 0) + 1;
		this.#counts.set(key, count);
		return count <= this.rate.limit
			? { ok: true }
			: { ok: false, retryAfterMs: this.#start + this.rate.windowMs - now };
	}

	/** Keys currently held. For the test that pins the rollover. */
	get size(): number {
		return this.#counts.size;
	}
}
