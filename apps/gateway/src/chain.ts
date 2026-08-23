// The failover chain. This is the product.
//
// It owns the two outcomes nothing else can produce — NO_PROVIDER_AVAILABLE and
// BUDGET_EXCEEDED — and it is the only place that decides whether to try again. Adapters
// map a response to an outcome and stop; FAILOVER says what an outcome means; this walks
// the chain accordingly. Retry logic anywhere else means the taxonomy is missing a case.

import {
	type Adapter,
	type CostUnit,
	conflictApplies,
	costOf,
	type GatewayRequest,
	type Outcome,
	type ParsedResult,
	type ProviderCapabilities,
	policyFor,
} from '@proxlane/adapters';
import { detect, EMPTY_RESPONSE, isContentFree } from '@proxlane/detect';
import {
	COOLDOWN,
	type CooldownDecision,
	cooldownDomain,
	cooldownKey,
	cooldownScope,
	forcedProbeKey,
	guardTargetUrl,
	type HealthState,
	eligible as rankByHealth,
} from '@proxlane/shared';
import { hopBudget, MIN_USEFUL_ATTEMPT_MS } from './budget.js';
import type { CooldownStore } from './cooldown-store.js';
import type { HealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

/**
 * The smallest wait a 503 will ever advertise. `Retry-After` is expressed in whole seconds,
 * so anything below this rounds to zero and tells the caller to retry at once.
 */
const MIN_RETRY_AFTER_MS = 1000;

/**
 * How many extra goes the LAST capable provider gets before the chain gives up.
 *
 * NOT a general retry, and the distinction is the whole design. Failover already is the
 * retry: on a transient provider failure the chain moves to a different provider, which
 * costs the same one request and is likelier to work because it is different infrastructure.
 * Retrying the same provider first would spend money to ask a machine that just failed.
 *
 * It is also mostly redundant. `integrations.md` records that the launch providers retry
 * internally before answering — ScraperAPI for up to 70 seconds — so a failure that reaches
 * us has already survived that. Asking again usually buys another identical failure.
 *
 * The gap is the terminal hop, where there is no next provider. That is not an edge case: a
 * deployment with one provider key is the common starting shape, and there the chain either
 * retries or returns nothing. Measured against Bright Data while writing its adapter,
 * `no_free_workers` and a bare HTML 502 from its edge both cleared on an immediate retry —
 * fast front-door failures rather than scrape failures, which is exactly the class where one
 * more go is worth a request.
 */
const DEFAULT_TERMINAL_RETRIES = 1;

/**
 * Which outcomes are worth another go at the same provider.
 *
 * Provider-class only, and not all of them. A target's 404 is a 404 on the retry. A block is
 * a block. `AUTH_FAILED` is a credential, and `RATE_LIMITED` means it just told us to stop —
 * retrying either is asking to be refused twice and billed twice.
 *
 * What is left is the provider failing to answer at all, which is the transient case.
 */
const RETRYABLE_AT_TERMINAL: ReadonlySet<Outcome> = new Set([
	'PROVIDER_ERROR',
	'PROVIDER_TIMEOUT',
]);

export interface Attempt {
	readonly provider: string;
	readonly outcome: Outcome;
	/** Set only when /detect turned an OK into a SOFT_BLOCK. Surfaced as X-Detect-Rule. */
	readonly detectRuleId?: string;
	readonly budgetMs: number;
	readonly latencyMs?: number;
	/**
	 * Wall time this attempt spent inside the provider call, always set.
	 *
	 * NOT `latencyMs`, which the transport reports and only exists when a response came back.
	 * A timeout burns its whole budget and reports no latency at all, so anything summing
	 * `latencyMs` to work out "time not spent in the gateway" counts a 22-second timeout as
	 * zero and attributes it to us. That is the wrong direction for a p95 gate: the slower the
	 * provider, the worse the gateway would look.
	 *
	 * Measured around `transport.execute` and nothing else, so adapter parsing and the
	 * detector — our work — stay outside it.
	 */
	readonly upstreamMs: number;
	/**
	 * What this attempt cost, when the adapter could say.
	 *
	 * Per ATTEMPT, not per request, because a failed hop is often still charged — ScraperAPI
	 * bills 404s, and ScrapingBee reports a real figure per call. A total that counted only
	 * the winning hop would understate every failover, which is precisely the spend the
	 * unbilled-spend metric in plan.md section 7 exists to watch.
	 */
	readonly costMicrocredits?: number;
	/**
	 * What `costMicrocredits` is denominated in. Carried per attempt because a chain can mix
	 * them: three launch providers sell credits and one bills cents, so a failover from
	 * ScraperAPI to Bright Data produces two numbers that must not be added.
	 */
	readonly costUnit?: CostUnit;
	/**
	 * Whether the provider TOLD us this figure or we worked it out from our own table.
	 *
	 * The adapters have always produced it and this record threw it away, which quietly made
	 * `integrations.md` section 4 unbuildable: "we store `reported` and diff against our
	 * estimate. Sustained drift > 10% on any (provider, feature) pair opens an alert: our table
	 * is stale." You cannot diff the two if you cannot tell which one you stored.
	 *
	 * That matters more than it sounds. A week of checking found three of four cost tables wrong,
	 * and re-reading four vendors' pricing pages is what found them — which does not scale to ten
	 * providers. The gateway already sees the provider's own number on most responses. Keeping it
	 * labelled is what turns live traffic into the drift detector instead of a human with a
	 * calendar reminder.
	 */
	readonly costSource?: 'reported' | 'estimated';
	/**
	 * What our own cost table SAYS this attempt should have cost, for the shape we sent.
	 *
	 * Recorded beside the provider's own figure so the two can be subtracted. They have always
	 * sat microseconds apart in this function — `parsed.cost` on one side, `req.premium` and
	 * `req.renderJs` on the other — and `costOf` was never called here. The website compares
	 * prices; the gateway, which gets the vendor's real answer back on three of four providers,
	 * compared nothing.
	 *
	 * That is the difference between finding a wrong price by re-reading four vendors' pricing
	 * pages, which does not scale past about four, and finding it in the first request that hits
	 * the cell. Scrapfly's residential+render error would have read predicted 125,000,000 against
	 * a reported 30,000,000 on the very first such request the gateway ever served.
	 *
	 * Absent when the table cannot price the shape at all — a combination the provider does not
	 * sell should be a routing decision, not a silent zero.
	 */
	readonly costPredicted?: number;
}

export interface ChainResult {
	readonly outcome: Outcome;
	readonly detectRuleId?: string;
	readonly result?: ParsedResult;
	readonly provider?: string;
	/** Every hop, in order. The logged grain is the attempt, not the request. */
	readonly attempts: readonly Attempt[];
	readonly reason?: string;
	/**
	 * How long until this request could succeed, when the chain knows. Set only when every
	 * capable provider was cooling — a 503 with no `Retry-After` tells a caller to guess.
	 */
	readonly retryAfterMs?: number;
	/**
	 * Health of the provider that served, surfaced as `X-Provider-Health`.
	 *
	 * `demoted-forced` means the floor fired: every capable provider was demoted, so the
	 * least-bad one was used anyway. A user seeing that understands their world; the same
	 * request failing with NO_PROVIDER_AVAILABLE would look like our outage.
	 */
	/**
	 * `demoted-forced`: every capable provider was demoted and the least-bad was used anyway.
	 * `cooling-forced`: every capable provider was COOLING and one was tried regardless, because
	 * refusing for the length of a grown backoff would take the domain off the air.
	 */
	readonly providerHealth?: HealthState['state'] | 'demoted-forced' | 'cooling-forced';
}

export interface ChainDeps {
	readonly transport: HttpTransport;
	/**
	 * Resolved by the caller in STATIC PRIORITY order; BYOK means keys arrive per request.
	 * Health re-ranks this list, it does not replace it: ties break on the order given here.
	 */
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	readonly maxBodyBytes: number;
	/**
	 * The caller's signal, so a client that hangs up stops costing money.
	 *
	 * Threaded to the transport rather than checked here: an in-flight fetch is where the spend
	 * is, and aborting between hops would still pay for the hop already running.
	 */
	readonly clientSignal?: AbortSignal;
	readonly now?: () => number;
	/** Omit to route without health. The chain then behaves exactly as it did before. */
	readonly health?: HealthStore;
	/** Omit to route without cooldowns. */
	readonly cooldowns?: CooldownStore;
	/**
	 * Whose account the `cd:acct` namespace belongs to. Self-host has exactly one, and the
	 * default names that rather than pretending the field is unused: the key shape has to be
	 * right now, or hosted becomes a migration.
	 */
	readonly orgId?: string;
	/**
	 * Extra goes at the LAST capable provider. Defaults to 1; 0 disables it.
	 *
	 * Per request, not per provider: two providers do not get two retries each. See
	 * DEFAULT_TERMINAL_RETRIES for why the terminal hop is the only place this applies.
	 */
	readonly terminalRetries?: number;
}

/**
 * Can this provider serve this request at all?
 *
 * Capability filtering happens BEFORE the chain is walked, so a provider that cannot render
 * JS is never charged for discovering that. Every field checked here is one the adapter
 * declares and conformance proves it honours.
 */
export function isCapable(caps: ProviderCapabilities, req: GatewayRequest): boolean {
	if (req.renderJs && !caps.renderJs) return false;
	if (!caps.premiumTiers.has(req.premium)) return false;
	if (req.method === 'POST' && !caps.post) return false;
	// Bytes, and most providers cannot. Filtered here rather than discovered from a corrupted
	// response, because by the time the body is mojibake the request has already been paid for.
	if (req.binary === true && !caps.binary) return false;
	if (req.sessionId !== undefined && !caps.sessions) return false;
	if (req.countryCode !== undefined && caps.countryCodes !== 'all') {
		if (!caps.countryCodes.has(req.countryCode.toLowerCase())) return false;
	}
	// THE COST MATRIX IS A CAPABILITY CLAIM, and nothing read it. `contract.ts` defines a null
	// cell as "the provider does not sell that combination" — and ScrapingBee's
	// `stealth: { plain: null, ... }` says exactly that, while `premiumTiers` offers the tier
	// whole and declares no conflict. So the router sent stealth-without-rendering to a provider
	// its own table says will not serve it, and paid for the attempt to find out.
	//
	// A conflict could express this, but it would be a second declaration of a fact the matrix
	// already holds, and the two would drift. Reading the matrix is the derivation.
	if (costOf(caps.costTable, { premium: req.premium, renderJs: req.renderJs }) === null) {
		return false;
	}
	// LAST, and it is the only check that reads more than one field at a time. Everything above
	// asks "does this provider do X"; a conflict asks "does it do X AND Y together", which is a
	// question the independent fields cannot pose. ScraperAPI sells sessions and it sells premium
	// proxies, and it will not sell them in the same request.
	for (const c of caps.conflicts ?? []) {
		if (conflictApplies(c, req)) return false;
	}
	return true;
}

export async function runChain(req: GatewayRequest, deps: ChainDeps): Promise<ChainResult> {
	const now = deps.now ?? (() => Date.now());
	const startedAt = now();
	const attempts: Attempt[] = [];

	// The edge decides before any provider is chosen: refusing at our own door is free, and
	// it keeps a hostile URL out of a provider's logs as well as ours.
	const verdict = guardTargetUrl(req.url);
	if (!verdict.allowed) {
		return { outcome: verdict.outcome, attempts, reason: verdict.reason };
	}
	// FORWARD THE URL THE GUARD ACTUALLY JUDGED, not the caller's string.
	//
	// This was a live bypass. The guard normalised, approved, and returned `verdict.url` —
	// and the raw `req.url` went to the adapter anyway. `http://example.com\@169.254.169.254/`
	// passed: WHATWG treats `\` as an authority terminator, so the host reads as example.com,
	// while Python's urllib — what most provider backends run — reads the host as the
	// metadata address. Validate one string, send another.
	//
	// The SSRF suite already asserts the guard "returns the parsed URL so the caller never
	// re-parses a different string". This is the caller finally honouring that.
	const guarded: GatewayRequest = { ...req, url: verdict.url.href };

	// Capability first, health second. A provider that cannot render JS is not a health
	// question, and filtering on capability before consulting health keeps the two reasons a
	// provider is missing from a chain distinguishable in the reason string below.
	const capable = deps.candidates.filter((c) => isCapable(c.adapter.capabilities, guarded));
	if (capable.length === 0) {
		return {
			outcome: 'NO_PROVIDER_AVAILABLE',
			attempts,
			reason:
				deps.candidates.length === 0
					? 'no providers configured'
					: 'no configured provider has the requested capabilities',
		};
	}

	// FAIL OPEN. `integrations.md` section 3's Valkey-failure table: losing health costs a
	// worse routing decision, never a refused request. Health is an optimisation over a chain
	// that already works, so a store that is down must not be able to take the gateway with
	// it — which is exactly what awaiting an unguarded read would do.
	let states: ReadonlyMap<string, HealthState> = new Map();
	if (deps.health !== undefined) {
		try {
			states = await deps.health.snapshot(
				capable.map((c) => c.adapter.capabilities.id),
				startedAt,
			);
		} catch {
			states = new Map();
		}
	}

	// COOLDOWNS. Read for every CAPABLE provider up front, in one call.
	//
	// Capable, not merely the health-ranked subset, and that ordering is a correction. Health
	// ranking drops demoted providers, so reading cooldowns only for what survived it meant a
	// healthy-but-cooling provider could empty the chain while a demoted-but-usable one was
	// never even considered — the floor exists precisely to stop the gateway turning itself
	// off, and cooldown filtering routed around it. Both filters now see the same input and
	// the floor is applied last, to whatever is left.
	//
	// One call rather than per hop, because a round trip in the middle of the chain lands in
	// the one place the latency budget has already been divided up.
	//
	// Fails open: `integrations.md` section 3's table. Losing a cooldown costs a wasted
	// attempt at a provider that was about to block us, which is money; refusing the request
	// instead would cost the request.
	const org = deps.orgId ?? 'self';
	const domain = cooldownDomain(guarded.url);
	const keysFor = (providerId: string) => ({
		blk: cooldownKey('blk', { provider: providerId, domain, org }) as string,
		acct: cooldownKey('acct', { provider: providerId, domain, org }) as string,
	});

	let cooldowns: ReadonlyMap<string, CooldownDecision> = new Map();
	if (deps.cooldowns !== undefined) {
		try {
			cooldowns = await deps.cooldowns.check(
				capable.flatMap((c) => {
					const k = keysFor(c.adapter.capabilities.id);
					return [k.blk, k.acct];
				}),
				startedAt,
			);
		} catch {
			cooldowns = new Map();
		}
	}

	/** The worst thing either namespace says about this provider. */
	const cooldownFor = (providerId: string): CooldownDecision => {
		const k = keysFor(providerId);
		const both = [cooldowns.get(k.blk), cooldowns.get(k.acct)].filter(
			(d): d is CooldownDecision => d !== undefined,
		);
		const cooling = both.find((d) => d.kind === 'cooling');
		if (cooling !== undefined) return cooling;
		return both.find((d) => d.kind === 'probe') ?? { kind: 'open' };
	};

	// Drop the definitely-cooled BEFORE the loop, not inside it.
	//
	// `hopBudget` divides the remaining deadline by the hops still to come, so skipping inside
	// the loop would reserve time for providers that are never going to be tried and hand
	// every real attempt less budget than it should have. Silently: the request would just be
	// more likely to time out, on a gateway whose entire promise is failover.
	//
	// `probe` entries stay in — they are maybe-usable, and the claim happens at attempt time
	// so a provider that gets skipped for a better one does not burn the single probe slot on
	// its way past.
	const cooled: {
		readonly provider: string;
		readonly untilMs: number;
		readonly scope: string;
	}[] = [];
	const notCooling: typeof capable = capable.filter((c) => {
		const id = c.adapter.capabilities.id;
		const cd = cooldownFor(id);
		if (cd.kind !== 'cooling') return true;
		// Which namespace cooled it. An `acct` cooldown is a rate limit or an auth failure and
		// has nothing to do with the domain, so reporting it as "cooling on example.com" sends
		// the operator to debug the wrong system.
		const k = keysFor(id);
		cooled.push({
			provider: id,
			untilMs: cd.untilMs,
			scope: cooldowns.get(k.blk)?.kind === 'cooling' ? `blocked on ${domain}` : 'account',
		});
		return false;
	});

	// EVERY CAPABLE PROVIDER IS COOLING. There used to be no floor here at all, on the argument
	// that a cooldown is a fact rather than a guess: each of these refused this exact request
	// "minutes ago", so forcing one buys a probable second refusal at full price.
	//
	// That argument was correct when the ceiling was a flat fifteen minutes. It stops holding
	// now that a settled pair backs off to six hours, because "minutes ago" becomes "this
	// morning" — and refusing for six hours turns a domain off for the working day. The premise
	// changed, so the conclusion has to.
	//
	// So: one forced attempt, rate-limited PER DOMAIN rather than per provider, because this
	// only ever fires where the alternative was serving nothing. The claim is the same atomic
	// single-slot primitive the half-open probe uses — without it, a hundred concurrent requests
	// at an all-cooling domain would all force at once, which is the herd the probe exists to
	// prevent, reintroduced by the thing meant to keep the domain alive.
	//
	// The provider picked is the one closest to opening on its own, so the forced attempt is
	// also the one most likely to work, and its failure re-arms it and grows the backoff.
	let forcedByCooldown: (typeof capable)[number] | undefined;
	/** How long until a forced probe is available again, when this request lost the claim. */
	let forcedProbeAvailableInMs: number | undefined;
	if (notCooling.length === 0 && deps.cooldowns !== undefined && cooled.length > 0) {
		const nearest = [...cooled].sort((a, b) => a.untilMs - b.untilMs)[0];
		if (nearest !== undefined) {
			const key = forcedProbeKey(domain);
			let claimed = false;
			try {
				claimed = await deps.cooldowns.claim(key, now());
				if (!claimed) forcedProbeAvailableInMs = COOLDOWN.CAP_MS;
			} catch {
				// Fails CLOSED, unlike the cooldown read above, and deliberately. Losing a
				// cooldown costs one wasted attempt; losing this claim costs one wasted attempt
				// PER CONCURRENT REQUEST, because the whole purpose of the key is to be the only
				// thing standing between an all-cooling domain and a herd.
				claimed = false;
			}
			if (claimed) {
				// An EXPLICIT duration, so the slot is a flat window and never an exponential one.
				// Plain `arm` would back the forced key off exactly like a provider key, growing
				// towards MAX_CAP_MS — which would quietly undo the floor after a day or so of a
				// domain being fully blocked, the one case it exists for. `armFor` clamps to
				// CAP_MS and ignores `consecutive`, so this stays at most four an hour forever.
				deps.cooldowns.arm(key, now(), COOLDOWN.CAP_MS);
				forcedByCooldown = capable.find((c) => c.adapter.capabilities.id === nearest.provider);
				// INTO THE CHAIN, not merely into a variable. Everything downstream builds from
				// `notCooling`: health ranks it, the floor applies to the ranking, and the attempt
				// loop walks the result. Skipping the early return without adding the candidate
				// here left an empty chain, so the request still failed — with the forced probe
				// already claimed and armed, which is the worst of both.
				if (forcedByCooldown !== undefined) notCooling.push(forcedByCooldown);
			}
		}
	}

	if (notCooling.length === 0 && forcedByCooldown === undefined) {
		// CLAMPED TO CAP_MS, because a forced probe becomes available again within that window
		// whatever the per-provider backoff says. Reporting the raw provider expiry would tell a
		// caller to wait six hours when the gateway will in fact try again in fifteen minutes,
		// which is a worse lie than the old one it replaced.
		const soonest = Math.min(...cooled.map((c) => c.untilMs));
		const untilForced = forcedProbeAvailableInMs ?? COOLDOWN.CAP_MS;
		return {
			outcome: 'NO_PROVIDER_AVAILABLE',
			attempts,
			// FLOORED AT ONE SECOND, never zero. A cooldown whose expiry is already in the past
			// still reports `cooling` when its single probe is out with another request, so the
			// naive `soonest - now()` is negative and clamps to 0 — and `Retry-After: 0` is an
			// instruction to retry immediately, i.e. a hot loop, from the one response that
			// exists to tell a caller to wait. The honest answer in that case is "shortly".
			retryAfterMs: Math.max(MIN_RETRY_AFTER_MS, Math.min(soonest - now(), untilForced)),
			reason: `every capable provider is cooling: ${cooled
				.map((c) => `${c.provider} (${c.scope})`)
				.join(', ')}`,
		};
	}

	// Health ranks what is left, and the demoted floor applies to THAT — so a demoted provider
	// is still preferred over no provider at all, even when the healthy ones are cooling.
	//
	// `unusable` is how a LOST PROBE CLAIM re-enters this decision. The claim happens at
	// attempt time, so it is discovered after ranking has already dropped every demoted
	// candidate — and `continue`ing past it then walked off the end of a one-element chain
	// while a demoted-but-perfectly-open provider sat unconsidered. That is the same failure
	// the floor exists to prevent, arriving through the one cooldown fact resolved late.
	//
	// Re-ranking excludes it and lets the floor see the remainder. Bounded by the provider
	// count, and only ever entered on a genuine concurrent race.
	// Providers that must not be (re)considered when the chain is re-ranked: one whose probe
	// claim was lost, and — importantly — every provider already attempted. Re-ranking restarts
	// the walk, so without the second half a failover would try the same provider twice.
	const unusable = new Set<string>();
	const rank = () =>
		rankByHealth(
			notCooling
				.filter((c) => !unusable.has(c.adapter.capabilities.id))
				.map((c) => ({
					id: c.adapter.capabilities.id,
					state: states.get(c.adapter.capabilities.id)?.state ?? 'healthy',
					candidate: c,
				})),
		);
	let ranked = rank();
	let attemptable = ranked.chain;
	let forced = ranked.forced;

	let lastOutcome: Outcome = 'NO_PROVIDER_AVAILABLE';
	/**
	 * The last attempt that actually finished, in full.
	 *
	 * `lastOutcome` alone was not enough. The exhausted-chain return reported its NAME and
	 * nothing else, so a chain of [A, B] where A answered SOFT_BLOCK — body attached, detect rule
	 * attached — and B's probe claim was lost to a concurrent request returned `SOFT_BLOCK` with
	 * no provider, no body and no rule. The caller got the right outcome for a request that had
	 * already been answered, stripped of the answer, and `X-Provider-Used` and `X-Detect-Rule`
	 * both went missing on a response whose `X-Outcome` named a provider fault.
	 */
	let lastCompleted: ChainResult | undefined;
	let onceUsed = false;
	/** Spent across the whole request, not per provider. See TERMINAL_RETRIES. */
	let terminalRetriesLeft = deps.terminalRetries ?? DEFAULT_TERMINAL_RETRIES;

	for (let i = 0; i < attemptable.length; i++) {
		const entry = attemptable[i] as (typeof attemptable)[number];
		const { adapter, key } = entry.candidate;
		// `cooling-forced` outranks the health label: when the cooldown floor fired, THAT is why
		// this provider is being tried, and an operator reading `healthy` on a provider that
		// refused this domain an hour ago would be reading a true fact that explains nothing.
		const providerHealth: HealthState['state'] | 'demoted-forced' | 'cooling-forced' =
			forcedByCooldown?.adapter.capabilities.id === adapter.capabilities.id
				? 'cooling-forced'
				: forced
					? 'demoted-forced'
					: entry.state;

		// A `probe` has to be CLAIMED before anything is spent. Two concurrent requests both
		// seeing an expired cooldown and both proceeding is the herd the half-open design
		// exists to stop, and it only appears under load.
		//
		// `claimedKey` is then owed a settlement — arm, clear or release — on EVERY path out of
		// this iteration, including a throw. See `settleProbe` below.
		let claimedKey: string | undefined;
		if (cooldownFor(adapter.capabilities.id).kind === 'probe' && deps.cooldowns !== undefined) {
			const k = keysFor(adapter.capabilities.id);
			const which = cooldowns.get(k.blk)?.kind === 'probe' ? k.blk : k.acct;
			let claimed: boolean;
			try {
				claimed = await deps.cooldowns.claim(which, now());
			} catch {
				// Fail open. A claim we cannot make is not a reason to refuse the request.
				claimed = true;
			}
			if (!claimed) {
				// Somebody else is already probing. Re-rank without this provider rather than
				// simply skipping it: skipping keeps a chain that the floor computed while this
				// one still looked usable, so a demoted fallback stays invisible.
				unusable.add(adapter.capabilities.id);
				ranked = rank();
				attemptable = ranked.chain;
				forced = ranked.forced;
				i = -1;
				continue;
			}
			claimedKey = which;
		}

		/**
		 * Give the probe slot back if this attempt did not settle the cooldown itself.
		 *
		 * Called from a `finally`, so a transport that throws, an adapter that throws, or a
		 * budget check that returns cannot strand the claim. `release` is a no-op once `arm` or
		 * `clear` has run, because both leave `probeTaken` false or delete the record outright.
		 */
		let settled = false;
		const settleProbe = () => {
			if (claimedKey !== undefined && !settled) {
				try {
					deps.cooldowns?.release(claimedKey);
				} catch {
					// Best effort. The record's TTL is the backstop.
				}
			}
		};

		try {
			const hopsLeft = attemptable.length - i - 1;
			const isLastHop = hopsLeft === 0;
			// The cap keys off HEALTH, not just position. The terminal hop gets maxTimeoutMs and
			// `orderChain` puts the least healthy member last, so keying purely off position hands
			// the worst provider 3.4x everyone else's budget — a promotion, and the exact thing the
			// design says it avoids. A degraded or forced provider keeps the fast cap wherever it
			// lands, so a timeout there cannot eat the budget failover exists to preserve.
			const healthyEnough = providerHealth === 'healthy';
			const cap =
				isLastHop && healthyEnough
					? adapter.capabilities.maxTimeoutMs
					: adapter.capabilities.fastTimeoutMs;

			const remaining = guarded.deadlineMs - (now() - startedAt);
			const budget = hopBudget(remaining, hopsLeft, cap);
			if (budget.kind === 'exhausted') {
				// Deliberately NOT the previous outcome. The chain stopped because time ran out,
				// and reporting the last provider's failure instead would hide a tuning problem as
				// a provider problem — and send someone debugging the wrong system.
				return { outcome: 'BUDGET_EXCEEDED', attempts, reason: budget.reason };
			}

			let wire: ReturnType<Adapter['translate']>;
			try {
				wire = adapter.translate(guarded, key);
			} catch (err) {
				// An adapter refusing to build a request it cannot honour is a capability answer,
				// not a crash — but isCapable() should have caught it, so reaching here means the
				// declaration and the code disagree. That is our bug: INVALID_REQUEST pages.
				attempts.push({
					provider: adapter.capabilities.id,
					outcome: 'INVALID_REQUEST',
					budgetMs: budget.perAttemptMs,
					// The request was never sent, so no time was spent upstream.
					upstreamMs: 0,
				});
				return {
					outcome: 'INVALID_REQUEST',
					attempts,
					reason: err instanceof Error ? err.message : String(err),
				};
			}

			// `performance.now()` rather than `Date.now()`: monotonic, so an NTP step mid-request
			// cannot produce a negative duration and a nonsense `Server-Timing` figure.
			const upstreamStart = performance.now();
			const res = await deps.transport.execute(wire, {
				budgetMs: budget.perAttemptMs,
				maxBodyBytes: deps.maxBodyBytes,
				...(deps.clientSignal === undefined ? {} : { clientSignal: deps.clientSignal }),
			});
			const upstreamMs = performance.now() - upstreamStart;

			let parsed: ParsedResult | undefined;
			let outcome: Outcome;
			let detectRuleId: string | undefined;
			switch (res.kind) {
				case 'response':
					parsed = adapter.parse(res.response);
					outcome = parsed.outcome;
					// SOFT_BLOCK is assigned HERE and nowhere else. An adapter cannot produce it:
					// `parse` is pure and has not run a detector, and the provider thinks the fetch
					// succeeded. Only OK is re-examined — a 404 that happens to contain a vendor
					// token is still a 404, and re-labelling it would make it fail over.
					if (outcome === 'OK' && parsed.body !== undefined) {
						// A CLAIMED SUCCESS THAT RETURNED NOTHING is not a success, and `OK` is
						// `chargeable: true` — so without this the caller is billed for zero bytes
						// and told it worked, on the product whose headline is that a 200 is not a
						// success. Checked here rather than inside `detect()` because whether an
						// empty body is a failure depends on what the provider CLAIMED: on a 404 it
						// is ordinary, and a real recorded 404 has one.
						if (isContentFree(parsed.body)) {
							outcome = 'SOFT_BLOCK';
							detectRuleId = EMPTY_RESPONSE;
						} else {
							const verdict = detect(parsed.body, parsed.contentType, parsed.charset);
							if (verdict.blocked) {
								outcome = 'SOFT_BLOCK';
								detectRuleId = verdict.ruleId;
							}
						}
					}
					// AND A TARGET 5xx, WHICH THE DETECTOR NEVER SAW. Only `OK` was ever re-examined,
					// so a challenge page served with a 5xx status went out as `TARGET_ERROR` — "the
					// site is broken" — when the truth was that the site's defences refused us.
					// Cloudflare's under-attack mode answers 503, so this is the ordinary shape of
					// the thing this product exists to name, not an edge case. Reported by a real
					// caller: four providers exhausted, ~27s, and the verdict blamed the target.
					//
					// It costs more than a wrong label. `TARGET_ERROR` is `cooldown: 'none'` and
					// `failover: 'once'`, so nothing is remembered — every later request re-buys the
					// same four failures. `SOFT_BLOCK` arms the `blk` cooldown, which is what stops
					// a defended domain being paid for on a loop.
					//
					// READ FROM THE RAW RESPONSE, because `carriesBody('TARGET_ERROR')` is false and
					// `parse()` has already dropped the bytes. The chain still holds them.
					//
					// NOT `TARGET_NOT_FOUND`: a 404 is the target's real answer, and re-labelling one
					// because the 404 page happens to carry a vendor token would make it fail over to
					// fetch the same 404 three more times.
					else if (outcome === 'TARGET_ERROR' && res.kind === 'response') {
						const raw = res.response.body;
						if (raw !== undefined && raw.byteLength > 0) {
							const verdict = detect(
								raw,
								res.response.headers['content-type'],
								parsed?.charset,
							);
							if (verdict.blocked) {
								outcome = 'SOFT_BLOCK';
								detectRuleId = verdict.ruleId;
							}
						}
					}
					break;
				case 'client-gone':
					// NOTHING IS RECORDED AND NOTHING IS COOLED. The caller hung up; no provider
					// did anything wrong, and filing this as PROVIDER_TIMEOUT would cool a healthy
					// provider and feed the health statistic a failure nobody caused. The probe
					// claim is still settled — `settleProbe` runs from the `finally` below.
					return {
						outcome: 'BUDGET_EXCEEDED',
						attempts,
						reason: 'the caller disconnected',
					};
				case 'timeout':
					outcome = 'PROVIDER_TIMEOUT';
					break;
				case 'too-large':
					outcome = 'RESPONSE_TOO_LARGE';
					break;
				default:
					outcome = 'PROVIDER_ERROR';
			}

			// Fire and forget, by the interface's design: recording must never be awaited on the
			// hot path. A forced attempt under the floor is recorded too — it is real evidence
			// about a provider we were told is dead.
			//
			// Guarded, because "best effort" has to be true in the direction that matters. A store
			// that throws on write would otherwise take down the request it was only observing —
			// this exact case failed the first time it was tested. Reporting the failure belongs
			// to the implementation, which is the only layer that knows whether a write dropping
			// is routine or an outage; the chain's job is to be unaffected either way.
			// OUTSIDE THE TRY, and that is the whole point. This is the chain's own bookkeeping,
			// not the health store's: it is what stops a later re-rank walking back over a
			// provider already tried. Inside the `try` it was skipped exactly when `record`
			// threw — which is the case the `try` exists for and which "failed the first time it
			// was tested" — so a throwing store could make the chain retry a provider it had
			// already paid for.
			unusable.add(adapter.capabilities.id);
			try {
				deps.health?.record(adapter.capabilities.id, outcome, now());
			} catch {
				// Intentionally swallowed. See above.
			}

			// Cooldowns, from the outcome's OWN declared scope in FAILOVER rather than from a
			// second list of outcome names here. Adding an outcome therefore cannot silently miss
			// this file — it has to declare a scope to compile at all.
			try {
				const scope = cooldownScope(outcome);
				const cdKey = cooldownKey(scope, { provider: adapter.capabilities.id, domain, org });
				// WHICH key this attempt wrote. Settlement is then decided by comparing it to the
				// key that was CLAIMED, not by the fact that a write happened.
				//
				// The earlier version set `settled = true` on any write, and the two keys are
				// frequently different namespaces: a probe claimed on `cd:blk` that comes back
				// RATE_LIMITED arms `cd:acct` and leaves `cd:blk` claimed forever. Eight of the
				// sixteen outcomes stranded a probe that way — including a SUCCESSFUL probe on an
				// account claim, which took a working provider out of service. That last one was
				// introduced by the fix for the account-clear bug, which is the shape to watch:
				// a correct change to one branch invalidating an assumption in another.
				let wroteKey: string | undefined;
				if (cdKey !== null) {
					// The TARGET's Retry-After, when the provider exposed it. Better than any
					// curve we can invent: a jittered first draw averages 15s, and a site asking
					// for 120 would be hit eight times too early.
					deps.cooldowns?.arm(cdKey, now(), parsed?.retryAfterMs);
					wroteKey = cdKey;
				} else if (outcome === 'OK' || outcome === 'TARGET_NOT_FOUND') {
					// The provider REACHED the target. A 200 or a genuine 404 both mean the block, if
					// there ever was one, is over — which is what makes a successful probe end a
					// cooldown rather than merely pause it.
					//
					// Only the DOMAIN key. Clearing the account key here was wrong: `cd:acct` is not
					// domain-scoped, so any concurrent request coming back OK deleted the rate-limit
					// backoff another request had just armed, `consecutive` included. That is the
					// steady state of a plan concurrency cap — some 429, some fine — so the account
					// cooldown was armed and destroyed continuously and never took effect at all.
					wroteKey = keysFor(adapter.capabilities.id).blk;
					deps.cooldowns?.clear(wroteKey);
				}
				if (wroteKey !== undefined && wroteKey === claimedKey) settled = true;
			} catch {
				// Best effort, like health. A cooldown we failed to write costs one future attempt.
			}

			attempts.push({
				provider: adapter.capabilities.id,
				outcome,
				budgetMs: budget.perAttemptMs,
				upstreamMs,
				...(res.kind === 'response' ? { latencyMs: res.latencyMs } : {}),
				...(parsed === undefined
					? {}
					: {
							costMicrocredits: parsed.cost.microcredits,
							costUnit: adapter.capabilities.costTable.unit,
							costSource: parsed.cost.source,
							// The oracle. Only meaningful next to a `reported` figure, but recorded
							// either way: an `estimated` cost that disagrees with the table it came
							// from would mean the adapter and the table have diverged.
							...((): { costPredicted?: number } => {
								const predicted = costOf(adapter.capabilities.costTable, {
									premium: req.premium,
									renderJs: req.renderJs,
								});
								return predicted === null ? {} : { costPredicted: predicted };
							})(),
						}),
				...(detectRuleId === undefined ? {} : { detectRuleId }),
			});
			lastOutcome = outcome;
			lastCompleted = {
				outcome,
				attempts,
				provider: adapter.capabilities.id,
				providerHealth,
				...(detectRuleId === undefined ? {} : { detectRuleId }),
				...(parsed === undefined ? {} : { result: parsed }),
			};

			const policy = policyFor(outcome);
			if (policy.failover === false) {
				// Final, and final means final even with hops to spare. A real 404 is a real 404 at
				// the next provider too, and ScraperAPI charges for one — so retrying spends money
				// to reach the same answer.
				return {
					outcome,
					attempts,
					provider: adapter.capabilities.id,
					providerHealth,
					// THE PROVIDER TOLD US HOW LONG TO WAIT AND THE CALLER NEVER HEARD IT.
					// `retryAfterMs` reached the cooldown store and stopped there, so a provider
					// 429 came back as a bare 429 and a client looped as fast as it liked into a
					// provider that had just capped us. `integrations.md` section 3 has specified
					// `429 + Retry-After` for RATE_LIMITED since the taxonomy was written.
					...(parsed?.retryAfterMs === undefined ? {} : { retryAfterMs: parsed.retryAfterMs }),
					...(detectRuleId === undefined ? {} : { detectRuleId }),
					...(parsed === undefined ? {} : { result: parsed }),
				};
			}
			if (policy.failover === 'once') {
				// 'once' is the CALLER's to track, per the contract. Tracked here because here is
				// the only place that knows how many hops have already happened.
				if (onceUsed) {
					return {
						outcome,
						attempts,
						provider: adapter.capabilities.id,
						providerHealth,
						...(detectRuleId === undefined ? {} : { detectRuleId }),
						...(parsed === undefined ? {} : { result: parsed }),
					};
				}
				onceUsed = true;
			}

			if (isLastHop) {
				// ONE MORE GO, but only here and only for a provider that failed to answer.
				//
				// Guarded on three things, all of which have to hold:
				//   the outcome is transient provider infrastructure, not a target or a credential
				//   the retry budget for this request is not spent
				//   there is time left, checked BEFORE spending a request rather than after
				//
				// The deadline check is the one that matters. `hopBudget` sizes each hop to leave
				// room for the hops that follow, and a retry is a hop nobody budgeted for — so
				// without this it would eat the tail of the deadline and turn a clean
				// PROVIDER_ERROR into a BUDGET_EXCEEDED, which sends someone debugging the wrong
				// system. Retrying only while a full fast-cap still fits keeps that impossible.
				//
				// The cooldown this attempt just armed does NOT block the retry, deliberately.
				// `cooldownFor` reads the snapshot taken before the walk, so the fresh record is
				// invisible here — and that is the behaviour we want: the cooldown is about the
				// NEXT request, and the alternative is arming a cooldown and then honouring it
				// one line later, which would make this setting do nothing on the outcomes it
				// exists for.
				if (
					terminalRetriesLeft > 0 &&
					RETRYABLE_AT_TERMINAL.has(outcome) &&
					guarded.deadlineMs - (now() - startedAt) > adapter.capabilities.fastTimeoutMs
				) {
					terminalRetriesLeft -= 1;
					// Re-run the SAME index. The attempt already pushed is kept: it was billed and
					// it happened, and a cost estimate that hides a retry is the number this
					// project exists not to print.
					i -= 1;
					continue;
				}
				return {
					outcome,
					attempts,
					provider: adapter.capabilities.id,
					providerHealth,
					...(detectRuleId === undefined ? {} : { detectRuleId }),
					...(parsed === undefined ? {} : { result: parsed }),
				};
			}
		} finally {
			settleProbe();
		}
	}

	// REACHABLE, and it used to claim otherwise. A lost probe claim `continue`s, and if that
	// happens on the last element the loop exits normally. The old comment said "unreachable"
	// and returned `lastOutcome` — so a chain that never completed an attempt reported the
	// PREVIOUS provider's failure with no provider attached, and the response dropped
	// `X-Provider-Used` while `X-Outcome` named a provider fault.
	//
	// An exhausted chain is NO_PROVIDER_AVAILABLE, which is what it has always meant.
	if (lastCompleted !== undefined) {
		// The whole result, not its outcome name. See `lastCompleted` above.
		return { ...lastCompleted, attempts, reason: 'chain exhausted' };
	}
	return {
		outcome: attempts.length === 0 ? 'NO_PROVIDER_AVAILABLE' : lastOutcome,
		attempts,
		reason:
			attempts.length === 0
				? 'every capable provider was already being probed by another request'
				: 'chain exhausted',
	};
}

export { MIN_USEFUL_ATTEMPT_MS };
