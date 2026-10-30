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
// FAILS OPEN, like every store this gateway reads on the request path (`integrations.md` section
// 3). A limit that went down with Valkey and refused everyone would turn a cache outage into a
// full one.

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
 * BOUNDED. Keys are source addresses and credential hashes, both chosen by callers, so the map is
 * swept of finished windows whenever it reaches `maxKeys`. Within one window it can still grow
 * past that, by as many distinct callers as arrive in it; refusing them instead would let
 * anyone with enough addresses lock everyone else out, which is worse than the memory.
 */
export class InMemoryRateLimiter implements RateLimiter {
	readonly rate: RateLimit;
	readonly #maxKeys: number;
	readonly #windows = new Map<string, { start: number; count: number }>();

	constructor(rate: RateLimit, maxKeys = 100_000) {
		this.rate = checkRate(rate, 'a rate limit');
		this.#maxKeys = maxKeys;
	}

	async take(key: string, now: number): Promise<RateDecision> {
		const start = windowStart(now, this.rate.windowMs);
		let w = this.#windows.get(key);
		if (w === undefined || w.start !== start) {
			if (w === undefined && this.#windows.size >= this.#maxKeys) this.#sweep(start);
			w = { start, count: 0 };
			this.#windows.set(key, w);
		}
		w.count++;
		return w.count <= this.rate.limit
			? { ok: true }
			: { ok: false, retryAfterMs: start + this.rate.windowMs - now };
	}

	/** Keys currently held. For the test that pins the sweep. */
	get size(): number {
		return this.#windows.size;
	}

	#sweep(current: number): void {
		for (const [k, w] of this.#windows) if (w.start !== current) this.#windows.delete(k);
	}
}
