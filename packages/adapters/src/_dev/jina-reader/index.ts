import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../../contract.js';
import { capabilities } from './capabilities.js';
import { JinaReaderError } from './schema.js';

// Both functions are PURE. No I/O, no clock, no randomness.

const ENDPOINT = 'https://r.jina.ai/';

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	if (req.method !== 'GET') {
		// Better to refuse than to silently issue a GET and record a fixture labelled POST.
		throw new Error('jina-reader: POST is not supported (capabilities.post is false)');
	}

	// The target URL goes in the path RAW, not percent-encoded — that is the documented
	// shape and what the live service accepts.
	const url = `${ENDPOINT}${req.url}`;

	const headers: Record<string, string> = {
		accept: 'text/plain',
		// Set explicitly even though markdown is the default. "Provider defaults never leak"
		// is a house rule: a provider changing its default must not change our behaviour.
		'x-respond-with': 'markdown',
		// Also explicit. A cached answer is not a recording of the provider's CURRENT
		// behaviour, and this adapter exists to feed the recorder.
		'x-no-cache': 'true',
	};

	// Keyless is the whole point, but the tier accepts a key for higher limits. Only send
	// the header when there is something to send — an empty Bearer is a malformed request,
	// not an anonymous one.
	if (key !== '') headers.authorization = `Bearer ${key}`;

	// NOTE: req.renderJs is deliberately not translated into anything. The service always
	// renders and offers no switch, so there is no parameter to set explicitly and nothing
	// honest to do with `renderJs: false`. Documented in capabilities.ts.

	return {
		url,
		method: 'GET',
		headers,
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/**
 * Pull the upstream status out of the service's own header block.
 *
 * The service answers a failed fetch with **200** and a `Warning:` line — it reports the
 * target's failure in the body while the transport says success. Reading only the status
 * here would record every dead target as OK, which is the exact failure proxlane exists to
 * prevent, so this is the honest-detection path rather than a nicety.
 *
 * Scoped to the envelope, not the whole body: everything after `Markdown Content:` is the
 * TARGET's own text, and a scraped page that happens to contain a Warning line must not be
 * read as a provider signal.
 */
function upstreamStatusFrom(text: string): number | undefined {
	const contentAt = text.indexOf('Markdown Content:');
	const envelope = contentAt === -1 ? text : text.slice(0, contentAt);
	const m = envelope.match(/^Warning: Target URL returned error (\d{3}):/m);
	return m?.[1] === undefined ? undefined : Number(m[1]);
}

/** Map a status the TARGET returned (relayed to us as a 200) onto the taxonomy. */
function outcomeForUpstream(status: number): Outcome {
	if (status === 404) return 'TARGET_NOT_FOUND';
	if (status >= 500) return 'TARGET_ERROR';
	// A 403 from a scraping target is overwhelmingly an anti-bot refusal, which is what
	// HARD_BLOCK describes — the block is asserted in the response rather than inferred by
	// /detect. Note it is NOT TARGET_FORBIDDEN: that outcome means rejected at OUR edge
	// (private range, denylist, metadata address) and has nothing to do with the target.
	if (status === 403) return 'HARD_BLOCK';
	// TAXONOMY GAP, recorded rather than improvised around: a 429 from the TARGET fits
	// nothing well. RATE_LIMITED is scoped to the provider account (cooldown 'acct'), so
	// using it here would cool down the wrong thing and could demote a healthy provider
	// because one target is strict. TARGET_ERROR fails over once, which is the behaviour we
	// want, so it is the interim home. See docs/integrations.md section 3.
	if (status === 429) return 'TARGET_ERROR';
	return 'TARGET_ERROR';
}

function parse(res: ProviderHttpResponse): ParsedResult {
	const contentType = res.headers['content-type'];
	const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim();
	// Zero on the keyless tier. `estimated` rather than `reported`: the service returns
	// x-usage-tokens, which is a token count, not a price — claiming `reported` would
	// overstate what we actually know.
	const cost = { microcredits: 0, source: 'estimated' as const };

	const base = {
		...(charset === undefined ? {} : { charset }),
		...(contentType === undefined ? {} : { contentType }),
		cost,
	};

	if (res.status === 200) {
		// Decoding to INSPECT is fine; the bytes handed on are always the originals. Decoding
		// on the way through is what bakes mojibake into a fixture permanently.
		const text = new TextDecoder('utf-8', { fatal: false }).decode(res.body);
		const upstream = upstreamStatusFrom(text);
		if (upstream !== undefined) {
			return {
				...base,
				outcome: outcomeForUpstream(upstream),
				upstreamStatusCode: upstream,
				body: res.body,
			};
		}
		return { ...base, outcome: 'OK', upstreamStatusCode: 200, body: res.body };
	}

	if (res.status === 401 || res.status === 403) return { ...base, outcome: 'AUTH_FAILED' };
	if (res.status === 429) return { ...base, outcome: 'RATE_LIMITED' };
	if (res.status >= 500) return { ...base, outcome: 'PROVIDER_ERROR' };

	if (res.status === 422) {
		let json: unknown;
		try {
			json = JSON.parse(new TextDecoder().decode(res.body));
		} catch {
			// Their documented error status carrying a body that is not JSON is a contract
			// break, which is what PROVIDER_DRIFT means.
			return { ...base, outcome: 'PROVIDER_DRIFT' };
		}
		const parsed = JinaReaderError.safeParse(json);
		// Never `as`-cast a provider payload: the cast is the drift signal, discarded.
		if (!parsed.success) return { ...base, outcome: 'PROVIDER_DRIFT' };
		// DNS failure is the target being unreachable, not our request being malformed —
		// TARGET_ERROR's meaning is literally "target site 5xx or DNS dead".
		if (/could not be resolved/i.test(parsed.data.message)) {
			return { ...base, outcome: 'TARGET_ERROR' };
		}
		return { ...base, outcome: 'BAD_REQUEST' };
	}

	// An undocumented status is a provider problem, not a schema failure.
	return { ...base, outcome: 'PROVIDER_ERROR' };
}

export const JinaReaderAdapter: Adapter = { capabilities, translate, parse };
