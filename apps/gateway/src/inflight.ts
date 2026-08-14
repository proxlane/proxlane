// Backpressure: the in-flight ceiling, and the reason it sheds instead of queueing.
//
// `operations.md` section 1, verbatim: "When the in-flight count exceeds a ceiling, return 429
// with `Retry-After` rather than queueing. A proxy that queues silently becomes a latency
// black hole." That sentence is the entire design, and it rules out the obvious
// implementation — a semaphore that awaits a free slot — on purpose.
//
// WHY QUEUEING IS THE WRONG ANSWER HERE, specifically. Every request this gateway serves is
// already a scrape with a global deadline of up to 90 seconds. A queued request keeps its
// client's socket open and its deadline running while it waits for a slot, so under load the
// client sees a timeout with no explanation instead of a 429 it can act on. Worse, the queue
// itself is memory the ceiling exists to bound: the cap is sized on
// `maxInflight * bodyCap * 2.5` (`operations.md` section 1), and a queue of waiters is an
// unbounded allocation sitting outside that sum.
//
// This was documented as shipped and was not. `MAX_INFLIGHT=32` has been in `.env.example`
// since the scaffold, `app.ts` cited it in a comment when sizing the request-body cap, and
// nothing read it — the ceiling was a number in a file. The k6 soak's 429 assertion targets
// it, which is what finally surfaced the gap.

/** Seconds. What a shed client is told to wait. */
const RETRY_AFTER_SECONDS = 1;

/**
 * A counting ceiling on concurrent work. Not a semaphore: nothing ever waits.
 *
 * Safe as a plain number because Node runs one request at a time on one event loop — the
 * increment and the comparison in `tryAcquire` cannot interleave with another request's.
 * A worker-thread pool or a second process would need shared state, which is what Valkey is
 * for and what `operations.md`'s per-org token bucket becomes; this bounds one process.
 */
export class InflightLimiter {
	readonly #max: number;
	#current = 0;
	/** Cumulative, never reset. The number that says whether the ceiling is set too low. */
	#shed = 0;

	constructor(max: number) {
		if (!Number.isInteger(max) || max < 1) {
			// Refuse rather than clamp. A ceiling of 0 accepts nothing and a fractional one is a
			// misconfiguration; both are silent in production and instant at boot.
			throw new RangeError(`maxInflight must be a positive integer, got ${String(max)}`);
		}
		this.#max = max;
	}

	get max(): number {
		return this.#max;
	}

	get inFlight(): number {
		return this.#current;
	}

	get shed(): number {
		return this.#shed;
	}

	/**
	 * Take a slot if one is free. `false` means shed this request now.
	 *
	 * Every `true` must be paired with exactly one `release()`, which is why the caller wraps
	 * the work in `try/finally` rather than releasing on the success path — a throw that
	 * skipped the release would leak a slot permanently, and enough of them would wedge the
	 * gateway at a ceiling it never recovers from. That failure is silent and looks like load.
	 */
	tryAcquire(): boolean {
		if (this.#current >= this.#max) {
			this.#shed += 1;
			return false;
		}
		this.#current += 1;
		return true;
	}

	release(): void {
		// Clamped, so a double release cannot drive the count negative and hand out more slots
		// than the ceiling — the bug that turns a limiter into a limiter-shaped no-op.
		if (this.#current > 0) this.#current -= 1;
	}
}

/**
 * What to tell a shed client.
 *
 * A FLAT SECOND, not a computed estimate, and not exponential. We genuinely do not know when
 * a slot frees: the occupant may be 200 ms into a cached fetch or 80 seconds into a rendered
 * scrape, and a `Retry-After` derived from that spread would be a guess a caller then
 * believes. `headersFor` already refuses to emit a guessed `Retry-After` for the same reason.
 *
 * One second is the honest floor — RFC 9110 counts in whole seconds, and shedding is by
 * definition transient — and it keeps a well-behaved client's retry inside the deadline it
 * already has. Backing off harder is the client's call, and a client that ignores this
 * header is shed again for free, which is the whole point of shedding over queueing.
 */
export function retryAfterSeconds(): number {
	return RETRY_AFTER_SECONDS;
}
