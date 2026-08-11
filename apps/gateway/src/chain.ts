// The failover chain. This is the product.
//
// It owns the two outcomes nothing else can produce — NO_PROVIDER_AVAILABLE and
// BUDGET_EXCEEDED — and it is the only place that decides whether to try again. Adapters
// map a response to an outcome and stop; FAILOVER says what an outcome means; this walks
// the chain accordingly. Retry logic anywhere else means the taxonomy is missing a case.

import {
	type Adapter,
	type GatewayRequest,
	type Outcome,
	type ParsedResult,
	type ProviderCapabilities,
	policyFor,
} from '@proxlane/adapters';
import { detect } from '@proxlane/detect';
import {
	type CooldownDecision,
	cooldownDomain,
	cooldownKey,
	cooldownScope,
	guardTargetUrl,
	type HealthState,
	eligible as rankByHealth,
} from '@proxlane/shared';
import { hopBudget, MIN_USEFUL_ATTEMPT_MS } from './budget.js';
import type { CooldownStore } from './cooldown-store.js';
import type { HealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

export interface Attempt {
	readonly provider: string;
	readonly outcome: Outcome;
	/** Set only when /detect turned an OK into a SOFT_BLOCK. Surfaced as X-Detect-Rule. */
	readonly detectRuleId?: string;
	readonly budgetMs: number;
	readonly latencyMs?: number;
	/**
	 * What this attempt cost, when the adapter could say.
	 *
	 * Per ATTEMPT, not per request, because a failed hop is often still charged — ScraperAPI
	 * bills 404s, and ScrapingBee reports a real figure per call. A total that counted only
	 * the winning hop would understate every failover, which is precisely the spend the
	 * unbilled-spend metric in plan.md section 7 exists to watch.
	 */
	readonly costMicrocredits?: number;
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
	readonly providerHealth?: HealthState['state'] | 'demoted-forced';
}

export interface ChainDeps {
	readonly transport: HttpTransport;
	/**
	 * Resolved by the caller in STATIC PRIORITY order; BYOK means keys arrive per request.
	 * Health re-ranks this list, it does not replace it: ties break on the order given here.
	 */
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	readonly maxBodyBytes: number;
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
	if (req.sessionId !== undefined && !caps.sessions) return false;
	if (req.countryCode !== undefined && caps.countryCodes !== 'all') {
		if (!caps.countryCodes.has(req.countryCode.toLowerCase())) return false;
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

	const ranked = rankByHealth(
		capable.map((c) => ({
			id: c.adapter.capabilities.id,
			state: states.get(c.adapter.capabilities.id)?.state ?? 'healthy',
			candidate: c,
		})),
	);
	// The floor. With capability filtering ahead of it, a correlated false positive can empty
	// the chain, and a gateway that turns itself off is worse than one routing at 74%.
	const order = ranked.chain;
	const forced = ranked.forced;

	// COOLDOWNS. Read for every ranked provider up front, in one call, because doing it per
	// hop would add a round trip to the middle of the chain — the one place the latency budget
	// has already been divided up.
	//
	// Fails open, like health: `integrations.md` section 3's table. Losing a cooldown costs a
	// wasted attempt at a provider that was about to block us, which is money; refusing the
	// request instead would cost the request.
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
				order.flatMap((o) => {
					const k = keysFor(o.id);
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
	const cooled: { readonly provider: string; readonly untilMs: number }[] = [];
	const attemptable = order.filter((o) => {
		const cd = cooldownFor(o.id);
		if (cd.kind !== 'cooling') return true;
		cooled.push({ provider: o.id, untilMs: cd.untilMs });
		return false;
	});

	if (attemptable.length === 0) {
		// Every capable provider is cooling on this domain or this account. There is no floor
		// here, and that is the difference from health: a demoted provider is a guess about a
		// trend, while a cooldown is a fact — each of these providers refused this exact
		// domain within the last few minutes. Forcing one buys a probable second refusal at
		// full price. Say so instead, with the moment it stops being true.
		const soonest = Math.min(...cooled.map((c) => c.untilMs));
		return {
			outcome: 'NO_PROVIDER_AVAILABLE',
			attempts,
			retryAfterMs: Math.max(0, soonest - now()),
			reason: `every capable provider is cooling on ${domain}: ${cooled
				.map((c) => c.provider)
				.join(', ')}`,
		};
	}

	let lastOutcome: Outcome = 'NO_PROVIDER_AVAILABLE';
	let onceUsed = false;

	for (let i = 0; i < attemptable.length; i++) {
		const entry = attemptable[i] as (typeof attemptable)[number];
		const { adapter, key } = entry.candidate;
		const providerHealth: HealthState['state'] | 'demoted-forced' = forced
			? 'demoted-forced'
			: entry.state;

		// A `probe` has to be CLAIMED before anything is spent. Two concurrent requests both
		// seeing an expired cooldown and both proceeding is the herd the half-open design
		// exists to stop, and it only appears under load.
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
			// Somebody else is already probing. Rare, so the budget for the hops behind is now
			// marginally conservative rather than wrong, which is the safe direction.
			if (!claimed) continue;
		}

		const hopsLeft = attemptable.length - i - 1;
		const isLastHop = hopsLeft === 0;
		const cap = isLastHop
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
			});
			return {
				outcome: 'INVALID_REQUEST',
				attempts,
				reason: err instanceof Error ? err.message : String(err),
			};
		}

		const res = await deps.transport.execute(wire, {
			budgetMs: budget.perAttemptMs,
			maxBodyBytes: deps.maxBodyBytes,
		});

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
					const verdict = detect(parsed.body, parsed.contentType, parsed.charset);
					if (verdict.blocked) {
						outcome = 'SOFT_BLOCK';
						detectRuleId = verdict.ruleId;
					}
				}
				break;
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
			if (cdKey !== null) {
				deps.cooldowns?.arm(cdKey, now());
			} else if (outcome === 'OK') {
				// A provider that just served this domain is not cooled on it. Clearing on OK is
				// what makes a successful probe end the cooldown rather than merely pause it.
				const blk = keysFor(adapter.capabilities.id).blk;
				deps.cooldowns?.clear(blk);
				deps.cooldowns?.clear(keysFor(adapter.capabilities.id).acct);
			}
		} catch {
			// Best effort, like health. A cooldown we failed to write costs one future attempt.
		}

		attempts.push({
			provider: adapter.capabilities.id,
			outcome,
			budgetMs: budget.perAttemptMs,
			...(res.kind === 'response' ? { latencyMs: res.latencyMs } : {}),
			...(parsed === undefined ? {} : { costMicrocredits: parsed.cost.microcredits }),
			...(detectRuleId === undefined ? {} : { detectRuleId }),
		});
		lastOutcome = outcome;

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
			return {
				outcome,
				attempts,
				provider: adapter.capabilities.id,
				providerHealth,
				...(detectRuleId === undefined ? {} : { detectRuleId }),
				...(parsed === undefined ? {} : { result: parsed }),
			};
		}
	}

	// Unreachable while order.length > 0: the last hop always returns above. Kept honest
	// rather than thrown away, because "cannot happen" is how a silent wrong answer ships.
	return { outcome: lastOutcome, attempts, reason: 'chain exhausted' };
}

export { MIN_USEFUL_ATTEMPT_MS };
