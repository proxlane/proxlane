// Reading a `/v1` request off the wire: every query parameter, the POST body, and every
// refusal the gateway makes before a provider is chosen.
//
// Pulled out of `app.ts` once `served()` carried validation, the sandbox, the chain and the
// response in one function. Nothing here knows about Hono beyond the four reads it makes, so
// the parsing is testable without a server and the handler reads as what happens AFTER a
// request is known to be well formed.
//
// `docs:check` assertion 12 reads this file alongside `app.ts`: every query parameter read
// here must be described in `openapi.json` and listed in `KNOWN_PARAMS`, in both directions.

import type { GatewayRequest } from '@proxlane/adapters';
import type { ErrorCode } from '@proxlane/shared';
import { MIN_USEFUL_ATTEMPT_MS } from './budget.js';

/**
 * EVERY QUERY PARAMETER THE GATEWAY READS, so it can say which ones it did not.
 *
 * An unknown parameter is silently dropped by every framework, including this one, and the
 * result is the quiet failure this whole product exists to remove: `js_render=true` is
 * ScrapingBee's spelling, `js=true` is Scrapfly's, and neither is ours. Both return HTTP 200
 * with an unrendered page, at one credit instead of five — a success by every signal a caller
 * has. Measured 2026-08-27 against `/canary/js`: `render=true` came back with the JS-only
 * marker for five credits, `js_render=true` without it for one. That cost a real user a day.
 *
 * A response header rather than a 400, deliberately. Rejecting an unknown parameter would
 * break the migration promise on day one — ScraperAPI accepts a dozen we do not implement, and
 * a hostname change would start failing on parameters that were previously harmless. So the
 * request still runs, and the answer carries `X-Ignored-Params` naming what was thrown away.
 *
 * Asserted against `c.req.query(...)` by `docs:check` assertion 12, so a parameter added to
 * the handler and left out of this list fails the build.
 */
const KNOWN_PARAMS: readonly string[] = [
	'api_key',
	'binary',
	'country_code',
	'premium',
	'provider',
	'render',
	'timeout',
	'url',
	'wait_for',
];

/**
 * A parameter name safe to put in a header value, and short enough to be worth printing.
 *
 * NOT COSMETIC. `URLSearchParams` percent-decodes, so `?a%0d%0aX-Foo:%20bar=1` yields the key
 * `a\r\nX-Foo: bar` — and `Headers.set` throws a TypeError on CR or LF rather than emitting
 * them. The runtime refusing to smuggle is the right behaviour and it is not enough: an
 * unhandled throw in the middleware turns a caller's request into a 500. Measured 2026-08-27
 * before this filter existed: that query returned 500 where the same request without it
 * returned the page. So a header meant to stop quiet failures introduced a loud one.
 */
const REPORTABLE = /^[A-Za-z0-9_.-]{1,40}$/;

/** At most this many names, so a junk query cannot produce a header of unbounded length. */
const MAX_REPORTED = 10;

/**
 * At most this many distinct names are examined for a near miss. Enough for any real request,
 * which sends a handful; a query built to cost CPU stops being read here.
 */
export const MAX_EXAMINED = 32;

/** Longest accepted `wait_for` selector. Generous — real selectors are nowhere near it. */
const MAX_WAIT_FOR = 256;

/**
 * A C0 control, DEL, or a C1 control.
 *
 * Written as a scan rather than a regex on purpose: a character class holding literal control
 * characters is what `noControlCharactersInRegex` exists to catch, and it is right to — in a
 * regex they are invisible in review and usually a mistake. Here they are the subject, so the
 * check says so in code that can be read.
 */
function hasControlCharacter(v: string): boolean {
	for (let i = 0; i < v.length; i++) {
		const c = v.charCodeAt(i);
		if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
	}
	return false;
}

/**
 * The parameters this request sent that the gateway does not read, sorted and deduplicated.
 *
 * Names only, never values — an unknown parameter carrying somebody's key must leak the name
 * and not the key. Anything unreportable or past the cap is COUNTED rather than dropped: a
 * header that silently under-reports is the failure this whole change exists to remove, so it
 * ends `+N` and the number is true.
 */
export function ignoredParams(qs: string): string[] {
	// `URLSearchParams` over `c.req.queries()` so this is testable without a Context, and so a
	// repeated key collapses to one name rather than being reported twice.
	const seen = new Set<string>();
	for (const [k] of new URLSearchParams(qs)) if (!KNOWN_PARAMS.includes(k)) seen.add(k);
	const named = [...seen].filter((k) => REPORTABLE.test(k)).sort();
	const shown = named.slice(0, MAX_REPORTED);
	const hidden = seen.size - shown.length;
	return hidden === 0 ? shown : [...shown, `+${hidden}`];
}

/**
 * Other spellings of OUR parameters, mapped to the one we read. #282.
 *
 * Edit distance alone does not find these: `render_js` is five edits from `render`, and it is
 * the most likely thing a caller migrating from ScrapingBee sends. They are listed because each
 * one changes what a request does while returning 200, which is the failure the hint exists for.
 * Several are other providers' own names; the hint says what ours is, and that holds either way.
 */
// A Map, not an object literal: `?constructor=1` looked up on a plain object finds
// Object.prototype.constructor, and emitted `constructor=function Object() { [native code] }`.
const OUR_OTHER_SPELLINGS: ReadonlyMap<string, string> = new Map([
	['render_js', 'render'],
	['js_render', 'render'],
	['js', 'render'],
	['timeout_ms', 'timeout'],
	['country', 'country_code'],
	['countrycode', 'country_code'],
	['premium_proxy', 'premium'],
	['wait_for_selector', 'wait_for'],
	['waitfor', 'wait_for'],
]);

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps. */
function editDistance(a: string, b: string): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const row = d[i] as number[];
			const prev = d[i - 1] as number[];
			row[j] = Math.min(
				(prev[j] as number) + 1,
				(row[j - 1] as number) + 1,
				(prev[j - 1] as number) + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
			}
		}
	}
	return (d[a.length] as number[])[b.length] as number;
}

/**
 * The ignored parameters that are almost certainly a typo of one we read, each with the name we
 * read. `providers` → `provider`, `render_js` → `render`, `timout` → `timeout`.
 *
 * A foreign provider's parameter and a one-character miss of ours are different signals, and
 * `X-Ignored-Params` reports both the same way. A caller sent `providers=brightdata`, got
 * `scraperapi:OK`, and believed they had tested Bright Data: the header was there and said
 * `providers`, and nothing said "you meant provider". Never a 400: ScraperAPI accepts a dozen
 * parameters we do not, and rejecting them would break the hostname-change migration.
 *
 * Same safety rules as `ignoredParams`: only reportable names, at most MAX_REPORTED, and case
 * compared insensitively because `Render=true` is the same mistake as `render_js=true`.
 */
export function nearMisses(qs: string): [ignored: string, ours: string][] {
	const out = new Map<string, string>();
	const examined = new Set<string>();
	for (const [k] of new URLSearchParams(qs)) {
		// BOUNDED WORK, because this runs on every request before authentication. A security
		// review measured the first version at ~46 ms of CPU for one 16 KB query of distinct
		// names, run twice per /v1 request: a keyless caller could hold a core. So each name is
		// examined once, at most MAX_EXAMINED distinct names are examined at all, and a name
		// whose length rules out distance one is never compared.
		if (examined.has(k)) continue;
		if (examined.size >= MAX_EXAMINED) break;
		examined.add(k);
		if (KNOWN_PARAMS.includes(k) || !REPORTABLE.test(k)) continue;
		const lower = k.toLowerCase();
		const aliased = OUR_OTHER_SPELLINGS.get(lower);
		if (aliased !== undefined) {
			out.set(k, aliased);
			continue;
		}
		// Distance 1 only, and never for a name of two characters or fewer: at that length
		// everything is one edit from something, and a hint that is usually wrong is noise.
		if (lower.length <= 2) continue;
		const close = KNOWN_PARAMS.filter(
			(p) => Math.abs(p.length - lower.length) <= 1 && editDistance(lower, p) <= 1,
		);
		// Exactly one candidate, or it is a guess dressed as a fact.
		if (close.length === 1) out.set(k, close[0] as string);
	}
	return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_REPORTED);
}

/**
 * Read a request body, stopping the moment it exceeds the cap.
 *
 * THE POINT IS WHERE IT STOPS. `c.req.text()` resolves only after the whole body is in memory,
 * so checking the size afterwards refuses the request having already paid for it — and the
 * gateway's memory budget is `maxInflight * bodyCap * 2.5`, which assumes no single request
 * exceeds the cap. `@hono/node-server` imposes no limit of its own, so nothing upstream helped.
 *
 * Chunks are counted as BYTES and the reader is cancelled at the threshold, so the peak
 * allocation is bounded by the cap plus one chunk rather than by what the caller chose to send.
 */
export async function readRequestBodyCapped(
	stream: ReadableStream<Uint8Array> | null,
	capBytes: number,
): Promise<string | 'too-large'> {
	if (stream === null) return '';
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined) continue;
			total += value.byteLength;
			if (total > capBytes) {
				// Stop pulling. Without this the sender keeps streaming into a request that is
				// already refused, which is the cost this function exists to avoid.
				await reader.cancel().catch(() => {});
				return 'too-large';
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The per-request deadline a caller may have, given what they asked for.
 *
 * PULLED OUT OF THE HANDLER SO IT CAN BE HELD TO ITS RULE. The clamp is what bounds how long
 * one request holds an in-flight slot, and `maxInflight` is sized on the assumption that it
 * holds — so deleting it makes the memory arithmetic in `operations.md` section 1 false. The
 * e2e test named for the ceiling asserted only that the request returned 200, which it does
 * with or without the clamp, and the effective deadline reaches no response header. So the
 * behaviour was not observable end to end and the test could not have caught its removal.
 *
 * Returns `'invalid'` rather than throwing, so the caller owns the 400 body and its docs link.
 */
export function requestedDeadline(
	raw: string | undefined,
	serverBudgetMs: number,
): number | 'invalid' {
	if (raw === undefined || raw === '') return serverBudgetMs;
	const asked = Number(raw);
	// Floored rather than accepted and then failed: `hopBudget` returns BUDGET_EXCEEDED below
	// this without opening a connection, so `timeout=1` would be a 504 for a request that never
	// tried anything — an error report where a 400 belongs.
	if (!Number.isInteger(asked) || asked < MIN_USEFUL_ATTEMPT_MS) return 'invalid';
	// LESS THAN THE OPERATOR BUDGETED, NEVER MORE.
	return Math.min(asked, serverBudgetMs);
}

/** The four things this module reads from a request. Structural, so a test can hand in a stub. */
export interface IncomingRequest {
	readonly req: {
		query(name: string): string | undefined;
		header(name: string): string | undefined;
		readonly method: string;
		readonly raw: { readonly body: ReadableStream<Uint8Array> | null };
	};
}

export type ParsedScrapeRequest =
	| { readonly ok: true; readonly req: GatewayRequest; readonly forced: string | undefined }
	| {
			readonly ok: false;
			readonly status: 400 | 413;
			readonly code: ErrorCode;
			readonly message: string;
	  };

/**
 * Parse a `/v1` request into a `GatewayRequest`, or say exactly why not.
 *
 * Every refusal is a 400 or a 413 with the outcome as its code, the same shape `errorWith`
 * emits; the handler adds the docs link and the headers. The order below is the order a
 * caller's mistake is most likely to be in.
 */
export async function parseScrapeRequest(
	c: IncomingRequest,
	opts: { readonly defaultDeadlineMs: number; readonly maxBodyBytes: number },
): Promise<ParsedScrapeRequest> {
	const refuse = (
		status: 400 | 413,
		code: ErrorCode,
		message: string,
	): ParsedScrapeRequest => ({
		ok: false,
		status,
		code,
		message,
	});
	const url = c.req.query('url');
	if (url === undefined || url === '') {
		return refuse(400, 'BAD_REQUEST', 'url is required');
	}

	const renderRaw = c.req.query('render');
	const premiumRaw = c.req.query('premium') ?? 'none';
	if (premiumRaw !== 'none' && premiumRaw !== 'residential' && premiumRaw !== 'stealth') {
		return refuse(400, 'BAD_REQUEST', 'premium must be none, residential or stealth');
	}
	const countryCode = c.req.query('country_code');
	// A CSS SELECTOR, AND IT IS VALIDATED, because two of the three providers that take it put
	// it in a query string and the shape is otherwise caller-controlled text on the hot path.
	// `URLSearchParams` encodes, so this is not about injection there — it is about refusing a
	// selector that cannot be one, at our door, for free, instead of paying a provider to
	// reject it. The cap is generous: the longest selector in the wild is nothing like 256.
	const waitForRaw = c.req.query('wait_for');
	if (waitForRaw !== undefined) {
		if (waitForRaw === '') {
			return refuse(400, 'BAD_REQUEST', 'wait_for must be a CSS selector, not empty');
		}
		if (waitForRaw.length > MAX_WAIT_FOR) {
			return refuse(400, 'BAD_REQUEST', `wait_for must be at most ${MAX_WAIT_FOR} characters`);
		}
		// CONTROL CHARACTERS ONLY. Not an allowlist of selector syntax: CSS selectors legitimately
		// contain quotes, brackets, colons, parentheses and unicode, and an allowlist written from
		// memory would reject `[data-id="x"]` while feeling rigorous. What must never pass is a
		// newline or a NUL — one adapter carries this inside a JSON payload and a header-shaped
		// value is exactly how the ignored-params header became a 500 in 0.11.0.
		if (hasControlCharacter(waitForRaw)) {
			return refuse(400, 'BAD_REQUEST', 'wait_for must not contain control characters');
		}
	}
	const forced = c.req.query('provider');
	// Ask for bytes and the chain narrows to providers that can actually deliver them. Same
	// explicit-truth rule as `render`: presence is not truth, or `binary=false` would route
	// as though bytes were wanted.
	const binaryRaw = c.req.query('binary');
	const binary = binaryRaw === 'true' || binaryRaw === '1';

	// THE PER-REQUEST DEADLINE, which `integrations.md` section 5 has promised since the
	// budget arithmetic was written ("Clients set their own via the `timeout` param") and
	// which nothing read. Every request got `PROXLANE_DEADLINE_MS`, so a caller who wanted a
	// fast answer or no answer waited the full ninety seconds for a slow chain to finish.
	//
	// CAPPED AT THE SERVER'S OWN, never above it. A caller must be able to ask for less time
	// than the operator budgeted and never for more: the ceiling is what bounds how long one
	// request can hold an in-flight slot, and `maxInflight` is sized on the assumption that
	// it holds.
	//
	// Floored at MIN_USEFUL_ATTEMPT_MS rather than accepted and then failed. `hopBudget`
	// returns BUDGET_EXCEEDED below that floor without opening a connection, so `timeout=1`
	// would be a 504 that never tried anything — an error report where a 400 belongs.
	const asked = requestedDeadline(c.req.query('timeout'), opts.defaultDeadlineMs);
	if (asked === 'invalid') {
		return refuse(
			400,
			'BAD_REQUEST',
			`timeout must be a whole number of milliseconds, at least ${MIN_USEFUL_ATTEMPT_MS}`,
		);
	}
	const deadlineMs = asked;

	// POST was reachable everywhere except here. `GatewayRequest` has carried `method` and
	// `body` since the contract landed, adapters declare a `post` capability, the chain
	// already filters on it and conformance tests it — and the surface hardcoded GET, so
	// none of it could be used.
	//
	// The body is read as TEXT, not parsed. Whatever the caller sends is what the target
	// gets; guessing at JSON versus form encoding here would corrupt one of them.
	let body: string | undefined;
	if (c.req.method === 'POST') {
		// THE CAP USED TO BE CHECKED AFTER THE ALLOCATION IT EXISTS TO PREVENT. `c.req.text()`
		// reads the entire body into a string first, so a caller could push an arbitrarily
		// large request through a gateway whose memory budget is sized on
		// `maxInflight * bodyCap * 2.5` (operations.md section 1) and the 413 arrived only
		// once the damage was done. Nothing upstream caps it: `@hono/node-server` imposes no
		// body limit.
		//
		// Two guards, because either alone is incomplete. The declared length refuses the
		// honest caller for free; the streaming count refuses the one who lies about it or
		// sends no length at all.
		const declared = Number(c.req.header('content-length'));
		const tooLarge = (size: number | string) =>
			refuse(
				413,
				'RESPONSE_TOO_LARGE',
				`request body is ${size} bytes, over the ${opts.maxBodyBytes} cap`,
			);
		if (Number.isFinite(declared) && declared > opts.maxBodyBytes) {
			return tooLarge(declared);
		}
		const read = await readRequestBodyCapped(c.req.raw.body, opts.maxBodyBytes);
		if (read === 'too-large') {
			// Bytes, not characters: a multi-byte body would otherwise pass a length check
			// and blow the cap.
			return tooLarge(`over ${opts.maxBodyBytes}`);
		}
		body = read;
	}

	const req: GatewayRequest = {
		url,
		method: c.req.method === 'POST' ? 'POST' : 'GET',
		...(body === undefined ? {} : { body }),
		// Explicit, never inferred from presence: `render=false` must mean false, and the
		// absence of the parameter must mean false too. Treating presence as truth is how
		// `render=false` ends up rendering and billing 5x.
		// `wait_for` IMPLIES RENDER. A wait condition with no renderer to wait is not a
		// request anyone means, and rejecting it would teach the caller to send a flag they
		// already implied. Set here, once, so every adapter and the capability filter see
		// one coherent request rather than each deciding for itself.
		renderJs: renderRaw === 'true' || renderRaw === '1' || waitForRaw !== undefined,
		...(waitForRaw === undefined ? {} : { waitFor: waitForRaw }),
		...(binary ? { binary: true } : {}),
		premium: premiumRaw,
		deadlineMs,
		...(countryCode === undefined ? {} : { countryCode }),
	};
	return { ok: true, req, forced };
}
