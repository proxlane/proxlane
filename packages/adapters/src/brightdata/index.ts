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
	BRD_STATUS_HEADER,
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
		// `raw`, and this is a reversal. The original said "`json`, never `raw`. Raw returns the
		// body and an API 200 whatever the target did, so a 404 is indistinguishable from a
		// success" — true of the API's own status line, and false of the response as a whole.
		// Bright Data puts the target's status in `x-brd-status-code` on every raw response.
		//
		// With that header, raw is a strict superset of json here. Measured 2026-08-19:
		//
		//   target status   x-brd-status-code, correct for 404, 503 and 200
		//   provider errors x-brd-error-code + x-brd-error, both still present
		//   content type    the target's own, directly on the response
		//   body            the ORIGINAL BYTES
		//
		// That last line is why it matters beyond images. The json envelope carries `body` as a
		// lossy UTF-8 string — verified: a JPEG arrives as `efbfbd` mojibake and there is no
		// base64 field — so binary was impossible and the charset was a guess. `integrations.md`
		// section 2 asks for post-transfer-decoding, PRE-charset-decoding bytes so the detector
		// fingerprints the page rather than a re-encoding of it, and json could not supply them.
		format: 'raw',
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
	// The API's OWN status, before anything about the target. 200 for everything it accepted,
	// including every kind of target failure; anything else is a request or credential problem.
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

	const code = header(res.headers, BRD_ERROR_HEADER);
	const message = header(res.headers, BRD_MESSAGE_HEADER);
	const statusHeader = header(res.headers, BRD_STATUS_HEADER);
	const targetStatus = statusHeader === undefined ? undefined : Number(statusHeader);

	// NO x-brd-status-code AND NO ERROR is drift. In raw mode that header is how the target's
	// answer reaches us at all, so its absence means the contract changed under us — which is
	// the one thing PROVIDER_DRIFT is for. Checked before the error branches, because those can
	// legitimately arrive without it.
	if (code === undefined && (targetStatus === undefined || !Number.isFinite(targetStatus))) {
		return { outcome: 'PROVIDER_DRIFT', cost: COST };
	}

	// THE PART THAT MATTERS. A failure here means one of three unrelated things, and the status
	// alone cannot tell them apart:
	//
	//   the target returned a status Bright Data rejects   -> a TARGET fact
	//   the host does not resolve                          -> a TARGET fact
	//   Bright Data itself failed                          -> a PROVIDER fact
	//
	// Reading only the status would file all three as PROVIDER_ERROR: blaming the provider for a
	// dead target, cooling it down for a domain that is simply gone, and failing over twice more
	// to rediscover the same 404.
	if (code !== undefined && message !== undefined) {
		if (code === 'http_status') {
			// The target's status is in the message here rather than the status header, because
			// Bright Data rejected the response and reports its own 502 as the status.
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
				// The target refused, having been unblocked successfully. That is a hard block: the
				// provider did its job and the site said no anyway.
				return { outcome: 'HARD_BLOCK', upstreamStatusCode: target, cost: COST };
			}
		}
		// THE PROVIDER SAYING IT WAS BLOCKED. `reject_block` means the Unlocker reached the
		// target, found a captcha or protection page, and refused to hand it over.
		//
		// That is HARD_BLOCK, not PROVIDER_ERROR. The distinction is the product: a provider
		// error says try someone else because this one is broken; a hard block says the target is
		// defended and the next provider will probably meet the same wall. They cool differently.
		//
		// HARD_BLOCK is the one block an adapter may return, precisely because the provider says
		// so in the response. SOFT_BLOCK stays the gateway's to assign, after detection.
		if (code === 'reject_block') {
			return { outcome: 'HARD_BLOCK', ...upstream(targetStatus), cost: COST };
		}
		// A HOST THAT DOES NOT EXIST, which arrives as `proxy_error` — the same code Bright Data
		// uses for its own network trouble. Left in the catch-all below it became PROVIDER_ERROR:
		// a dead domain blamed on the provider, cooling it for everyone, and since PROVIDER_ERROR
		// is the retryable one, buying a second identical failure at the terminal hop.
		//
		// Matched on the message because `proxy_error` genuinely covers both. A reword falls back
		// to PROVIDER_ERROR, which is the previous behaviour rather than something new; the
		// fixture is what keeps it from happening quietly.
		if (code === 'proxy_error' && /could not resolve host/i.test(message)) {
			return { outcome: 'TARGET_ERROR', ...upstream(targetStatus), cost: COST };
		}
		// Anything else Bright Data names is its own failure to deliver a page.
		return { outcome: 'PROVIDER_ERROR', ...upstream(targetStatus), cost: COST };
	}

	// No error header: the status header carries the target's real answer.
	if (targetStatus === 404) {
		return { outcome: 'TARGET_NOT_FOUND', upstreamStatusCode: 404, cost: COST };
	}
	if (targetStatus === 429) {
		return { outcome: 'TARGET_RATE_LIMITED', upstreamStatusCode: 429, cost: COST };
	}
	if (targetStatus === 403 || targetStatus === 401) {
		return { outcome: 'HARD_BLOCK', upstreamStatusCode: targetStatus, cost: COST };
	}
	if (targetStatus !== undefined && targetStatus >= 500) {
		return { outcome: 'TARGET_ERROR', upstreamStatusCode: targetStatus, cost: COST };
	}

	// A 2xx or 3xx with a body. NOT called a success here: the detector runs downstream and
	// decides whether this is content or a challenge page wearing a 200.
	//
	// THE BODY IS THE ORIGINAL BYTES, which is the whole gain of raw mode — no decode, no
	// re-encode, so a JPEG survives and the detector fingerprints what the target actually sent.
	const contentType = header(res.headers, 'content-type');
	const charset = charsetFrom(contentType);
	return {
		outcome: 'OK',
		body: res.body,
		contentType: contentType ?? 'application/octet-stream',
		// The TARGET's charset, from its own content-type, rather than the utf-8 the json
		// envelope forced us to claim. Absent when they sent none, which is honest: the detector
		// works on bytes and the gateway decides how to decode.
		...(charset === undefined ? {} : { charset }),
		...upstream(targetStatus),
		cost: COST,
	};
}

/** `upstreamStatusCode` only when there is a real number to report. */
function upstream(status: number | undefined): { upstreamStatusCode?: number } {
	return status === undefined || !Number.isFinite(status) ? {} : { upstreamStatusCode: status };
}

/** `text/html; charset=iso-8859-1` -> `iso-8859-1`. */
function charsetFrom(contentType: string | undefined): string | undefined {
	if (contentType === undefined) return undefined;
	const m = /charset=\s*"?([^";]+)"?/i.exec(contentType);
	return m?.[1]?.trim().toLowerCase();
}

void MICROCREDITS_PER_CREDIT;

export const BrightdataAdapter: Adapter = {
	capabilities,
	translate,
	parse,
};
