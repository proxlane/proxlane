import type {
	Adapter,
	GatewayRequest,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../contract.js';
import { MICROCREDITS_PER_CREDIT } from '../contract.js';
import { capabilities } from './capabilities.js';
import {
	BRD_ERROR_HEADER,
	BRD_MESSAGE_HEADER,
	BrightdataResponse,
	targetStatusFromMessage,
} from './schema.js';

const ENDPOINT = 'https://api.brightdata.com/request';

/**
 * The key carries the zone: `<zone>:<token>`.
 *
 * Bright Data needs two values per account and `translate` is handed one. The alternatives
 * were worse: reading `process.env` would end the purity the whole test strategy rests on,
 * and widening the adapter contract for one provider's account model would make every other
 * adapter carry a field it does not use.
 *
 * A BARE TOKEN DOES NOT THROW. `translate` is pure and total: a config mistake is not an
 * exception, it is a credential that will be refused, and the taxonomy already has a word
 * for that. A missing zone sends an empty one, Bright Data answers `zone "" not found` with
 * HTTP 400, and `parse` maps that to AUTH_FAILED — which cools the account rather than the
 * domain and tells the operator exactly what is wrong.
 *
 * Throwing here also broke `pnpm conformance`, which passes a placeholder key: an adapter
 * that cannot be exercised without live credentials cannot be tested against fixtures, and
 * being testable without credentials is the property that lets strangers contribute.
 */
function splitKey(key: string): { zone: string; token: string } {
	const at = key.indexOf(':');
	if (at <= 0 || at === key.length - 1) return { zone: '', token: key };
	return { zone: key.slice(0, at), token: key.slice(at + 1) };
}

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	const { zone, token } = splitKey(key);

	// EVERY PARAMETER EXPLICIT, including the ones whose default we happen to want.
	const payload: Record<string, unknown> = {
		zone,
		url: req.url,
		// `json`, never `raw`. Raw returns the body and an API 200 whatever the target did, so
		// a 404 is indistinguishable from a success. See schema.ts.
		format: 'json',
		method: req.method,
	};

	// `render` IS a real parameter, and the first version of this adapter wrongly assumed it
	// was not. The API validates strictly — an invented field is rejected with
	// `error_code: validation` — so acceptance is proof a parameter exists. `render` is
	// accepted, `proxy_type` and `session_id` are rejected, and that trio settled three
	// capability questions that documentation had not.
	//
	// Sent on every request, both values, because a provider default that changes under us
	// must not silently change our behaviour.
	payload.render = req.renderJs;
	if (req.countryCode !== undefined) payload.country = req.countryCode.toLowerCase();
	if (req.body !== undefined) payload.body = req.body;

	return {
		url: ENDPOINT,
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(payload),
		// The provider's own ceiling. The router replaces it with the per-attempt budget for
		// this hop; what matters here is that it is never zero, which `record` reads
		// literally and which made every fixture time out after 0 ms.
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/** Header lookup that survives a repeated header being folded into an array. */
function header(headers: Record<string, unknown>, name: string): string | undefined {
	const v = headers[name];
	if (typeof v === 'string') return v;
	if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
	return undefined;
}

/** Billed per successful request, one flat rate. */
const COST = {
	microcredits: capabilities.costTable.base,
	source: 'estimated' as const,
};

function parse(res: ProviderHttpResponse): ParsedResult {
	const text = new TextDecoder().decode(res.body);

	// The API's OWN status, before the envelope. 200 for everything it accepted, including
	// every kind of target failure; anything else is a request or credential problem and the
	// body is plain text rather than JSON.
	if (res.status !== 200) {
		// 401/403 is the token; 400 is usually a zone that does not exist. Both are account
		// facts, which is what AUTH_FAILED means and why it cools per-account rather than
		// per-domain.
		if (res.status === 401 || res.status === 403 || res.status === 400) {
			return { outcome: 'AUTH_FAILED', upstreamStatusCode: res.status, cost: COST };
		}
		if (res.status === 429) {
			return { outcome: 'RATE_LIMITED', upstreamStatusCode: 429, cost: COST };
		}
		return { outcome: 'PROVIDER_ERROR', upstreamStatusCode: res.status, cost: COST };
	}

	const parsed = BrightdataResponse.safeParse(JSON.parse(text));
	if (!parsed.success) {
		// The envelope changed shape. That is the one thing PROVIDER_DRIFT is for.
		return { outcome: 'PROVIDER_DRIFT', cost: COST };
	}
	const envelope = parsed.data;
	const code = header(envelope.headers, BRD_ERROR_HEADER);
	const message = header(envelope.headers, BRD_MESSAGE_HEADER);

	// THE PART THAT MATTERS. A 502 from this provider means one of three unrelated things,
	// and `status_code` alone cannot tell them apart:
	//
	//   the target returned a status Bright Data rejects   -> a TARGET fact
	//   the host does not resolve                          -> a TARGET fact
	//   Bright Data itself failed                          -> a PROVIDER fact
	//
	// Reading only the status would file all three as PROVIDER_ERROR: blaming the provider
	// for a dead target, cooling it down for a domain that is simply gone, and failing over
	// twice more to rediscover the same 404.
	if (code !== undefined && message !== undefined) {
		if (code === 'http_status') {
			const target = targetStatusFromMessage(message);
			if (target === 404) {
				return { outcome: 'TARGET_NOT_FOUND', upstreamStatusCode: 404, cost: COST };
			}
			if (target !== undefined && target >= 500) {
				return { outcome: 'TARGET_ERROR', upstreamStatusCode: target, cost: COST };
			}
			if (target === 429) {
				return { outcome: 'TARGET_RATE_LIMITED', upstreamStatusCode: 429, cost: COST };
			}
			if (target === 403 || target === 401) {
				// The target refused, having been unblocked successfully. That is a hard block:
				// the provider did its job and the site said no anyway.
				return { outcome: 'HARD_BLOCK', upstreamStatusCode: target, cost: COST };
			}
		}
		// THE PROVIDER SAYING IT WAS BLOCKED. `reject_block` means the Unlocker reached the
		// target, found a captcha or protection page, and refused to hand it over.
		//
		// That is HARD_BLOCK, not PROVIDER_ERROR. The distinction is the product: a provider
		// error says try someone else because this one is broken; a hard block says the target
		// is defended and the next provider will probably meet the same wall. They cool
		// differently and they mean different things to whoever reads the outcome.
		//
		// HARD_BLOCK is the one block an adapter may return, precisely because the provider
		// says so in the response. SOFT_BLOCK stays the gateway's to assign, after detection.
		if (code === 'reject_block') {
			return { outcome: 'HARD_BLOCK', upstreamStatusCode: envelope.status_code, cost: COST };
		}
		// Anything else Bright Data names is its own failure to deliver a page.
		return { outcome: 'PROVIDER_ERROR', upstreamStatusCode: envelope.status_code, cost: COST };
	}

	// No error header: the envelope carries the target's real answer.
	if (envelope.status_code === 404) {
		return { outcome: 'TARGET_NOT_FOUND', upstreamStatusCode: 404, cost: COST };
	}
	if (envelope.status_code === 429) {
		return { outcome: 'TARGET_RATE_LIMITED', upstreamStatusCode: 429, cost: COST };
	}
	if (envelope.status_code === 403 || envelope.status_code === 401) {
		return { outcome: 'HARD_BLOCK', upstreamStatusCode: envelope.status_code, cost: COST };
	}
	if (envelope.status_code >= 500) {
		return { outcome: 'TARGET_ERROR', upstreamStatusCode: envelope.status_code, cost: COST };
	}

	// A 2xx or 3xx with a body. NOT called a success here: the detector runs downstream and
	// decides whether this is content or a challenge page wearing a 200.
	return {
		outcome: 'OK',
		body: new TextEncoder().encode(envelope.body),
		contentType: header(envelope.headers, 'content-type') ?? 'text/html',
		// Honest rather than flattering: the body arrived already decoded, so utf-8 is what it
		// now is, whatever the target originally sent. See schema.ts.
		charset: 'utf-8',
		upstreamStatusCode: envelope.status_code,
		cost: COST,
	};
}

void MICROCREDITS_PER_CREDIT;

export const BrightdataAdapter: Adapter = {
	capabilities,
	translate,
	parse,
};
