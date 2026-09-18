import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../contract.js';
import { cheapestCost } from '../contract.js';
import { capabilities } from './capabilities.js';
import { FirecrawlEnvelope, FirecrawlError } from './schema.js';

// Both functions are PURE. No I/O, no clock, no randomness.

const ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	// The scrape endpoint fetches the target itself, with GET, and takes no method or body
	// for it. `capabilities.post` is false so the router never sends one; this is the backstop
	// for the router being wrong, and conformance asserts it throws.
	if (req.method !== 'GET') {
		throw new Error('firecrawl: the scrape endpoint cannot forward a POST to the target');
	}
	// EVERY parameter explicit, and three of them are the difference between a scraping
	// gateway and a summariser:
	//
	//   formats DEFAULTS TO ["markdown"]. Omit it and the page comes back as prose with the
	//   markup gone, which is not what any caller of a scraping API asked for.
	//
	//   onlyMainContent DEFAULTS TO TRUE, which strips headers, navigation and footers before
	//   we ever see them. A block page's tell is often in exactly those parts.
	//
	//   maxAge DEFAULTS TO TWO DAYS, served from their cache. A cached page is a claim about
	//   the target as it was, and a cached block page is a block we can never fail over from.
	//   Zero means every request goes to the site.
	//
	// rawBase64 for anything not rendered: "the original HTTP response body", which is the
	// wire bytes the fixture contract wants and the only way a JPEG survives. rawHtml when
	// rendering, because the rendered DOM has no wire form; it arrives decoded, and parse()
	// re-encodes it as UTF-8 and says so. `binary` forces the bytes path whatever `renderJs`
	// says: there is no rendered form of an image.
	const wantsBytes = req.binary === true || !req.renderJs;
	const body: Record<string, unknown> = {
		url: req.url,
		formats: [wantsBytes ? 'rawBase64' : 'rawHtml'],
		onlyMainContent: false,
		onlyCleanContent: false,
		maxAge: 0,
		// Their cache stores our scrape for anyone who asks next. Off: the target's page is the
		// caller's business, not a shared index.
		storeInCache: false,
		blockAds: false,
		mobile: false,
		// Their default. Pinned because a scraping provider that started verifying certificates
		// would fail targets the other three fetch, and the change would otherwise be silent.
		skipTlsVerification: true,
		// `enhanced` is their stealth pool. Never `auto`: auto escalates on its own, and an
		// escalation we did not ask for is a cost we cannot report.
		proxy: req.premium === 'stealth' ? 'enhanced' : 'basic',
		waitFor: 0,
		// Bound to ours. Their default is 60 000 and their ceiling 300 000.
		timeout: capabilities.maxTimeoutMs,
		// Their default is US, applied even when nothing was asked. Sent only when the caller
		// asked, so an unrequested geography is theirs to default and ours to report as such.
		...(req.countryCode === undefined
			? {}
			: { location: { country: req.countryCode.toUpperCase() } }),
		...(req.headers === undefined ? {} : { headers: req.headers }),
	};

	return {
		url: ENDPOINT,
		method: 'POST',
		body: JSON.stringify(body),
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/json',
			accept: 'application/json',
		},
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/** `data.metadata.statusCode` is the TARGET's, so target semantics apply. */
function outcomeForTarget(status: number): Outcome {
	if (status >= 200 && status < 300) return 'OK';
	if (status === 404) return 'TARGET_NOT_FOUND';
	// A target 403 is an anti-bot refusal far more often than a permission error, and it is
	// NOT TARGET_FORBIDDEN, which means refused at our own edge.
	if (status === 403) return 'HARD_BLOCK';
	// The site throttling us, domain-scoped. RATE_LIMITED is our account against Firecrawl.
	if (status === 429) return 'TARGET_RATE_LIMITED';
	return 'TARGET_ERROR';
}

/** Firecrawl never reached the target: a fact about them or about our account. */
function outcomeForProvider(status: number): Outcome {
	if (status === 400) return 'INVALID_REQUEST';
	if (status === 401 || status === 403) return 'AUTH_FAILED';
	// "Payment required to access this resource." Their credits are spent, the provider is
	// fine, and the next provider with credit should get the request. Read from the API
	// reference 2026-09-18; the fixture, once a free plan has run out, is the proof.
	if (status === 402) return 'QUOTA_EXHAUSTED';
	// "Request rate limit exceeded." Their per-minute cap and concurrency limit share this
	// status, and both are the account's, not the wallet's.
	if (status === 429) return 'RATE_LIMITED';
	return 'PROVIDER_ERROR';
}

function parse(res: ProviderHttpResponse): ParsedResult {
	const cost = {
		microcredits: cheapestCost(capabilities.costTable),
		// The scrape response carries no charge figure. Their table is one credit per page
		// whatever happened, so the estimate is exact in every case but the ones they refund.
		source: 'estimated' as const,
	};

	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(res.body));
	} catch {
		// They document JSON on every path. A non-JSON body is a contract break.
		return { outcome: 'PROVIDER_DRIFT', cost };
	}

	if (res.status !== 200) {
		// The status is the whole signal. The body is validated so a reshaped error is drift,
		// but its text is never read for control flow: a reworded message must not move a 402.
		const err = FirecrawlError.safeParse(json);
		if (!err.success) return { outcome: 'PROVIDER_DRIFT', cost };
		return { outcome: outcomeForProvider(res.status), cost };
	}

	const env = FirecrawlEnvelope.safeParse(json);
	if (!env.success) return { outcome: 'PROVIDER_DRIFT', cost };

	const { data } = env.data;
	const outcome = outcomeForTarget(data.metadata.statusCode);
	const contentType = data.metadata.contentType;

	// BYTES WHERE THEY EXIST. `rawBase64` round-trips the wire body exactly, so the charset is
	// whatever the page declared and is left for the gateway to resolve from the body and the
	// content type. `rawHtml` is already decoded on their side, so, as with Scrapfly, the
	// honest answer is to re-encode as UTF-8 and declare it: content intact, original encoding
	// gone.
	if (typeof data.rawBase64 === 'string') {
		return {
			outcome,
			body: Uint8Array.from(Buffer.from(data.rawBase64, 'base64')),
			...(contentType === undefined ? {} : { contentType }),
			upstreamStatusCode: data.metadata.statusCode,
			cost,
		};
	}
	if (typeof data.rawHtml === 'string') {
		return {
			outcome,
			body: new TextEncoder().encode(data.rawHtml),
			charset: 'utf-8',
			...(contentType === undefined ? {} : { contentType }),
			upstreamStatusCode: data.metadata.statusCode,
			cost,
		};
	}
	// A success envelope with neither format we asked for is not a page. Drift, so somebody
	// looks, rather than an empty OK that a caller would parse as a blank site.
	return { outcome: 'PROVIDER_DRIFT', cost };
}

export const FirecrawlAdapter: Adapter = {
	capabilities,
	translate,
	parse,
};
