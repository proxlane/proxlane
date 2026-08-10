import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../contract.js';
import { carriesBody, MICROCREDITS_PER_CREDIT } from '../contract.js';
import { capabilities } from './capabilities.js';

// Both functions are PURE. No I/O, no clock, no randomness — that is what lets them be
// tested against recorded bytes with nothing mocked.

const ENDPOINT = 'https://api.scraperapi.com/';

// There is deliberately NO schema.ts here, and the generated stub was deleted rather than
// left in place.
//
// ScraperAPI has no structured envelope to validate: success is the target's raw bytes and
// failure is a prose HTML page. The scaffold's `z.object({})` would have validated
// successfully against literally any object, so wiring it up later would pass everything
// and read as verification while checking nothing — the failure mode this repo keeps
// producing. An absent schema is honest; an empty one is a decoration that lies.
//
// Compare scrapingbee/schema.ts, which has real structure worth validating and therefore
// has a real schema.

/**
 * The TARGET's status, which ScraperAPI reports in a header.
 *
 * This corrects a documented mistake. The earlier version of this adapter matched on body
 * prose — `/You will not be charged for this request/i` — and both this file and
 * integrations.md section 3 asserted that "nothing in the status, the headers or the body"
 * separated a broken target from a broken provider. That was wrong, and the evidence was
 * already sitting in our own recordings: `sa-statuscode` is present on EVERY fixture, and
 * reads 503 on the broken-target case and 504 on the slow one. The two bodies really are
 * byte-identical, which is what was measured; the conclusion drawn from it was not checked
 * against the headers.
 *
 * So ScraperAPI is not the ambiguous provider after all. It is structured, like the other
 * two, and a body-text heuristic was never needed.
 */
const TARGET_STATUS_HEADER = 'sa-statuscode';
/** Their reported credit cost, also present on every fixture. */
const CREDIT_COST_HEADER = 'sa-credit-cost';

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	if (req.method !== 'GET') {
		throw new Error('scraperapi: POST is not implemented (capabilities.post is false)');
	}

	// EVERY parameter is set explicitly, including the ones whose default we happen to want.
	// A provider changing a default must not silently change our behaviour, and conformance
	// asserts no default leaks through.
	const p = new URLSearchParams();
	p.set('url', req.url);
	p.set('render', String(req.renderJs));
	p.set('premium', String(req.premium === 'residential'));
	p.set('ultra_premium', String(req.premium === 'stealth'));
	p.set('device_type', 'desktop');
	p.set('autoparse', 'false');
	p.set('follow_redirect', 'true');
	// Explicitly OFF. FAILOVER says TARGET_NOT_FOUND never fails over, because a real 404 is
	// a real 404 at the next provider too — and ScraperAPI charges for 404s, so retrying one
	// spends money to reach the same answer. Leaving this to their default would let them
	// decide our failover semantics.
	p.set('retry_404', 'false');
	// Only forward client headers when there are some; keep_headers=true with no headers
	// makes ScraperAPI drop its own sensible defaults for nothing.
	p.set('keep_headers', String(req.headers !== undefined));
	if (req.countryCode !== undefined) p.set('country_code', req.countryCode.toLowerCase());
	if (req.sessionId !== undefined) p.set('session_number', req.sessionId);
	// NOTE: output_format is deliberately absent. Its documented values are markdown/text/
	// json/csv and the HTML default is expressed by OMITTING it — there is no token meaning
	// "raw HTML", so it is the one parameter that cannot be set explicitly. Setting any value
	// would change what we get back.

	const headers: Record<string, string> = {
		// The key travels as a HEADER, not as api_key in the query string, though ScraperAPI
		// accepts both. The URL is written to fixtures, logs and error messages; a header is
		// one fewer place a live provider key can be copied out of by accident.
		'x-sapi-api_key': key,
		accept: '*/*',
	};
	if (req.headers !== undefined) Object.assign(headers, req.headers);

	return {
		url: `${ENDPOINT}?${p.toString()}`,
		method: 'GET',
		headers,
		timeoutMs: capabilities.maxTimeoutMs,
	};
}

/**
 * Map a status the TARGET returned, per `sa-statuscode`, onto the taxonomy.
 *
 * Identical semantics to scrapingbee's `outcomeForTarget`, deliberately: the same situation
 * must produce the same outcome whichever provider served it, or a caller cannot write
 * correct code. The previous version had no such function — it read 401/403/429 as
 * ScraperAPI's own, so a TARGET serving 403 came back AUTH_FAILED, which marks the
 * customer's key unhealthy and cools their whole ScraperAPI routing because one page has a
 * login wall.
 */
function outcomeForTarget(status: number): Outcome {
	if (status >= 200 && status < 300) return 'OK';
	if (status === 404) return 'TARGET_NOT_FOUND';
	// A target 403 is an anti-bot refusal far more often than a permission error. NOT
	// TARGET_FORBIDDEN, which means rejected at OUR edge.
	if (status === 403) return 'HARD_BLOCK';
	// Known taxonomy gap, same as the other two adapters: a TARGET throttling us is not
	// RATE_LIMITED, which is scoped to the provider account and would cool the wrong thing.
	return 'TARGET_ERROR';
}

function parse(res: ProviderHttpResponse): ParsedResult {
	const contentType = res.headers['content-type'];
	const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim();

	// REPORTED where they report it. `sa-credit-cost` is on every recording — 1 for a plain
	// fetch, 10 for a render — and the previous version ignored it, always returning the
	// table's base of 1. A rendered request therefore under-reported its cost by 10x, and
	// section 4's "sustained drift > 10%" alert could never fire for this provider because
	// there was no reported side to compare against.
	const reported = Number(res.headers[CREDIT_COST_HEADER]);
	const base = {
		...(charset === undefined ? {} : { charset }),
		...(contentType === undefined ? {} : { contentType }),
		cost: Number.isFinite(reported)
			? {
					microcredits: Math.round(reported * MICROCREDITS_PER_CREDIT),
					source: 'reported' as const,
				}
			: { microcredits: capabilities.costTable.base, source: 'estimated' as const },
	};

	// Body inclusion routes through the contract's carriesBody(), never a per-branch
	// decision. Hardcoding it in each case is what let this adapter return bytes for
	// TARGET_ERROR while the other two did not; matching by hand today is not the same as
	// being unable to diverge tomorrow.
	const withBody = (outcome: Outcome, upstreamStatusCode?: number) => ({
		...base,
		outcome,
		...(upstreamStatusCode === undefined ? {} : { upstreamStatusCode }),
		...(carriesBody(outcome) ? { body: res.body } : {}),
	});

	// `sa-statuscode` is the discriminator, exactly as ScrapingBee's `spb-initial-status-code`
	// is. Present → they reached the target and this is the TARGET's status. Absent → they
	// never got there and the failure is theirs or the key's.
	//
	// Structural, never prose. The previous version read a phrase out of the body because it
	// believed no header existed; that belief was wrong and the header was in every fixture
	// we had already recorded.
	const initial = res.headers[TARGET_STATUS_HEADER];
	if (initial !== undefined) {
		const upstream = Number(initial);
		if (!Number.isInteger(upstream) || upstream < 100 || upstream > 599) {
			// Present but nonsense is a contract break, not something to guess past.
			return withBody('PROVIDER_DRIFT');
		}
		const outcome = outcomeForTarget(upstream);
		return {
			...base,
			outcome,
			upstreamStatusCode: upstream,
			...(carriesBody(outcome) ? { body: res.body } : {}),
		};
	}

	// No target status: ScraperAPI itself answered. Their own documented codes.
	switch (res.status) {
		case 400:
			// OUR translation produced a bad provider request. A real bug, and it pages.
			return withBody('INVALID_REQUEST');
		case 401:
			return withBody('AUTH_FAILED');
		case 403:
			// Credits exhausted for the cycle — an account fact, per-account cooldown.
			return withBody('AUTH_FAILED');
		case 429:
			return withBody('RATE_LIMITED');
		default:
			return withBody('PROVIDER_ERROR');
	}
}

export const ScraperapiAdapter: Adapter = { capabilities, translate, parse };
