// The one piece of OAuth state: whether a code or refresh token has been used, and whether a
// grant family has been revoked. `plan.md` section 2, "Single use is the one piece of state".
//
// Everything else the authorization server issues is a sealed box it reads back. Single use
// cannot be: a box cannot know it has been opened before. So this records first use for exactly
// as long as the box could still be presented, and nothing longer.
//
// FAILS CLOSED, the one store on the request path that does. Every other store failing open costs
// a wasted attempt or a looser limit; this one failing open would let a stolen code or refresh
// token be replayed. The token endpoint answers 503 instead, and the client retries.

export interface GrantStore {
	/** Record the first use of `id`. `false` if it was already used. May reject: callers fail closed. */
	claim(id: string, ttlMs: number): Promise<boolean>;
	/** Revoke a grant family, for as long as any token from it could live. */
	revoke(family: string, ttlMs: number): Promise<void>;
	revoked(family: string): Promise<boolean>;
}

/**
 * One process's record. Correct for a single replica, which is what a gateway without Valkey is
 * held to at boot (`PROXLANE_REPLICAS`). A restart forgets it, which reopens a replay window only
 * for codes and refresh tokens already used and still unexpired: the price of running without
 * Valkey, stated here rather than discovered.
 */
export class InMemoryGrantStore implements GrantStore {
	readonly #until = new Map<string, number>();
	readonly #now: () => number;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	async claim(id: string, ttlMs: number): Promise<boolean> {
		return this.#set(`use:${id}`, ttlMs);
	}

	async revoke(family: string, ttlMs: number): Promise<void> {
		this.#until.set(`fam:${family}`, this.#now() + ttlMs);
	}

	async revoked(family: string): Promise<boolean> {
		return this.#live(`fam:${family}`);
	}

	/** Entries held. For the test that pins the sweep. */
	get size(): number {
		return this.#until.size;
	}

	#set(key: string, ttlMs: number): boolean {
		if (this.#live(key)) return false;
		// Swept on write, a few at a time, so a long-lived gateway does not keep every code it ever
		// saw. Map iteration is insertion order, so the oldest go first.
		const now = this.#now();
		let swept = 0;
		for (const [k, until] of this.#until) {
			if (swept++ > 8) break;
			if (until <= now) this.#until.delete(k);
		}
		this.#until.set(key, now + ttlMs);
		return true;
	}

	#live(key: string): boolean {
		const until = this.#until.get(key);
		return until !== undefined && until > this.#now();
	}
}
