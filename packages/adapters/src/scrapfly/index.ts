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
import { ScrapflyEnvelope } from './schema.js';

// Both functions are PURE. No I/O, no clock, no randomness.

const ENDPOINT = 'https://api.scrapfly.io/scrape';

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	if (req.method !== 'GET') {
		throw new Error('scrapfly: POST is not implemented (capabilities.post is false)');
	}

	const p = new URLSearchParams();
	// UNLIKE the other two, the key has to travel in the query string: Scrapfly documents no
	// header form. So this URL contains a live credential and must never be logged raw. The
	// recorder redacts by value and asserts afterwards, which is the only reason a fixture of
	// this provider is safe to commit at all.
	p.set('key', key);
	p.set('url', req.url);
	p.set('render_js', String(req.renderJs));
	// Their anti-scraping-protection bypass, and what 'stealth' means for this provider.
	p.set('asp', String(req.premium === 'stealth'));
	p.set(
		'proxy_pool',
		req.premium === 'none' ? 'public_datacenter_pool' : 'public_residential_pool',
	);
	// EXPLICITLY OFF, and this is the important one. `retry` DEFAULTS TO TRUE: Scrapfly
	// retries network and 5xx failures internally. FAILOVER defines retry centrally, exactly
	// once, so a provider retrying underneath us spends budget and money we never authorised,
	// and reports a latency that silently contains attempts we cannot see.
	p.set('retry', 'false');
	p.set('cache', 'false');
	// Their default is 150_000 — more than twice our own ceiling.
	p.set('timeout', String(capabilities.maxTimeoutMs));
	// `raw` is the page as delivered. The alternatives (clean_html, markdown, text) are
	// transformations, and a gateway that silently rewrites the page is not a proxy.
	p.set('format', 'raw');
	// NOTE: `country` is deliberately absent when the caller did not ask for one. Their
	// default is *random*, which cannot be stated explicitly — the one parameter here that
	// resists the no-leaking-defaults rule, because there is no token meaning "random".
	if (req.countryCode !== undefined) p.set('country', req.countryCode.toLowerCase());

	return {
		url: `${ENDPOINT}?${p.toString()}`,
		method: 'GET',
		headers: { accept: 'application/json' },
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/** The status came from the TARGET. */
function outcomeForTarget(status: number): Outcome {
	if (status >= 200 && status < 300) return 'OK';
	if (status === 404) return 'TARGET_NOT_FOUND';
	if (status === 403) return 'HARD_BLOCK';
	return 'TARGET_ERROR';
}

/** No `result` in the envelope: Scrapfly never reached the target. */
function outcomeForProvider(status: number): Outcome {
	if (status === 400) return 'INVALID_REQUEST';
	if (status === 401 || status === 402 || status === 403) return 'AUTH_FAILED';
	if (status === 429) return 'RATE_LIMITED';
	return 'PROVIDER_ERROR';
}

/**
 * Their structured error codes, which are more specific than a status.
 *
 * Only the ones whose mapping is unambiguous are listed; anything else falls through to the
 * status, because inventing a mapping for a code we have not seen is how a fabricated
 * outcome enters the taxonomy.
 */
function outcomeForErrorCode(code: string): Outcome | undefined {
	if (code.startsWith('ERR::ASP::')) return 'HARD_BLOCK';
	if (code === 'ERR::SCRAPE::UPSTREAM_TIMEOUT') return 'TARGET_ERROR';
	// Observed against a target too slow for them: they reached out and got nothing back.
	// A fact about the target's reachability, not about Scrapfly being down.
	if (code === 'ERR::SCRAPE::NETWORK_ERROR') return 'TARGET_ERROR';
	if (code === 'ERR::THROTTLE::MAX_CONCURRENT_REQUEST_EXCEEDED') return 'RATE_LIMITED';
	return undefined;
}

function parse(res: ProviderHttpResponse): ParsedResult {
	const fallbackCost = {
		microcredits: capabilities.costTable.base,
		source: 'estimated' as const,
	};

	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(res.body));
	} catch {
		// They document JSON on every path. A non-JSON body is a contract break.
		return { outcome: 'PROVIDER_DRIFT', cost: fallbackCost };
	}

	const env = ScrapflyEnvelope.safeParse(json);
	if (!env.success) {
		// No `result` means an account-level failure they never got past — the status is the
		// whole signal. Distinguished structurally rather than by status, because a target 403
		// and an out-of-credits 403 are the same number and very different facts.
		if (typeof json === 'object' && json !== null && !('result' in json)) {
			return { outcome: outcomeForProvider(res.status), cost: fallbackCost };
		}
		// A `result` that does not match the schema is drift: the fields parse() depends on
		// changed under us, and guessing past that is how a silent misparse ships.
		return { outcome: 'PROVIDER_DRIFT', cost: fallbackCost };
	}

	const { result, context } = env.data;
	const total = context?.cost?.total;
	const cost =
		total === undefined
			? fallbackCost
			: { microcredits: Math.round(total * 1_000_000), source: 'reported' as const };

	// BYTES, WITH A CAVEAT THAT IS THIS PROVIDER'S ALONE.
	//
	// `integrations.md` section 2 requires post-transfer-decoding, PRE-charset-decoding
	// bytes, so that /detect fingerprints the page rather than mojibake. Scrapfly cannot
	// satisfy it: `format: 'text'` means they already decoded the page and hand back a UTF-8
	// string, and the original bytes are not offered on any parameter. So the honest thing is
	// to re-encode to UTF-8 and declare utf-8 — the content is intact, the ORIGINAL ENCODING
	// is gone, and a mis-decode on their side is undetectable here. `format: 'binary'` is
	// base64 and does round-trip exactly.
	const body =
		result.format === 'binary' || result.format === 'blob'
			? Uint8Array.from(Buffer.from(result.content, 'base64'))
			: new TextEncoder().encode(result.content);

	const base = {
		charset: 'utf-8',
		...(result.content_type === undefined ? {} : { contentType: result.content_type }),
		cost,
	};

	const byCode =
		result.error?.code === undefined || result.error.code === null
			? undefined
			: outcomeForErrorCode(result.error.code);

	if (result.status_code === null) {
		// No target response, so there is no upstream status to report and none to infer one
		// from. The error code is the only signal; an unrecognised one falls to
		// PROVIDER_ERROR, which is the visible direction rather than the silent one.
		return { ...base, outcome: byCode ?? 'PROVIDER_ERROR' };
	}

	const outcome = byCode ?? outcomeForTarget(result.status_code);

	return {
		...base,
		outcome,
		upstreamStatusCode: result.status_code,
		// Single-sourced in the contract, not decided here: three adapters each deciding it
		// inline is how the rule drifted in the first place.
		...(carriesBody(outcome) ? { body } : {}),
	};
}

export const ScrapflyAdapter: Adapter = { capabilities, translate, parse };
