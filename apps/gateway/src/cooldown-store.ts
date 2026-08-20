// Where cooldowns live between requests. The I/O half of `packages/shared/src/cooldown.ts`.
//
// Same shape and same reasoning as `health-store.ts`: process-local today because self-host
// is one process, an async interface so the Valkey implementation is a swap, and the single
// -writer limit enforced at boot rather than described in a comment.
//
// One difference worth naming. Health degrades gracefully when it is lost — every provider
// re-enters measurement and routing is merely less informed. A lost cooldown is a wasted
// attempt at a provider that was about to block us again, which costs money rather than
// quality. Neither is a reason to fail closed: `integrations.md` section 3's table says both
// fail OPEN, because refusing a request outright is worse than paying for one bad hop.

import {
	arm,
	armFor,
	type CooldownDecision,
	type CooldownEntry,
	claimProbe,
	decide,
	maxCapForKey,
} from '@proxlane/shared';

export interface CooldownStore {
	/**
	 * Read, without claiming anything. A `probe` decision here is an invitation, not a
	 * reservation — the caller claims it only for the provider it actually attempts, so a
	 * provider that gets re-ranked away does not burn the probe slot on its way past.
	 *
	 * May reject. The chain fails OPEN.
	 */
	check(keys: readonly string[], now: number): Promise<ReadonlyMap<string, CooldownDecision>>;

	/**
	 * Take the single post-expiry probe. `false` means somebody else has it, and the caller
	 * must treat the provider as cooling.
	 *
	 * Awaited, unlike `record` on the health store, and the difference is the point: this one
	 * decides whether to spend money on an attempt, so it is part of the decision rather than
	 * an observation of it. Implementations must make it atomic.
	 */
	claim(key: string, now: number): Promise<boolean>;

	/**
	 * Arm or re-arm after a cooling-worthy outcome. Best-effort, off the critical path.
	 *
	 * `retryAfterMs` is the TARGET's own statement of how long to wait, when the provider
	 * exposed it — better information than any backoff curve we can invent, and the reason a
	 * jittered draw of 5s does not send us back into a site that asked for 120. Still clamped
	 * to the cap and still exponential in `consecutive`.
	 *
	 * Absent more often than present: ScraperAPI strips the header entirely, so every path
	 * must work without it.
	 */
	arm(key: string, now: number, retryAfterMs?: number): void;

	/** A provider that just worked is not cooled. Best-effort. */
	clear(key: string): void;

	/**
	 * Hand the probe slot back, leaving the cooldown otherwise untouched.
	 *
	 * Needed because claiming and settling are separate events, and not every outcome settles.
	 * A claimed probe that returned, say, `PROVIDER_ERROR` neither confirms the block nor
	 * refutes it: arming would punish the provider for an unrelated fault, clearing would
	 * declare a block over on no evidence. Releasing lets the NEXT request probe.
	 *
	 * Without this the slot stayed taken forever. `decide()` then reports `cooling` against an
	 * expiry already in the past, so the provider is filtered out on every subsequent request
	 * and the 503 refuses the request until the record's TTL runs out an hour later. One 404 on
	 * a probe did that, and it advertised `Retry-After: 0` while doing it — since floored at a
	 * second, which makes the message merely wrong rather than a hot loop.
	 */
	release(key: string): void;

	/**
	 * Every cooldown currently held. For `GET /health/cooldowns`.
	 *
	 * Cooldowns are ON by default and were the only routing mechanism with no way to see them:
	 * `/health/providers` covers health, which ships off. An operator asking "why is one
	 * provider never used" had to read source. Two operator reviews said so.
	 */
	list(now: number): Promise<ReadonlyArray<{ key: string } & CooldownEntry>>;
}

/** Process-local cooldowns. Correct for one gateway, wrong for two. */
export class InMemoryCooldownStore implements CooldownStore {
	readonly #entries = new Map<string, CooldownEntry>();
	readonly #rng: () => number;

	constructor(rng: () => number = Math.random) {
		this.#rng = rng;
	}

	check(keys: readonly string[], now: number): Promise<ReadonlyMap<string, CooldownDecision>> {
		return Promise.resolve(new Map(keys.map((k) => [k, decide(this.#entries.get(k), now)])));
	}

	claim(key: string, now: number): Promise<boolean> {
		const { claimed, next } = claimProbe(this.#entries.get(key), now);
		// Single-threaded JS makes this atomic for free. Valkey will not, which is why the
		// pure function returns the next entry rather than mutating: a Lua script applies the
		// same compare-and-set in one round trip.
		if (next !== undefined) this.#entries.set(key, next);
		return Promise.resolve(claimed);
	}

	arm(key: string, now: number, retryAfterMs?: number): void {
		const prev = this.#entries.get(key);
		this.#entries.set(
			key,
			retryAfterMs === undefined
				? arm(prev, now, this.#rng, maxCapForKey(key))
				: armFor(prev, now, retryAfterMs),
		);
	}

	clear(key: string): void {
		this.#entries.delete(key);
	}

	release(key: string): void {
		const e = this.#entries.get(key);
		if (e?.probeTaken) this.#entries.set(key, { ...e, probeTaken: false });
	}

	list(_now: number): Promise<ReadonlyArray<{ key: string } & CooldownEntry>> {
		return Promise.resolve([...this.#entries].map(([key, e]) => ({ key, ...e })));
	}

	/** Test and diagnostic access. Not part of the interface. */
	peek(key: string): CooldownEntry | undefined {
		return this.#entries.get(key);
	}

	/**
	 * Drop entries that expired long ago.
	 *
	 * An unbounded Map keyed by (provider, domain) grows with the number of distinct hosts a
	 * gateway has ever been blocked on, and nothing else would ever remove them — a slow leak
	 * that only appears on a long-running instance with wide traffic, which is the hardest
	 * kind to notice. Valkey gets this free from key TTLs; in memory it has to be swept.
	 *
	 * `consecutive` is lost when an entry is swept, so the backoff for that key restarts. That
	 * is correct: a domain we have not been blocked on for an hour is not mid-incident.
	 */
	sweep(now: number, olderThanMs = 60 * 60 * 1000): number {
		let removed = 0;
		for (const [k, e] of this.#entries) {
			if (now - e.untilMs > olderThanMs) {
				this.#entries.delete(k);
				removed++;
			}
		}
		return removed;
	}

	get size(): number {
		return this.#entries.size;
	}
}
