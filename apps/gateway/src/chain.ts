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
import { guardTargetUrl } from '@proxlane/shared';
import { hopBudget, MIN_USEFUL_ATTEMPT_MS } from './budget.js';
import type { HttpTransport } from './transport.js';

export interface Attempt {
	readonly provider: string;
	readonly outcome: Outcome;
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
	readonly result?: ParsedResult;
	readonly provider?: string;
	/** Every hop, in order. The logged grain is the attempt, not the request. */
	readonly attempts: readonly Attempt[];
	readonly reason?: string;
}

export interface ChainDeps {
	readonly transport: HttpTransport;
	/** Resolved and ordered by the caller; BYOK means keys arrive per request. */
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	readonly maxBodyBytes: number;
	readonly now?: () => number;
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

	const eligible = deps.candidates.filter((c) => isCapable(c.adapter.capabilities, guarded));
	if (eligible.length === 0) {
		return {
			outcome: 'NO_PROVIDER_AVAILABLE',
			attempts,
			reason:
				deps.candidates.length === 0
					? 'no providers configured'
					: 'no configured provider has the requested capabilities',
		};
	}

	let lastOutcome: Outcome = 'NO_PROVIDER_AVAILABLE';
	let onceUsed = false;

	for (let i = 0; i < eligible.length; i++) {
		const { adapter, key } = eligible[i] as { adapter: Adapter; key: string };
		const hopsLeft = eligible.length - i - 1;
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
		switch (res.kind) {
			case 'response':
				parsed = adapter.parse(res.response);
				outcome = parsed.outcome;
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

		attempts.push({
			provider: adapter.capabilities.id,
			outcome,
			budgetMs: budget.perAttemptMs,
			...(res.kind === 'response' ? { latencyMs: res.latencyMs } : {}),
			...(parsed === undefined ? {} : { costMicrocredits: parsed.cost.microcredits }),
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
				...(parsed === undefined ? {} : { result: parsed }),
			};
		}
	}

	// Unreachable while eligible.length > 0: the last hop always returns above. Kept honest
	// rather than thrown away, because "cannot happen" is how a silent wrong answer ships.
	return { outcome: lastOutcome, attempts, reason: 'chain exhausted' };
}

export { MIN_USEFUL_ATTEMPT_MS };
