import { parseRetryAfter } from '@proxlane/shared';
import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../contract.js';
import { carriesBody } from '../contract.js';
import { capabilities } from './capabilities.js';
import { ScrapingbeeMeta } from './schema.js';

// Both functions are PURE. No I/O, no clock, no randomness.

const ENDPOINT = 'https://app.scrapingbee.com/api/v1/';

/**
 * The header that makes ScrapingBee honest, and the reason this adapter can do something
 * ScraperAPI's cannot.
 *
 * Present  → ScrapingBee reached the target, and the HTTP status IS the target's.
 * Absent   → ScrapingBee itself failed and never got there.
 *
 * Verified against the live API 2026-08-07: a bad key returns 401 with this header absent
 * and a JSON error body; a target 503 returns 503 with `spb-initial-status-code: 503` and
 * `spb-cost: 0`. So "the target is broken" and "the provider is broken" are distinguishable
 * here, which is precisely what ScraperAPI's single 500 cannot express.
 */
const INITIAL_STATUS = 'spb-initial-status-code';

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	if (req.method !== 'GET') {
		throw new Error('scrapingbee: POST is not implemented (capabilities.post is false)');
	}

	const p = new URLSearchParams();
	p.set('url', req.url);
	// EVERY parameter explicit. Two of these are not merely tidiness:
	//
	//   render_js DEFAULTS TO TRUE. Omitting it renders every request and bills 5 credits
	//   instead of 1 — a 5x silent overspend on plain fetches.
	//
	//   transparent_status_code DEFAULTS TO FALSE, which returns 200 for a target's 404.
	//   That is the honest-success-detection failure the product exists to prevent, shipped
	//   by default, and it is opt-out.
	p.set('render_js', String(req.renderJs));
	p.set('transparent_status_code', 'true');
	p.set('premium_proxy', String(req.premium === 'residential'));
	p.set('stealth_proxy', String(req.premium === 'stealth'));
	// Their default is true. Kept true — we return HTML, not a rendering — but pinned so a
	// change on their side cannot change what our callers receive.
	p.set('block_resources', 'true');
	p.set('block_ads', 'false');
	// Their pre-JS source, which is NOT what renderJs promises.
	p.set('return_page_source', 'false');
	// Raw bytes, not a JSON envelope: a wrapped body arrives charset-decoded as a string and
	// bakes mojibake into the fixture, which /detect would then fingerprint.
	p.set('json_response', 'false');
	p.set('device', 'desktop');
	// Their default is 140_000 — twice our own ceiling. Bound it to ours, or a hung attempt
	// outlives the budget the router allocated it.
	p.set('timeout', String(capabilities.maxTimeoutMs));
	if (req.countryCode !== undefined) p.set('country_code', req.countryCode.toLowerCase());

	const headers: Record<string, string> = {
		// Bearer, not the deprecated api_key query parameter — and it keeps the key out of the
		// URL that reaches fixtures, logs and error messages.
		authorization: `Bearer ${key}`,
		accept: '*/*',
	};
	if (req.headers !== undefined) {
		// ScrapingBee forwards headers prefixed Spb-, rather than raw.
		for (const [k, v] of Object.entries(req.headers)) headers[`Spb-${k}`] = v;
	}

	return {
		url: `${ENDPOINT}?${p.toString()}`,
		method: 'GET',
		headers,
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/** The status came from the TARGET, so target semantics apply. */
function outcomeForTarget(status: number): Outcome {
	if (status >= 200 && status < 300) return 'OK';
	if (status === 404) return 'TARGET_NOT_FOUND';
	// A target 403 is an anti-bot refusal far more often than a genuine permission error.
	// NOT TARGET_FORBIDDEN, which means rejected at OUR edge.
	if (status === 403) return 'HARD_BLOCK';
	// Same taxonomy gap as everywhere else: a TARGET throttling us is not RATE_LIMITED,
	// which is scoped to the provider account and would cool the wrong thing.
	// The target is throttling us. Distinct from RATE_LIMITED, which is OUR account against
	// the provider — this one is domain-scoped and shared, because it is a property of the
	// site. As TARGET_ERROR it armed no cooldown and the next request repeated it, which is
	// what escalates a rate limit into a ban.
	if (status === 429) return 'TARGET_RATE_LIMITED';
	if (status >= 500) return 'TARGET_ERROR';
	return 'TARGET_ERROR';
}

/** ScrapingBee never reached the target, so this is a fact about them or our key. */
function outcomeForProvider(status: number): Outcome {
	if (status === 400) return 'INVALID_REQUEST';
	if (status === 401) return 'AUTH_FAILED';
	// 402 is out of credits, which is an account fact like an expired key.
	if (status === 402 || status === 403) return 'AUTH_FAILED';
	if (status === 429) return 'RATE_LIMITED';
	return 'PROVIDER_ERROR';
}

function parse(res: ProviderHttpResponse): ParsedResult {
	const contentType = res.headers['content-type'];
	const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim();

	const baseCost = {
		microcredits: capabilities.costTable.base,
		source: 'estimated' as const,
	};
	const withoutMeta = {
		...(charset === undefined ? {} : { charset }),
		...(contentType === undefined ? {} : { contentType }),
		cost: baseCost,
	};

	if (res.headers[INITIAL_STATUS] === undefined) {
		// They never reached the target, so nothing here is a fact about it. Their own error
		// body is JSON, but it is not parsed for control flow: the STATUS decides the outcome,
		// and a schema failure on a message string must not turn a clear 401 into drift.
		return { ...withoutMeta, outcome: outcomeForProvider(res.status) };
	}

	// Validated, never cast. The header this adapter's correctness rests on can be present
	// and nonsense — `Number('')` is 0 and `Number('abc')` is NaN, and both would otherwise
	// pass for "a status". Guessing target-vs-provider from the bare status instead is how
	// the ScraperAPI ambiguity would get reintroduced here, so a bad header is drift.
	const meta = ScrapingbeeMeta.safeParse(res.headers);
	if (!meta.success) return { ...withoutMeta, outcome: 'PROVIDER_DRIFT' };

	// REPORTED, not estimated. ScrapingBee returns the real figure per request, so the ledger
	// does not have to trust the cost table — and the table's inability to express
	// render+premium pricing stops mattering for billing.
	const spbCost = meta.data['spb-cost'];
	// The TARGET's Retry-After, which ScrapingBee copies under its own prefix like every other
	// target header. Measured against a target sending `Retry-After: 120`: it arrives as
	// `spb-retry-after: 120`. ScraperAPI strips the same header entirely, so no adapter may
	// assume it is there.
	const targetRetryAfter = parseRetryAfter(res.headers['spb-retry-after'], Date.now());

	const base = {
		...withoutMeta,
		...(targetRetryAfter === undefined ? {} : { retryAfterMs: targetRetryAfter }),
		cost:
			spbCost === undefined
				? baseCost
				: { microcredits: Math.round(spbCost * 1_000_000), source: 'reported' as const },
	};

	const upstream = meta.data['spb-initial-status-code'];
	const outcome = outcomeForTarget(upstream);
	return {
		...base,
		outcome,
		upstreamStatusCode: upstream,
		// Single-sourced in the contract, not decided here: three adapters each deciding it
		// inline is how the rule drifted in the first place.
		...(carriesBody(outcome) ? { body: res.body } : {}),
	};
}

export const ScrapingbeeAdapter: Adapter = { capabilities, translate, parse };
