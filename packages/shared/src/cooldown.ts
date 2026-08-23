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
	/** `integrations.md` section 3. The ceiling for the INITIAL, jittered backoff. */
	CAP_MS: 15 * 60 * 1000,
	/**
	 * The ceiling once probes keep failing, and the reason this constant exists.
	 *
	 * A failed probe used to re-arm at `CAP_MS` exactly, forever. So a (provider, domain) that
	 * had refused us a hundred times running was treated identically to one that refused twice:
	 * a flat 15 minutes, which is **96 paid probes a day for that pair**. A domain three
	 * providers block costs 288 a day, and a hundred such domains cost 28,800 — all of it spent
	 * rediscovering something already known, and all of it billed.
	 *
	 * A pair that has failed this many times in a row is not a transient block, it is a
	 * settled fact, and settled facts deserve a longer memory. Six hours puts it at ~4 probes a
	 * day while still recovering inside a working day if the block lifts.
	 *
	 * NOT a bigger `CAP_MS`. The first block still cools for seconds, because most blocks are
	 * transient and punishing them for hours on first sight would route around a provider that
	 * was about to work.
	 */
	MAX_CAP_MS: 6 * 60 * 60 * 1000,
	/**
	 * Consecutive failures before the ceiling starts growing past `CAP_MS`.
	 *
	 * Three, so a pair gets the full 15-minute treatment a few times before we conclude it is
	 * permanent. Reaching `MAX_CAP_MS` then takes roughly eight hours of continuous failure,
	 * which is long enough that nothing transient gets there.
	 */
	GROW_AFTER: 3,
} as const;

/**
 * The ceiling a failed probe re-arms at, given how many times this key has armed in a row.
 *
 * Exponential in the excess over `GROW_AFTER`, clamped to `MAX_CAP_MS`:
 * 15m, 15m, 15m, 30m, 1h, 2h, 4h, 6h, 6h…
 */
export function probeCeilingMs(consecutive: number): number {
	const steps = Math.max(0, consecutive - COOLDOWN.GROW_AFTER);
	return Math.min(COOLDOWN.MAX_CAP_MS, COOLDOWN.CAP_MS * 2 ** steps);
}

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
	/**
	 * The ceiling a FAILED PROBE re-arms at. Defaults to `CAP_MS`, i.e. the old flat behaviour.
	 *
	 * Opt-in per namespace rather than global, and that is the point. `cd:blk` is a shared,
	 * effectively permanent fact about a (provider, domain) and deserves a long memory. `cd:acct`
	 * is a rate limit or a lapsed key: private to one org, usually transient, and resetting on
	 * the provider's own schedule. Backing an org's rate limit off to six hours would take that
	 * customer's provider away for the afternoon to save a probe that costs almost nothing.
	 */
	maxCapMs: number = COOLDOWN.CAP_MS,
): CooldownEntry {
	const wasProbe = entry !== undefined && now >= entry.untilMs;
	const consecutive = (entry?.consecutive ?? 0) + 1;
	// A failed probe re-arms at the ceiling exactly, with no jitter — unchanged, and for the
	// reason above. What changed is that the ceiling GROWS: it used to be a flat `CAP_MS` no
	// matter how long the pair had been refusing us, which is where the 96-probes-a-day came
	// from. See `probeCeilingMs`.
	const ms = wasProbe
		? Math.min(maxCapMs, probeCeilingMs(consecutive))
		: cooldownMs(consecutive - 1, rng);
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
/**
 * The key that rate-limits the FORCED probe, when every capable provider is cooling.
 *
 * Per DOMAIN, not per (provider, domain), and that is the whole point: this fires only in the
 * state where the alternative is serving nothing at all, so it must cost one attempt for the
 * domain rather than one per provider on it.
 *
 * It exists because a hundred concurrent requests arriving at an all-cooling domain would
 * otherwise all force at once — the precise thundering herd the half-open probe was built to
 * prevent, reintroduced by the mechanism meant to keep the domain alive.
 */
/**
 * Which ceiling a key's failed probe re-arms at.
 *
 * Only block cooldowns grow. See `arm`'s `maxCapMs` for why an account cooldown must not.
 */
export function maxCapForKey(key: string): number {
	return key.startsWith('cd:blk:') ? COOLDOWN.MAX_CAP_MS : COOLDOWN.CAP_MS;
}

export function forcedProbeKey(domain: string): string {
	return `cd:forced:${domain}`;
}

/**
 * Premium tiers, weakest first. The order is the whole point of `tiersAtOrBelow`.
 *
 * Not derived from the `PremiumTier` union, because a union is a set and this is a LADDER: the
 * claim being made is that stealth strictly dominates residential, which dominates none. Adding a
 * tier means deciding where on the ladder it sits, and a list forces that decision.
 */
export const TIER_LADDER = ['none', 'residential', 'stealth'] as const;

/**
 * The tier that was blocked, and every weaker one.
 *
 * A BLOCK AT ONE TIER IS NOT A BLOCK AT ALL OF THEM, and the old key made it one. `cd:blk` was
 * keyed `{provider}:{domain}` with no tier, so a plain request that got blocked cooled that
 * provider for that domain across every tier — suppressing the stealth retry, which is the
 * ESCALATION most likely to work and the entire reason the tier exists.
 *
 * Measured: a caller's plain probes blocked, and their `premium=stealth` follow-up was skipped
 * rather than tried. It read as "stealth does not work on this host" when stealth had never been
 * sent.
 *
 * The implication runs one way only. If stealth failed, residential and none will too — they are
 * strictly weaker against the same defence. If none failed, stealth may still get through. So a
 * block cools its own tier and everything below it, and never anything above.
 */
export function tiersAtOrBelow(tier: string): readonly string[] {
	const i = TIER_LADDER.indexOf(tier as (typeof TIER_LADDER)[number]);
	// An unknown tier cools only itself: guessing where it sits on the ladder would either
	// over-cool a stronger option or under-cool a weaker one, and both are worse than exact.
	return i === -1 ? [tier] : TIER_LADDER.slice(0, i + 1);
}

export function cooldownKey(
	scope: 'blk' | 'acct' | 'none',
	parts: {
		readonly provider: string;
		readonly domain: string;
		readonly org: string;
		/** Which premium tier the request asked for. Part of the `blk` key; ignored by `acct`. */
		readonly premium: string;
	},
): string | null {
	// THE TIER IS LAST, so `cd:blk:{provider}:{domain}` still parses by index for the provider
	// and the domain — `/health/cooldowns` splits on ':' and would otherwise start reporting the
	// tier as the domain.
	if (scope === 'blk') return `cd:blk:${parts.provider}:${parts.domain}:${parts.premium}`;
	// An account fact has nothing to do with what the request asked for: a lapsed key refuses
	// every tier equally.
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

/**
 * Parse an HTTP `Retry-After` into milliseconds.
 *
 * RFC 9110 allows two forms: delta-seconds, and an HTTP-date. Both appear in the wild, so
 * both are handled — a date-form header parsed as a number yields NaN, which would otherwise
 * silently become a zero-length cooldown, i.e. no cooldown at all.
 *
 * Returns `undefined` for anything unparseable or non-positive, so the caller falls back to
 * the jittered backoff rather than trusting a value it could not read.
 */
export function parseRetryAfter(raw: string | undefined, now: number): number | undefined {
	if (raw === undefined || raw.trim() === '') return undefined;
	const trimmed = raw.trim();
	if (/^\d+$/.test(trimmed)) {
		const ms = Number(trimmed) * 1000;
		return ms > 0 ? ms : undefined;
	}
	// An HTTP-date always carries a day or month name, and requiring one is what keeps
	// `Date.parse` away from strings it will happily misread. `Date.parse('-5')` returns a
	// valid timestamp in 1901 — as a Retry-After that is a ~31-year cooldown, clamped to the
	// cap but arrived at by nonsense. Anything numeric-but-not-a-count must be rejected, not
	// reinterpreted as a date.
	if (!/[a-z]/i.test(trimmed)) return undefined;
	const at = Date.parse(trimmed);
	if (Number.isNaN(at)) return undefined;
	const ms = at - now;
	return ms > 0 ? ms : undefined;
}

/**
 * Arm a cooldown for a duration the TARGET asked for, rather than a jittered guess.
 *
 * Still clamped to the cap: a site asking for a week is not a reason to hold a provider out
 * for a week, and the half-open probe is what discovers it has relaxed. Still exponential in
 * `consecutive`, so repeated refusals still escalate.
 */
export function armFor(
	entry: CooldownEntry | undefined,
	now: number,
	retryAfterMs: number,
): CooldownEntry {
	return {
		untilMs: now + Math.min(COOLDOWN.CAP_MS, Math.max(1, retryAfterMs)),
		consecutive: (entry?.consecutive ?? 0) + 1,
		probeTaken: false,
	};
}
