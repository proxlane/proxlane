// Cooldowns: don't ask a provider something it just refused to answer.
//
// Distinct from health, which asks "is this provider worse than it usually is" and is
// provider-global. A cooldown is narrow and short: THIS provider, for THIS domain or THIS
// account, for minutes. A provider can be perfectly healthy and still cooled on one site.
//
// TWO NAMESPACES, because one conflates two facts. `integrations.md` section 3:
//
//   cd:blk:{provider}:{domain}   SOFT_BLOCK, HARD_BLOCK. A block is a property of the
//                                DOMAIN, so it is shared across orgs — that is the moat.
//   cd:acct:{org}:{provider}     RATE_LIMITED, AUTH_FAILED. A rate limit is a property of
//                                one org's ACCOUNT. ScraperAPI's 429 is a plan concurrency
//                                cap, not a ban, so under a single key org A saturating its
//                                own plan would cool that provider for everyone else — the
//                                hosted instance degrading under exactly the load it exists
//                                to absorb.
//
// HALF-OPEN EXPIRY is the part that is easy to get subtly wrong. When a cooldown expires the
// provider is not simply available again: exactly ONE request is let through as a probe. If
// it fails the cooldown re-arms at the cap. Without that, an expiry under load sends every
// concurrent request at a provider that is still blocking, and pays for all of them.
//
// "Exactly one" is why `claimProbe` exists as its own operation rather than falling out of a
// read. Deciding and claiming have to be atomic, and a read-then-write across a Valkey round
// trip is not.

/** What a cooldown lookup says about one (provider, key) pair. */
export type CooldownDecision =
	/** No cooldown. Use this provider. */
	| { readonly kind: 'open' }
	/** Cooling. Skip this provider; `untilMs` is when that stops being true. */
	| { readonly kind: 'cooling'; readonly untilMs: number }
	/**
	 * Expired, and nobody has taken the probe yet. Callers MUST call `claimProbe` before
	 * attempting, and treat `false` as `cooling` — another request got there first.
	 */
	| { readonly kind: 'probe' };

/** What a store persists per key. */
export interface CooldownEntry {
	/** Epoch ms. The cooldown is over at this instant, at which point one probe is allowed. */
	readonly untilMs: number;
	/** How many times this key has armed in a row. Drives the backoff exponent. */
	readonly consecutive: number;
	/** Set once the single post-expiry probe has been handed out. */
	readonly probeTaken: boolean;
}

export const COOLDOWN = {
	/** First cooldown, before jitter. */
	BASE_MS: 30_000,
	/** `integrations.md` section 3. Also what a failed probe re-arms at, directly. */
	CAP_MS: 15 * 60 * 1000,
} as const;

/**
 * Exponential backoff with FULL jitter: uniform in `[0, min(cap, base * 2^n))`.
 *
 * Full jitter rather than equal jitter or none, because every gateway that hit the same
 * block at the same time would otherwise retry at the same instant, and a thundering herd
 * against a site that just blocked us is how a soft block becomes a hard one.
 *
 * The property that makes a near-zero draw safe: a short cooldown only means we probe
 * sooner, and a failed probe re-arms at the CAP rather than at the next exponent. So the
 * downside of an unlucky draw is one wasted attempt, and the upside is exploration.
 *
 * `rng` is injected so tests are deterministic. Callers pass `Math.random`.
 */
export function cooldownMs(consecutive: number, rng: () => number): number {
	const ceiling = Math.min(COOLDOWN.CAP_MS, COOLDOWN.BASE_MS * 2 ** Math.max(0, consecutive));
	return Math.floor(rng() * ceiling);
}

/** Read an entry. Pure: no claiming, no mutation. */
export function decide(entry: CooldownEntry | undefined, now: number): CooldownDecision {
	if (entry === undefined) return { kind: 'open' };
	if (now < entry.untilMs) return { kind: 'cooling', untilMs: entry.untilMs };
	if (entry.probeTaken) {
		// Expired, but the probe is already out with someone else. Treated as cooling rather
		// than open: letting a second request through is exactly the herd this prevents.
		return { kind: 'cooling', untilMs: entry.untilMs };
	}
	return { kind: 'probe' };
}

/**
 * Arm or re-arm after a cooling-worthy outcome.
 *
 * A failure DURING the half-open probe goes straight to the cap rather than to the next
 * exponent — the spec is explicit, and the reasoning is that a probe is the cheapest possible
 * evidence: it says the provider is still refusing, so backing off gently would spend more
 * money to learn the same thing again.
 */
export function arm(
	entry: CooldownEntry | undefined,
	now: number,
	rng: () => number,
): CooldownEntry {
	const wasProbe = entry !== undefined && now >= entry.untilMs;
	const consecutive = (entry?.consecutive ?? 0) + 1;
	const ms = wasProbe ? COOLDOWN.CAP_MS : cooldownMs(consecutive - 1, rng);
	return { untilMs: now + ms, consecutive, probeTaken: false };
}

/**
 * Hand out the single post-expiry probe, if it is still available.
 *
 * Returns the claim and the entry to persist. A store must apply this ATOMICALLY — in Valkey
 * that is a Lua compare-and-set, not a GET followed by a SET. Two concurrent requests both
 * reading `probeTaken: false` and both proceeding is the precise failure the half-open design
 * exists to prevent, and it only shows up under load.
 */
export function claimProbe(
	entry: CooldownEntry | undefined,
	now: number,
): { readonly claimed: boolean; readonly next?: CooldownEntry } {
	if (entry === undefined) return { claimed: true };
	if (now < entry.untilMs || entry.probeTaken) return { claimed: false };
	return { claimed: true, next: { ...entry, probeTaken: true } };
}

/**
 * Which namespace an outcome cools, and the key within it.
 *
 * `null` means this outcome cools nothing. Keyed on the outcome's declared `CooldownScope`
 * rather than on a second list of outcome names, so `FAILOVER` stays the single source and
 * adding an outcome cannot silently miss this file.
 */
export function cooldownKey(
	scope: 'blk' | 'acct' | 'none',
	parts: { readonly provider: string; readonly domain: string; readonly org: string },
): string | null {
	if (scope === 'blk') return `cd:blk:${parts.provider}:${parts.domain}`;
	if (scope === 'acct') return `cd:acct:${parts.org}:${parts.provider}`;
	return null;
}

/**
 * The domain half of a `cd:blk` key.
 *
 * The HOSTNAME, lowercased, and not the registrable domain. That is a real limitation:
 * `www.example.com` and `example.com` cool separately, so a block on one does not protect a
 * request to the other.
 *
 * The tempting fix is "last two labels", and it is wrong for every `.co.uk`, `.com.au` and
 * `.github.io` target — silently, by cooling `co.uk` as though it were one site, which would
 * make one blocked British site cool every British site. Doing it properly needs the Public
 * Suffix List: a dependency, a data file, and a freshness problem, for a benefit that is
 * currently one extra cooldown entry per host. Revisit if real traffic shows it mattering.
 */
/**
 * Longest hostname a cooldown key will carry.
 *
 * A DNS name cannot exceed 253 octets, but `new URL()` happily parses a 20,000-character
 * host. Unbounded, that is a 20 KB Valkey key name sent twice per provider on every request,
 * a 20 KB `Map` key in the in-memory store, and a 20 KB reflection of attacker input into the
 * error body — and it makes filling a 256 MB `noeviction` Valkey a matter of ~13k blocked
 * requests rather than ~1.3M.
 */
const MAX_HOSTNAME = 253;

export function cooldownDomain(url: string): string {
	try {
		const host = new URL(url).hostname.toLowerCase();
		// Strip the FQDN root dot. `example.com.` and `example.com` resolve to the same site, so
		// keeping them apart is a one-character bypass of an armed cooldown and a free way to
		// double the keyspace. The edge guard already strips it for its blocklist check and
		// then hands back the un-stripped URL, so this is the second place that has to know.
		const trimmed = host.endsWith('.') ? host.slice(0, -1) : host;
		// Truncate rather than reject: the edge guard owns admission, and a hostname this long
		// is not a reason to refuse a request that already passed it. Collisions among 253+
		// character hosts cool each other, which is a strictly better outcome than the
		// unbounded keyspace they would otherwise create.
		return trimmed.length > MAX_HOSTNAME ? trimmed.slice(0, MAX_HOSTNAME) : trimmed;
	} catch {
		// The edge guard runs before this and rejects anything unparseable, so reaching here
		// means the caller skipped it. Return something inert rather than throwing inside a
		// routing decision.
		return 'invalid';
	}
}
