// Sandbox mode: `X-Proxlane-Simulate: <OUTCOME>` answers as the chain would, having called
// nobody. `integrations.md` section 6 specifies it; `plan.md` section 18 is why it is the one
// free-try mechanism that needs no guardrail — it never fetches the target, so it cannot become
// a free scraping proxy, and it spends no credits, so there is nothing to bound.
//
// DERIVED FROM `FAILOVER`, WHICH IS THE ONLY REASON IT IS ALLOWED TO EXIST. The house rule is
// no hand-written fake responses, because a mock of a sixteen-member taxonomy is stale within
// one release and teaches callers to handle outcomes the gateway no longer emits. Everything
// below is read from the same table the router consults: the status from `httpStatus`, the
// attempt count from `failover`, whether a body comes back from `carriesBody`. Add an outcome
// to the taxonomy and it is simulable on the same commit, with no second table to update.
//
// HONOURED ONLY FOR THE SANDBOX KEY. A live key that sends the header gets a loud 400, never a
// silent ignore: ignoring it would let a caller believe they were testing while spending real
// credits, which is the exact failure this whole product is arranged against. That check lives
// in `app.ts`, next to auth, because it is auth.

import {
	carriesBody,
	type GatewayRequest,
	OUTCOMES,
	type Outcome,
	policyFor,
} from '@proxlane/adapters';
import { RULES } from '@proxlane/detect';
import { guardTargetUrl } from '@proxlane/shared';
import type { Attempt, ChainResult } from './chain.js';

export const SIMULATE_HEADER = 'x-proxlane-simulate';

/** What the chain reports as the provider when no provider is configured at all. */
const NOBODY = 'sandbox';

/**
 * The outcome a header value names, or why it cannot.
 *
 * Case-sensitive, because the header is a machine-readable value and the outcomes are a closed
 * vocabulary of our own spelling. Accepting `soft_block` would mean documenting two spellings
 * of every outcome, and the docs already have one.
 */
export function parseSimulate(
	raw: string | undefined,
): { readonly outcome: Outcome } | { readonly error: string } {
	if (raw === undefined || raw === '') return { outcome: 'OK' };
	if ((OUTCOMES as readonly string[]).includes(raw)) return { outcome: raw as Outcome };
	return {
		error: `X-Proxlane-Simulate must name an outcome. Known: ${OUTCOMES.join(', ')}`,
	};
}

/**
 * The chain's answer had every configured provider returned `outcome`.
 *
 * The attempt list is what the real chain would produce for that world, read off the policy:
 * a non-failover outcome stops at the first provider; `'once'` tries a second; `true` walks
 * the whole list. That is the shape a caller's retry logic has to handle, so it is the shape
 * the sandbox shows them — including `X-Chain` naming every hop.
 *
 * Zero milliseconds everywhere, deliberately. `upstreamMs` is what `Server-Timing` attributes
 * to providers, and nothing upstream happened.
 */
export function simulate(
	outcome: Outcome,
	providerIds: readonly string[],
	req: GatewayRequest,
): ChainResult {
	// THE EDGE GUARD RUNS HERE TOO, inside this function so no caller can skip it. The first
	// version replaced `runChain` wholesale, and `runChain` is where the guard lived — so a
	// sandbox request for a metadata address answered a simulated 200 where live answers
	// TARGET_FORBIDDEN. No connection opened, so nothing leaked; but a caller's SSRF regression
	// test would have passed in the sandbox and failed in production, which inverts the one
	// promise a sandbox makes. Found in review. The reflected URL below is the string the guard
	// judged, for the reason chain.ts gives: validate one string, echo another, and the echo is
	// the bypass.
	const verdict = guardTargetUrl(req.url);
	if (!verdict.allowed) {
		return { outcome: verdict.outcome, attempts: [], reason: verdict.reason };
	}
	const url = verdict.url.href;
	const policy = policyFor(outcome);
	const ids = providerIds.length === 0 ? [NOBODY] : providerIds;
	const hops =
		policy.failover === true
			? ids.length
			: policy.failover === 'once'
				? Math.min(2, ids.length)
				: 1;
	// The detector's first rule, read from the detector, so the header carries an id that
	// exists. A SOFT_BLOCK without a rule id is a shape the real chain never produces.
	const detectRuleId = outcome === 'SOFT_BLOCK' ? RULES[0]?.id : undefined;
	const attempts: Attempt[] = ids.slice(0, hops).map((provider) => ({
		provider,
		outcome,
		...(detectRuleId === undefined ? {} : { detectRuleId }),
		budgetMs: req.deadlineMs,
		latencyMs: 0,
		upstreamMs: 0,
	}));
	const last = attempts[attempts.length - 1] as Attempt;
	return {
		outcome,
		attempts,
		provider: last.provider,
		reason: `simulated: ${policy.meaning}`,
		...(detectRuleId === undefined ? {} : { detectRuleId }),
		...(carriesBody(outcome)
			? {
					result: {
						outcome,
						body: new TextEncoder().encode(simulatedPage(outcome, url)),
						contentType: 'text/html; charset=utf-8',
						charset: 'utf-8',
						// The only outcome whose status is `upstream` is OK, and a simulated OK is a 200.
						// Every other body-carrying outcome takes its status from the table.
						...(policy.httpStatus === 'upstream' ? { upstreamStatusCode: 200 } : {}),
						cost: { microcredits: 0, source: 'reported' },
					},
				}
			: {}),
	};
}

/**
 * The body, for outcomes that carry one. It says what it is in the first line, so a page that
 * escapes a test harness into a real pipeline is caught by anyone who reads it.
 */
function simulatedPage(outcome: Outcome, url: string): string {
	const target = url.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
	return (
		'<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
		`<title>proxlane sandbox: ${outcome}</title></head>\n` +
		`<body><h1>Simulated ${outcome}</h1>\n` +
		`<p>No provider was called and nothing was fetched from <code>${target}</code>. ` +
		'This response was produced by the gateway from its own outcome table, for testing.</p>\n' +
		'</body></html>\n'
	);
}
