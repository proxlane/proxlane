// pnpm record --adapter=<id> — capture real provider responses as fixtures.
//
// Fixtures are the contract for every contract test, so this script's correctness matters
// more than most. Three properties it must have:
//
//   1. ONE PASS. ScrapingBee's 1,000 free credits never refresh and ScraperAPI's 5,000 run
//      on a 7-day clock, so iterating against a live key is expensive in a way that does
//      not show up until it has already happened. --dry-run prints the exact plan and
//      spends nothing.
//   2. BYTES, not strings. Post-transfer-decoding, pre-charset-decoding, plus every
//      response header. A page declaring Shift_JIS in a <meta> tag must survive intact or
//      /detect fingerprints mojibake.
//   3. NO SECRETS. The key travels in a query string or a header depending on provider.
//      Sanitization happens before anything is written, and is asserted afterwards — CI
//      cannot tell a recording from a fabrication, but it can tell whether a key leaked.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	type Adapter,
	expectedOutcome,
	type GatewayRequest,
	type Outcome,
} from '@proxlane/adapters';
import { createFetchTransport } from '@proxlane/shared/transport';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The missing-key message tells you to put the key in .env.local. It did not read it, so
// the advice was wrong and the only path that worked was exporting into the shell — where
// a provider key then sits in shell history and every child process.
//
// process.loadEnvFile is native in Node 24, which keeps scripts/ zero-dependency. It does
// NOT overwrite an already-set variable, so CI secrets and an explicit `KEY=… pnpm record`
// still win over the file.
try {
	process.loadEnvFile(join(ROOT, '.env.local'));
} catch {
	// Absent is the normal case in CI and on a fresh clone.
}

// ---------------------------------------------------------------- target matrix
//
// Stable, deterministic targets only. Every one of these produces the same category on
// every run, which is what makes a re-record diff meaningful.
//
// Note what is NOT here: block and captcha. You cannot summon a block from httpbin on
// demand — real block pages come from real targets that fight back, and plan.md section 19
// keeps those out of the public corpus by default. A hand-written block fixture would be a
// fabrication, and this whole layer rests on them being real.
//
// `pnpm capture-block` is where those come from. This comment used to name a `--from-exchange`
// flag that appeared nowhere else in the repository — the mechanism was never built, so the
// corpus gap could not close even with a real capture in hand. Section 19 decides where a
// capture lands, and the tool enforces it rather than asking the caller to remember.

export type TargetCategory =
	| 'success-html'
	| 'success-json'
	| 'post'
	| 'target-not-found'
	| 'target-error'
	| 'dead-host'
	| 'binary'
	| 'target-rate-limited'
	| 'slow-target'
	| 'deadline'
	| 'render-js'
	| 'large-object';

export interface Target {
	readonly category: TargetCategory;
	readonly url: string;
	readonly renderJs: boolean;
	/**
	 * What the adapter's parse() should map this to, compared against reality after
	 * recording. `provider-dependent` means there is no single right answer across providers
	 * and the comparison is skipped rather than reported as a mismatch forever.
	 */
	readonly expect: Outcome | 'provider-dependent';
	/**
	 * Only recorded when `--timeout-ms` forces our own deadline. A normal run skips it: no
	 * public target stays open longer than a provider's own budget, so without the flag this
	 * category can only ever record something that is not a deadline.
	 */
	readonly needsDeadline?: true;
	/**
	 * Record this category for these adapters ONLY.
	 *
	 * Exists for one reason and should stay narrow: `large-object` needs a target big enough to
	 * cross Scrapfly's 5 MB offload threshold, and the other three providers answer that by
	 * INLINING nine megabytes — which base64s into a ~12 MB fixture, per provider, committed to
	 * git forever. The fixture is about one provider's behaviour, so it is recorded against that
	 * provider. Anything gated here is reported as skipped, never silently dropped.
	 */
	readonly onlyAdapters?: readonly string[];
	/**
	 * Non-GET, for the categories that exercise a method the adapter has to forward. Absent
	 * means GET, which is every other target.
	 */
	readonly method?: 'POST';
	readonly body?: string;
	readonly why: string;
}

export const TARGETS: readonly Target[] = [
	{
		category: 'success-html',
		url: 'https://httpbin.dev/html',
		renderJs: false,
		expect: 'OK',
		why: 'the happy path, and the charset baseline',
	},
	{
		category: 'success-json',
		url: 'https://httpbin.dev/json',
		renderJs: false,
		expect: 'OK',
		why: 'non-HTML body: detection must not run on it',
	},
	{
		// The body has to reach the TARGET, which is why this echoes rather than just accepting.
		// httpbin.dev/post returns what it received, so a fixture that records a 200 with the
		// body missing from the echo is a fixture that proves the opposite of what it claims.
		category: 'post',
		url: 'https://httpbin.dev/post',
		method: 'POST',
		// NOT `{"proxlane": …}`, and the reason is the redaction rather than taste. Our own
		// Bright Data zone is the string `proxlane`, `secretsFor()` makes every key component
		// a needle, and a needle is replaced wherever it appears — so that payload would have
		// recorded as `{"REDACTED":"post-fixture"}` and the fixture would prove the opposite
		// of what its `why` claims. Fixtures are `-diff` in `.gitattributes`, so nobody would
		// have seen it in review either.
		body: '{"echo-marker":"post-fixture"}',
		renderJs: false,
		expect: 'OK',
		why: 'a POST body reaching the target, which three adapters used to refuse outright',
	},
	{
		// httpbingo.org, NOT httpbin.dev, for the three status categories.
		//
		// httpbin.dev sits behind Cloudflare. The first three adapters fetch it without complaint,
		// but a provider whose whole job is recognising protection pages does not: Bright Data's
		// Unlocker answered `reject_block` on every /status/ path and never returned the status
		// the category asked for, so three fixtures recorded HARD_BLOCK — true of the request,
		// useless as a fixture.
		//
		// A per-adapter override was the obvious fix and was wrong. The failover tests drive a
		// chain across providers against ONE target, so giving each adapter its own target left
		// hop two with no recording for hop one's URL. One matrix, one target per category, is a
		// property those tests depend on.
		//
		// httpbingo.org is the same API without the Cloudflare front and passes these through
		// untouched. `success-*` and `slow-target` stay on httpbin.dev: they record correctly for
		// every provider, and httpbingo caps /delay at 10s, which would quietly change what
		// slow-target means.
		category: 'target-not-found',
		url: 'https://httpbingo.org/status/404',
		renderJs: false,
		expect: 'TARGET_NOT_FOUND',
		why: 'never fails over — a real 404 is a real 404 at the next provider too',
	},
	{
		category: 'target-error',
		url: 'https://httpbingo.org/status/503',
		renderJs: false,
		expect: 'TARGET_ERROR',
		why: 'the target is broken, not the provider. Fails over once',
	},
	{
		// A HOST THAT DOES NOT EXIST, which is a target fact and reads like a provider bug.
		//
		// Added after a dogfood run found three adapters giving three different answers to the
		// same NXDOMAIN: TARGET_ERROR, INVALID_REQUEST and PROVIDER_ERROR. Every provider
		// reports it through the channel it uses for its OWN failures — Scrapfly as a 400
		// config error, Bright Data as `proxy_error` — so the honest mapping needs the message,
		// and a fixture is the only way to hold it there.
		//
		// `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve, so this target
		// is stable in the way the rest of this matrix is: it cannot be registered later.
		category: 'dead-host',
		url: 'https://not-a-real-host.invalid/',
		renderJs: false,
		expect: 'TARGET_ERROR',
		why: 'DNS is a fact about the target. The taxonomy says so: TARGET_ERROR is "Target site 5xx or DNS dead"',
	},
	{
		// A JPEG, to settle whether an adapter can return a body byte for byte.
		//
		// Half the launch providers cannot, and the failure is silent: ScraperAPI decodes bodies
		// as text and returns UTF-8 mojibake under a 200. Conformance asserts the declared
		// `binary` capability against what `parse` does to THIS fixture, in both directions, so
		// a wrong claim cannot ship — which it briefly did, from measuring the provider's wire
		// response rather than the adapter's output.
		//
		// httpbingo.org/image/jpeg is stable, tiny and not a commercial target.
		category: 'binary',
		url: 'https://httpbingo.org/image/jpeg',
		renderJs: false,
		expect: 'OK',
		why: 'bytes must survive the round trip, or they must be declared not to',
	},
	{
		category: 'target-rate-limited',
		url: 'https://httpbingo.org/status/429',
		renderJs: false,
		expect: 'TARGET_RATE_LIMITED',
		// Recordable, unlike a block page — which is why this outcome gets a real fixture and
		// SOFT_BLOCK does not. Providers retry a target 429 internally first (ScraperAPI for up
		// to 60s across its pool, uncharged), so one reaching us has already survived that.
		why: 'the target is throttling us, which is the warning before a ban',
	},
	{
		category: 'slow-target',
		url: 'https://httpbin.dev/delay/30',
		renderJs: false,
		// Measured across three providers, and no two agreed: jina answered 422, ScraperAPI
		// 500, ScrapingBee a plain 200 with the content after waiting the delay out. There is
		// no single correct outcome, so asserting one would report a permanent false mismatch.
		// What the fixture is FOR is showing how each provider handles a slow target.
		expect: 'provider-dependent',
		why: 'how the provider handles a target that is slow but not broken',
	},
	{
		category: 'deadline',
		url: 'https://httpbin.dev/delay/30',
		renderJs: false,
		expect: 'PROVIDER_TIMEOUT',
		// Split out from the old `timeout` category, which conflated two different things and
		// therefore tested neither. This one is OUR deadline firing, which no public target
		// can trigger on its own: every launch provider's maxTimeoutMs exceeds any delay a
		// test endpoint will hold open, so it needs --timeout-ms and is skipped without it.
		needsDeadline: true,
		why: 'our own deadline firing mid-request; needs --timeout-ms below the target delay',
	},
	{
		category: 'render-js',
		url: 'https://quotes.toscrape.com/js/',
		renderJs: true,
		expect: 'OK',
		why: 'content only present after JS runs — proves the renderJs capability is honest',
	},
	{
		category: 'large-object',
		// Over 5 MB, Scrapfly offloads the body to a separate object store and returns a URL in
		// `content` with `format: clob`. Documented, permanent, no opt-out parameter. Before the
		// adapter handled it the caller got that 70-character URL AS THE PAGE — HTTP 200,
		// X-Outcome: OK, the target's own content-type, seven credits billed. Found by a user.
		//
		// unpkg is a public package CDN, not a commercial target, and this path is immutable:
		// a version-pinned file on npm cannot change under the fixture.
		url: 'https://unpkg.com/typescript@5.9.3/lib/typescript.js',
		renderJs: false,
		expect: 'PROVIDER_BODY_OFFLOADED',
		onlyAdapters: ['scrapfly'],
		why: 'a body too large to inline must fail over, not arrive as a pointer marked OK',
	},
];

// ---------------------------------------------------------------- fixture shape

/**
 * A spent plan's answer, kept as a fixture of its own. Not in `TARGETS`: no target summons it.
 *
 * Until 2026-09-17 a spent plan was recorded OVER the category it interrupted. The fixture
 * was written before `parse()` ran, so `success-html.json` became a quota refusal while the
 * summary line said "These fixtures were NOT refreshed". A fixture is the contract, so a run on
 * an empty wallet quietly rewrote it.
 *
 * It is also the only way that response becomes evidence. `QUOTA_EXHAUSTED` was mapped from two
 * observations, on 2026-08-29 and 2026-09-02, and neither was kept, so the claim rested on unit
 * tests whose bodies somebody typed. The fixture READMEs called a recording "bytes no assertion
 * reads"; conformance now reads them, and a claim published outside this repo can point at them.
 */
export const QUOTA_FIXTURE = 'quota-exhausted';

/**
 * Which file a recording lands in, decided by what `parse()` made of it. `undefined` writes none.
 *
 * - The expected outcome, or one the matrix does not assert: the category's own file.
 * - `QUOTA_EXHAUSTED` where the matrix expected something else: `QUOTA_FIXTURE`, never the
 *   category. Not in diff mode, which compares categories and must not grow a file per run.
 * - `RATE_LIMITED` where unexpected: nothing. A concurrency cap is a moment, not a shape, and
 *   writing it over the category is the same overwrite as above.
 * - Any other mismatch: the category's file, as before. That is drift, and the diff says so.
 * - `parse()` threw: the category's file. Fixtures are recorded before parse() exists.
 */
export function fixtureFileFor(
	category: string,
	expect: string,
	got: string | undefined,
	diff: boolean,
): string | undefined {
	if (got === undefined || got === expect || expect === 'provider-dependent') return category;
	if (got === 'QUOTA_EXHAUSTED') return diff ? undefined : QUOTA_FIXTURE;
	if (got === 'RATE_LIMITED') return undefined;
	return category;
}

interface FixtureCommon {
	readonly category: TargetCategory | typeof QUOTA_FIXTURE;
	readonly recordedAt: string;
	readonly adapter: string;
	readonly target: { readonly url: string; readonly renderJs: boolean };
	readonly expect: string;
}

/** A provider answered. The overwhelmingly common case. */
export interface ExchangeFixture extends FixtureCommon {
	readonly kind: 'exchange';
	readonly request: {
		readonly method: string;
		readonly url: string;
		readonly headers: Record<string, string>;
		/** Absent for a GET. Present, sanitized, for an adapter that POSTs its parameters. */
		readonly body?: string;
	};
	readonly response: {
		readonly status: number;
		readonly headers: Record<string, string>;
		/** Base64 of the wire bytes. Base64 because JSON cannot hold arbitrary bytes and
		 *  because a "helpfully" decoded string is how charset bugs get baked into a
		 *  fixture and then tested against forever. */
		readonly bodyBase64: string;
		readonly bodyBytes: number;
	};
}

/** No response at all — the deadline fired first. Has no status and no body, which is why
 *  it cannot share a shape with ExchangeFixture: a reader reaching for `.response.status`
 *  on this must fail to compile, not read undefined at runtime. */
export interface DeadlineFixture extends FixtureCommon {
	readonly kind: 'deadline';
	readonly transportError: 'aborted-by-deadline';
	readonly timeoutMs: number;
}

export type Fixture = ExchangeFixture | DeadlineFixture;

export const REDACTED = 'REDACTED';

/**
 * Ceiling on a recorded body.
 *
 * `operations.md` section 1 caps a real response at 10 MB. A fixture's ceiling is its own
 * concern and lower: every contract test reads it into memory, and it lives in git forever.
 */
export const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;

/**
 * Headers whose value changes on every request and says nothing about provider behaviour.
 *
 * Normalised to a marker rather than dropped, so the fixture still records that the header
 * was present. Without this a re-record diffs on `cf-ray` and `date` every time, which makes
 * `integrations.md` section 6's claim — "diffs in recorded responses show provider changes
 * in code review" — false: the diff is never empty, so nobody reads it.
 */
const VOLATILE_HEADERS = new Set([
	'age',
	'cf-ray',
	'date',
	'expires',
	'nel',
	'report-to',
	'server-timing',
	'x-ratelimit-remaining',
	'x-ratelimit-reset',
	'x-usage-tokens',
]);

/**
 * The trace and request-id family, which every provider spells differently.
 *
 * A list of exact names will always lag the next provider — `traceparent` and
 * `x-cloud-trace-context` both slipped past one — so the shape is matched instead. Kept
 * narrow enough not to catch `x-ratelimit-limit` or `content-length`, which differ per
 * target rather than per request and are real data.
 */
const VOLATILE_PATTERN =
	// `reject`, because Scrapfly names the handle for a refused request `x-scrapfly-reject-id`:
	// the same per-request identifier as a request id, spelled after the event it records.
	/^(traceparent|tracestate)$|^x-b3-|(^|-)(trace|request|correlation|reject)[-_]?(id|context)$/i;
const VOLATILE = 'VOLATILE';

function isVolatile(name: string): boolean {
	return VOLATILE_HEADERS.has(name) || VOLATILE_PATTERN.test(name);
}

/**
 * Header names that LOOK secret to the matcher below and provably are not.
 *
 * The matcher is a substring test, deliberately: over-redaction loses data, under-redaction
 * leaks a provider key, and only one of those is recoverable. So the default stays broad and
 * exceptions are named one at a time, having been checked. `x-usage-tokens` is a token
 * *count* and matched only because "token" is a substring of it.
 */
const NOT_SECRET = new Set(['x-usage-tokens', 'x-token-count']);

/**
 * JSON fields inside a RESPONSE BODY that identify us rather than the target.
 *
 * The body was not sanitised at all, and that is how six committed Scrapfly fixtures came
 * to carry `client_ip` — our egress address as the provider saw it — plus the project and
 * user UUIDs of the account that recorded them. CLAUDE.md bans IPs from this repo outright
 * and these were headed for a public one.
 *
 * The post-write key assertion could never have caught it either: the body is stored base64,
 * so `serialized.includes(key)` is blind to everything in it. The one guard that existed did
 * not cover the one place the sanitiser did not run.
 *
 * By FIELD NAME, not by shape. A blanket "no public IPv4 in a fixture" rule was considered
 * and rejected: providers legitimately echo their OWN egress address (httpbin does it
 * through ScrapingBee), and refusing those would block honest recordings while teaching
 * people to bypass the check.
 */
export const IDENTIFYING_FIELDS = [
	'client_ip',
	// Firecrawl's per-job handle. A timestamp-derived UUID rather than an account id, and useless
	// without the key, but it is the provider's identifier for OUR request and nothing reads it.
	'scrapeId',
	// Scrapfly's handle for the same thing, in its request envelope's `config.uuid`. Useless
	// without the key, like `scrapeId`, but it is the provider's identifier for OUR request and
	// nothing reads it. A body field named `uuid` in a target's own content would be redacted
	// too; in a recorded fixture that costs nothing.
	'uuid',
	'project_uuid',
	'user_uuid',
	'account_id',
	'log_url',
	'dashboard_url',
];

/**
 * Redact secrets and account identifiers from a response body.
 *
 * This DOES modify bytes, which is a real cost: `integrations.md` section 2 wants the wire
 * bytes intact. The trade is deliberate and narrow — a value inside a quoted JSON string is
 * replaced in place, so length changes but structure does not, and nothing outside these
 * named fields is touched. A fixture that leaks the maintainer's address is worse than a
 * fixture whose `client_ip` reads REDACTED.
 */
export function sanitizeBody(bytes: Uint8Array, secrets: readonly string[]): Uint8Array {
	// Only text-ish bodies are rewritten. A binary body cannot contain a JSON field, and
	// re-encoding one would corrupt it for no benefit.
	const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	if (text.includes('\u0000')) return bytes;

	const out = redactEchoedAddresses(redactIdentifyingFields(sanitize(text, secrets)));
	return out === text ? bytes : new TextEncoder().encode(out);
}

/**
 * Addresses of a party IN THE REQUEST PATH, echoed back by the target: httpbin's `origin`, and
 * any forwarding header it reflects (#364).
 *
 * Whose address is it? `origin` is the provider's exit node. But Bright Data's
 * `X-Brd-Api-Forwarded-For` is the address of whatever called Bright Data's API, which is the
 * machine running the recorder: on another day, the maintainer's own connection, which CLAUDE.md
 * bans from this repository.
 *
 * VALUE-SHAPED, NOT KEY-SHAPED. Redacting every `origin` would rewrite Scrapfly's
 * `"origin":"WEB_SCRAPING_API"`, an enum in its own envelope; redacting every `ip` would rewrite
 * Scrapfly's DNS resolution of the target, which is the target's public address. Only an
 * address-shaped token inside the value of an echo key is replaced.
 *
 * TWO TECHNIQUES, ON PURPOSE. Redaction is key-anchored: textual, then structural. The refusal
 * gate (`strayAddresses`) reads every address in the text, whoever's key it sits under. The first
 * version of the gate reused the redaction's own expression over the redacted bytes, so it could
 * never catch what the redaction missed, and two security reviews found shapes it did miss.
 */

/** An address, with the forms a forwarding header carries: ports, brackets, zones, mapped v4. */
const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
const IPV6 = String.raw`(?:[0-9a-f]{0,4}:){2,7}(?:[0-9a-f]{0,4}|${IPV4})(?:%[\w.]+)?`;
const ADDRESS_SRC = String.raw`(?<![\w.:])(?:\[${IPV6}\](?::\d{1,5})?|${IPV6}|${IPV4}(?::\d{1,5})?)(?![\w.])`;
const ADDRESS = new RegExp(ADDRESS_SRC, 'gi');

/**
 * A STRICT address, for the two places that look beyond an echo key's value: the literal pass in
 * `redactEchoedAddresses` and the refusal gate. The loose IPv6 form above also matches a
 * timestamp's `21:11:59`, which is harmless inside a forwarding header and everywhere outside
 * one; so beyond an echo key an IPv6 address must contain `::` or all eight groups.
 *
 * PROSE-SHAPED BOUNDARIES. The first strict form refused a `.` or `:` on either side, so
 * `Your IP is 203.0.113.7.`, `ipv4:203.0.113.7:443` and `0:0:0:0:0:ffff:203.0.113.7` all passed
 * the gate. A trailing `.` now ends an address unless a digit follows it, and a `:` may precede
 * an IPv4. What this adds in false positives ends in a refusal, which is the safe direction.
 */
const IPV6_STRICT = `(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){6}${IPV4}|(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}:){0,6}(?:[0-9a-f]{1,4}|${IPV4})?)`;
const STRICT_ADDRESS_SRC = String.raw`(?:(?<![\w.:])\[?${IPV6_STRICT}\]?|(?<![\w.])${IPV4})(?::\d{1,5})?(?!\w|\.\d)`;

/** The address without brackets or a port: the literal that recurs however a layer escapes it. */
function coreAddress(token: string): string {
	// A lone bracket too: `a[2001:db8::1]` cannot start at the `[`, so the match keeps only its `]`.
	const bracketed = /^\[?([^[\]]+)\](?::\d+)?$/.exec(token) ?? /^\[([^[\]]+)$/.exec(token);
	if (bracketed) return bracketed[1] as string;
	return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(token) ? (token.split(':')[0] as string) : token;
}

/** An IPv4 address a mapped IPv6 one ends in, so either spelling redacts the other. */
function ipv4Tail(core: string): string | undefined {
	return /\d{1,3}(?:\.\d{1,3}){3}$/.exec(core)?.[0];
}

/**
 * Whether a strict match is an address a host could hold. Not `152.0.0.0`, which is how a user
 * agent spells a major version; not an octet above 255; and not an IPv6 form with fewer than two
 * hex groups, so a script's `a[::2]` is not an address.
 */
function isHostAddress(core: string): boolean {
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(core);
	if (v4) return v4.slice(1).every((o) => Number(o) <= 255) && !/\.0\.0\.0$/.test(core);
	return (core.match(/[0-9a-f]{1,4}/gi) ?? []).length >= 2;
}

/**
 * Keys whose value is an address in the request path. `_` and `-` both, because the same header
 * arrives as `X-Forwarded-For`, `x_forwarded_for` or CGI's `HTTP_X_FORWARDED_FOR`.
 */
const ECHO_KEY_SRC =
	// Any prefix on EVERY term, not only the `-for` and `-ip` ones: ScrapingBee relays target
	// headers as `spb-via`, and CGI spells `Forwarded` as `HTTP_FORWARDED`.
	'(?:[a-z0-9]+[-_])*(?:origin|forwarded|via|forwarded[-_]for|real[-_]ip|client[-_]ip|connecting[-_]ip|remote[-_]?(?:addr|ip)|originating[-_]?ip)';
const ECHO_KEY = new RegExp(`^${ECHO_KEY_SRC}$`, 'i');

/**
 * A quote in any of the encodings a body carries one in: plain, JSON-escaped once (Scrapfly
 * returns the page as a JSON string inside its own JSON), escaped twice, or HTML-escaped.
 * Longest first, so `\\\"` is not read as `\"` preceded by a stray backslash.
 */
const QUOTE_SRC = String.raw`(\\\\\\"|\\"|&quot;|")`;
/** Whitespace, including the escaped `\n` of a pretty-printed body inside a JSON string. */
const GAP = String.raw`(?:\s|\\[nrt])*`;
const KEY_AT = new RegExp(`${QUOTE_SRC}${ECHO_KEY_SRC}\\1${GAP}:${GAP}`, 'gi');

/**
 * Where the value that starts at `from` ends: the array's `]`, or the matching quote. `null` when
 * no string or array starts there (a `null`, a number, an object), `-1` when one starts and never
 * ends. Only the second is a reason to stop scanning.
 */
function valueEnd(text: string, from: number, quote: string): number | null {
	if (text[from] === '[') {
		const close = text.indexOf(']', from);
		return close === -1 ? -1 : close + 1;
	}
	if (!text.startsWith(quote, from)) return null;
	const close = text.indexOf(quote, from + quote.length);
	return close === -1 ? -1 : close + quote.length;
}

export function redactEchoedAddresses(text: string): string {
	// PASS ONE, textual and key-anchored, for any body: redact inside each echo key's value.
	let out = '';
	let last = 0;
	KEY_AT.lastIndex = 0;
	for (let m = KEY_AT.exec(text); m !== null; m = KEY_AT.exec(text)) {
		const start = m.index + m[0].length;
		const end = valueEnd(text, start, m[1] as string);
		// A `null` or an object is skipped, not a reason to stop: stopping there left every
		// later echo key in a body pass two cannot parse unredacted.
		if (end === null) continue;
		// STOP at the first value that never ends. Continuing re-scanned to the end of the body
		// for every later key, O(keys x length) on a malformed tail. Pass two still covers JSON.
		if (end === -1) break;
		if (end < last) continue;
		out += text.slice(last, start) + text.slice(start, end).replace(ADDRESS, REDACTED);
		last = end;
		KEY_AT.lastIndex = end;
	}
	out += text.slice(last);

	// PASS TWO, structural, for JSON: collect every address under an echo key at any depth of
	// nesting or escaping, and replace that LITERAL wherever it appears. An address is spelled the
	// same in every JSON escape layer, so this is immune to the ambiguity that makes "where does
	// this value end" hard to answer textually: an RFC 7239 value with escaped inner quotes, or a
	// bracketed IPv6 closing an array early, both of which a security review found pass one missed.
	// Collected from the ORIGINAL text: pass one has already erased the values it handled, and a
	// copy of one elsewhere in the body is exactly what this pass is for.
	const literals = new Set<string>();
	const strict = new RegExp(STRICT_ADDRESS_SRC, 'gi');
	walkJson(text, (key, value) => {
		if (!ECHO_KEY.test(key)) return;
		for (const s of valueStrings(value)) {
			for (const m of s.matchAll(strict)) {
				const core = coreAddress(m[0]).toLowerCase();
				if (!isHostAddress(core)) continue;
				literals.add(core);
				const tail = ipv4Tail(core);
				if (tail !== undefined) literals.add(tail);
			}
		}
	});
	if (literals.size === 0) return out;
	// ONE PASS over the body, whatever the number of literals, and case-insensitive: the gate is,
	// so an IPv6 literal spelled in capitals elsewhere would otherwise survive to be refused.
	return out.replace(strict, (m) => {
		const core = coreAddress(m);
		if (literals.has(core.toLowerCase())) return m.replace(core, REDACTED);
		const tail = ipv4Tail(core);
		return tail !== undefined && literals.has(tail) ? m.replace(tail, REDACTED) : m;
	});
}

/**
 * Every string an echo key's value holds: a string, an array's elements, an object's values. Bounded
 * like the walk that calls it, or `{"origin":[[[[…` overflows here instead.
 */
function valueStrings(v: unknown, nesting = 0): string[] {
	if (nesting > MAX_NESTING) return [];
	if (typeof v === 'string') return [v];
	if (Array.isArray(v)) return v.flatMap((x) => valueStrings(x, nesting + 1));
	if (v !== null && typeof v === 'object')
		return Object.values(v).flatMap((x) => valueStrings(x, nesting + 1));
	return [];
}

/**
 * How deep a walk goes. `[[[[…` ten thousand levels deep overflowed the stack, and the RangeError
 * aborted the whole recording run. What lies deeper goes unredacted, and the gate, which reads the
 * text rather than the tree, refuses it.
 */
const MAX_NESTING = 256;

/**
 * Visit every key and value in a JSON text, and in any string that is itself JSON, to a bounded
 * depth: how Scrapfly carries a page, and how double encoding unwraps. `path` is the keys above.
 */
function walkJson(
	text: string,
	visit: (key: string, value: unknown, path: readonly string[]) => void,
): boolean {
	const walk = (node: unknown, path: string[], depth: number, nesting: number): void => {
		if (nesting > MAX_NESTING) return;
		if (typeof node === 'string') {
			const inner = depth < 4 ? parseJson(node) : undefined;
			if (inner !== undefined) walk(inner, path, depth + 1, nesting + 1);
			return;
		}
		if (Array.isArray(node)) {
			for (const n of node) walk(n, path, depth, nesting + 1);
			return;
		}
		if (node === null || typeof node !== 'object') return;
		for (const [k, v] of Object.entries(node)) {
			visit(k, v, path);
			walk(v, [...path, k], depth, nesting + 1);
		}
	};
	const doc = parseJson(text);
	if (doc === undefined) return false;
	walk(doc, [], 0, 0);
	return true;
}

function parseJson(s: string): unknown {
	const t = s.trim();
	// `"` too: a JSON-encoded STRING that holds JSON is how double encoding looks once the outer
	// layer is parsed, and the walk recurses into the string it yields.
	if (!(t.startsWith('{') || t.startsWith('[') || t.startsWith('"'))) return undefined;
	try {
		return JSON.parse(t);
	} catch {
		return undefined;
	}
}

/**
 * The one place a fixture legitimately carries an address: Scrapfly's own envelope,
 * `result.dns.resolved[].entries[].ip`, the target's public DNS resolution. ANCHORED to that path
 * in the outer document, arrays transparent. The first exception was any `ip` under any `dns` at
 * any depth, which a target's own page (a DNS diagnostic endpoint) could carry.
 */
const DNS_PATH = ['result', 'dns', 'resolved', 'entries', 'ip'] as const;

function dnsResolutions(text: string): Set<string> {
	const out = new Set<string>();
	const walk = (node: unknown, i: number, nesting: number): void => {
		if (nesting > MAX_NESTING) return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n, i, nesting + 1);
			return;
		}
		if (i === DNS_PATH.length) {
			if (typeof node === 'string') out.add(node.toLowerCase());
			return;
		}
		if (node !== null && typeof node === 'object')
			walk((node as Record<string, unknown>)[DNS_PATH[i] as string], i + 1, nesting + 1);
	};
	const doc = parseJson(text);
	if (doc !== undefined) walk(doc, 0, 0);
	return out;
}

const ENTITIES: Readonly<Record<string, string>> = {
	period: '.',
	colon: ':',
	lsqb: '[',
	rsqb: ']',
	lbrack: '[',
	rbrack: ']',
};
const fromHex = (_: string, h: string) => String.fromCharCode(Number.parseInt(h, 16));

/**
 * The spellings an address hides behind, undone for the gate only: UTF-16's interleaved NULs,
 * percent-encoding (doubled too), JSON's `\u002e`, HTML entities, and an escaped `\n` or `\t`
 * whose letter would otherwise read as part of a word. The redaction leaves these alone, so a
 * body that uses one is refused rather than rewritten: a re-recording, never a leak. Base64
 * inside an envelope is not undone; no target in the recorder returns one.
 */
function unhide(text: string): string {
	let t = text.replaceAll('\0', '');
	for (let i = 0; i < 3 && /%25/i.test(t); i++) t = t.replace(/%25/gi, '%');
	return t
		.replace(/(?<!\\)\\+u00(2e|3a|5b|5d)/gi, fromHex)
		.replace(/%(2e|3a|5b|5d)/gi, fromHex)
		.replace(/&#x0*(2e|3a|5b|5d);?/gi, fromHex)
		.replace(/&#0*(46|58|91|93);?/g, (_, d: string) => String.fromCharCode(Number(d)))
		.replace(
			/&(period|colon|lsqb|rsqb|lbrack|rbrack);/gi,
			(e, n: string) => ENTITIES[n.toLowerCase()] ?? e,
		)
		.replace(/(?<!\\)\\+[nrtbf]/g, ' ');
}

/**
 * Every address that survived, anywhere but a known-public place: the refusal gate.
 *
 * THE TEXT, NOT THE TREE. Deliberately broader than the redaction and a different technique, so a
 * miss in one is caught by the other. The two structural versions before this one each saw less
 * than the bytes held: the first only values under echo keys, the second every value but no
 * object KEY, and neither the losing half of a duplicate key, which `JSON.parse` drops and the
 * recorder still writes. The tree is used for one thing only, to find the DNS resolutions above.
 */
export function strayAddresses(
	text: string,
	exempt: ReadonlySet<string> = dnsResolutions(text),
): string[] {
	const found: string[] = [];
	for (const m of unhide(text).matchAll(new RegExp(STRICT_ADDRESS_SRC, 'gi'))) {
		const core = coreAddress(m[0]).toLowerCase();
		if (isHostAddress(core) && !exempt.has(core)) found.push(m[0]);
	}
	return found;
}

/**
 * Every host address in a text, redacted, under any key or none: for a block-page capture, never
 * a recording. A block page prints the VISITOR's address (a footer's "your IP is"), which is the
 * exit node or, for a capture taken from a home network, the maintainer's own connection, and it
 * sits in HTML where no echo key marks it. Recordings keep the narrower rule because their bodies
 * carry addresses that are the point of the fixture. The DNS resolutions the gate exempts stay.
 */
export function redactAddresses(text: string): string {
	const exempt = dnsResolutions(text);
	return text.replace(new RegExp(STRICT_ADDRESS_SRC, 'gi'), (m) => {
		const core = coreAddress(m);
		const key = core.toLowerCase();
		return isHostAddress(key) && !exempt.has(key) ? m.replace(core, REDACTED) : m;
	});
}

export function hasEchoedAddress(text: string): boolean {
	return strayAddresses(text).length > 0;
}

/**
 * The gate as the recorder applies it: the decoded body and the serialized fixture, each on its
 * own. The DNS exception is the body's alone; the serialized half carries the body as base64, so
 * only the request and the headers are read there, and nothing in them is exempt.
 */
export function fixtureCarriesEchoedAddress(serialized: string, bodyText: string): boolean {
	return hasEchoedAddress(bodyText) || strayAddresses(serialized, new Set()).length > 0;
}

/**
 * Fields that only ever appear in a request WE construct, so redacting them there is safe in a
 * way redacting them everywhere is not.
 *
 * `zone` is Bright Data's account-side name for the proxy pool, sent as its own JSON field
 * because the key is `<zone>:<token>`. It is also an ordinary English word, so putting it in
 * `IDENTIFYING_FIELDS` would rewrite it inside any RESPONSE body that happened to use it —
 * silently changing a recording, in files that are `-diff` in `.gitattributes` and therefore
 * invisible in review. Here it applies only to what we sent.
 */
const REQUEST_ONLY_FIELDS = ['zone'];

/**
 * Replace the value of every named field in a JSON-ish string.
 *
 * Split out of `sanitizeBody()` so the REQUEST body gets it too. A request body used to see
 * `sanitize()` alone, which matches whole needles and nothing else — so Bright Data's `zone`,
 * when its value is too short for the length floor, was neither replaced nor visible in review.
 */
export function redactIdentifyingFields(
	text: string,
	fields: readonly string[] = IDENTIFYING_FIELDS,
): string {
	let out = text;
	for (const field of fields) {
		out = out.replace(new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, 'g'), `$1"${REDACTED}"`);
	}
	return out;
}

/**
 * Below this, a needle is a word rather than a secret and replacing it corrupts prose.
 * `cat` in "the cat sat" is the test that pins it.
 */
export const MIN_SECRET_LENGTH = 8;

/**
 * Every string that must not survive into a fixture, given one provider key.
 *
 * NOT just the key. A provider key is not always atomic: Bright Data's is `<zone>:<token>`,
 * and `brightdata/index.ts` splits it and sends the zone as its own JSON field, so the whole
 * key never appears on the wire and a whole-key needle matches nothing. The zone reached
 * `slow-target.json` in cleartext that way and sat in a public repo until a security pass
 * found it. Ours is named after the project and authenticates nothing, which is luck rather
 * than design — the next composite key could carry an account id in the same position.
 *
 * Longest first, so the whole key is replaced before its parts and a fixture never ends up
 * with `REDACTED:REDACTED` where one REDACTED belongs.
 *
 * A part shorter than `MIN_SECRET_LENGTH` is returned anyway. `sanitize()` will skip it, and
 * the caller warns rather than staying silent, because "too short to redact safely" is a fact
 * the person recording needs before they commit the fixture, not after.
 */
export function secretsFor(key: string): readonly string[] {
	if (key === '') return [];
	// TWO SPLITTINGS, because the adapter's is not this one. `brightdata/index.ts` splits at
	// the FIRST colon, so a key `a:b:c` goes on the wire as zone `a` and token `b:c` — and a
	// naive split on every colon lists `a`, `b`, `c` and never the token that was actually
	// sent. Every-colon covers a key whose parts are each used separately; first-colon covers
	// the shape one shipped adapter really uses. Both, then deduplicated.
	const everyColon = key.split(':');
	const at = key.indexOf(':');
	const firstColon = at > 0 ? [key.slice(0, at), key.slice(at + 1)] : [];
	const parts = [...everyColon, ...firstColon].filter((p) => p !== '' && p !== key);
	return [...new Set([key, ...parts])].sort((a, b) => b.length - a.length);
}

/**
 * Remove the key from anywhere it can appear: query string, headers, body.
 *
 * Deliberately blunt — a global replace of the literal secret rather than knowledge of
 * where each provider puts it. Being clever here means being wrong for provider #4.
 */
export function sanitize(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const s of secrets) {
		if (s.length < MIN_SECRET_LENGTH) continue; // too short to replace safely
		out = out.split(s).join(REDACTED);
	}
	return out;
}

export function sanitizeHeaders(
	headers: Record<string, string>,
	secrets: readonly string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		const lower = k.toLowerCase();
		// Blanket-redact anything auth-shaped even if the value is not the key we know
		// about — a provider echoing a session token back is not something to store.
		// `[-_]?`, not `-?`. ScraperAPI's key header is `x-sapi-api_key`, which the hyphen-only
		// pattern did not match — it was redacted only because its value happened to be in
		// `secrets`. The name matcher exists to catch secrets whose value we do NOT know, so a
		// separator it cannot spell is a hole in exactly the case it is there for.
		if (
			!NOT_SECRET.has(lower) &&
			/authorization|api[-_]?key|token|cookie|set-cookie|secret|bearer/i.test(k)
		) {
			out[k] = REDACTED;
			continue;
		}
		// Volatility is checked AFTER secrecy: a header that is both must be redacted, not
		// merely marked volatile, or the ordering leaks it.
		// A forwarding header in the RESPONSE carries the same addresses a body echoes. It used to
		// be gated but never redacted, so a provider sending one made the fixture unrecordable.
		const value = ECHO_KEY.test(lower) ? v.replace(ADDRESS, REDACTED) : v;
		out[k] = isVolatile(lower) ? VOLATILE : sanitize(value, secrets);
	}
	return out;
}

/**
 * The SHAPE of a response, with every value thrown away.
 *
 * BYTE COMPARISON DOES NOT WORK HERE, and finding out cost one real recording. A fresh Scrapfly
 * capture of the same URL differed from the committed one in 15 of 141 body fields — and every
 * one was volatile by design: the request uuid, two timestamps, the duration, and a rotated
 * browser and proxy fingerprint (`context.os`, `context.lang`, `context.proxy.country`, the
 * matching `user-agent` and `accept-language`). That rotation is the product working. A detector
 * that called it drift would fail every week, and a weekly false alarm is how a real one stops
 * being read — the same reasoning the canary's dormancy gates are built on.
 *
 * So compare what an ADAPTER actually depends on: which fields exist and what type they hold.
 * `result.content` disappearing, `context.proxy` losing a member, a string becoming an object —
 * those break `parse()`. A rotated user-agent does not.
 *
 * Header NAMES for the same reason: `x-scrapfly-remaining-api-credit` counts down on every call
 * and `x-scrapfly-response-time` is a duration, so their values are noise while their absence
 * would be news.
 */
/**
 * Header NAMES whose presence varies per request, so they cannot be part of a shape.
 *
 * `VOLATILE_HEADERS` above handles headers whose VALUE changes; these come and go. Measured,
 * not guessed, on 2026-09-16 across two runs a few hours apart against the same providers:
 *
 *   connection, keep-alive          hop-by-hop; whichever edge answered decides
 *   content-length vs transfer-encoding   the same response framed two ways, chosen per stream
 *   age                              present only on a cache hit
 *   sa-proxy-hash                    ScraperAPI names the exit proxy on some responses and not
 *                                    others: "1 gone" in the morning, "1 new" that evening
 *
 * None of them is read by any `parse()`. Once `record-diff` stopped swallowing its exit code,
 * these alone opened a drift issue on every adapter, every week.
 */
const SHAPELESS_HEADERS = new Set([
	'age',
	'connection',
	'content-length',
	'keep-alive',
	'sa-proxy-hash',
	'transfer-encoding',
]);

/**
 * Maps whose KEYS are someone else's data, so the map is shape and its contents are not.
 *
 *   headers                  httpbin's echo of the REQUEST the provider sent. Which headers a
 *                            provider's browser or proxy attaches (`Sec-Ch-Ua`, `Dnt`,
 *                            `Accept-Language`) changes with the exit it used, so the same
 *                            fixture reported "6 gone" one run and matched the next
 *   response_headers, request_headers   the target's headers inside a provider envelope
 *   config                   Scrapfly's echo of the scrape config; `unblocker` appeared on
 *                            some responses and not others within the same afternoon
 *   session_storage_data, local_storage_data   the target page's own storage
 *
 * The node itself stays — `body.result.response_headers:object` still has to be there, and
 * its disappearance is news. What stops being compared is which keys happen to be inside it.
 * The one `parse()` that reads such a map (Scrapfly, for a `retry-after` by name) treats a
 * missing key as "no header", so no outcome depends on a key this skips.
 */
const OPAQUE_MAPS = new Set([
	'config',
	'headers',
	'local_storage_data',
	'request_headers',
	'response_headers',
	'session_storage_data',
]);

export function shapeOf(fixture: Record<string, unknown>): string[] {
	const r = (fixture.response ?? {}) as Record<string, unknown>;
	const out: string[] = [`status:${String(r.status)}`];

	const headers = (r.headers ?? {}) as Record<string, unknown>;
	for (const h of Object.keys(headers).sort()) {
		if (!SHAPELESS_HEADERS.has(h.toLowerCase())) out.push(`header:${h}`);
	}

	// A non-JSON body is a page from a live target, and its content changes because the web
	// changes. Nothing about it is a claim regarding the provider, so only the envelope is.
	const b64 = typeof r.bodyBase64 === 'string' ? r.bodyBase64 : '';
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
	} catch {
		out.push('body:opaque');
		return out;
	}

	const walk = (v: unknown, path: string): void => {
		if (Array.isArray(v)) {
			// Collapsed by index. A list that grew by an element is not a shape change; a list
			// whose elements changed type is.
			out.push(`${path}:array`);
			for (const el of v.slice(0, 1)) walk(el, `${path}[]`);
		} else if (v !== null && typeof v === 'object') {
			out.push(`${path}:object`);
			// The map is shape; its keys are the target's or the request's. See OPAQUE_MAPS.
			const leaf = path.slice(path.lastIndexOf('.') + 1);
			if (OPAQUE_MAPS.has(leaf)) return;
			for (const k of Object.keys(v as object).sort()) {
				walk((v as Record<string, unknown>)[k], `${path}.${k}`);
			}
		} else {
			out.push(`${path}:${v === null ? 'null' : typeof v}`);
		}
	};
	walk(parsed, 'body');
	return out;
}

export const RENEW_AFTER_DAYS = 30;

/**
 * Split the matrix by `--only`: what this run records, and what it deliberately leaves out.
 *
 * `--only` USED TO BE A DISAPPEARANCE, and every scheduled `record:diff` since the deadline
 * pass was added has been red because of it. The filter dropped the other categories before
 * the loop, so they never reached `skipped`, and `reportDiff` — which walks the union of both
 * directories precisely so a category cannot vanish unnoticed — did its job and called each of
 * them "committed, but this run recorded nothing for it". Eleven fabricated drifts per adapter,
 * per week, from the one pass whose only purpose is to check the single fixture the first pass
 * cannot. And that step opens no issue, so it stayed red in a place nobody looks.
 *
 * The categories outside `--only` are a scope decision, not a recording failure, and the diff
 * has to be told the difference. `deferred` is that list.
 */
export function partitionByOnly(
	targets: readonly Target[],
	only: string | undefined,
): { readonly selected: readonly Target[]; readonly deferred: readonly TargetCategory[] } {
	if (only === undefined) return { selected: targets, deferred: [] };
	return {
		selected: targets.filter((t) => t.category === only),
		deferred: targets.filter((t) => t.category !== only).map((t) => t.category),
	};
}

/**
 * Compare a fresh recording against the committed one, and renew what has not changed.
 *
 * `recordedAt` is the whole point of the exercise: a fixture whose shape re-records unchanged is
 * not stale, it is CONFIRMED. Stamping its date forward turns a freshness rule from a quarterly
 * re-record treadmill into something that only fires where re-recording is failing or has never
 * run — which is exactly the population worth looking at. Gated on the old date being 30 days
 * old, or a weekly job produces a weekly pull request of nothing but timestamps, which is how a
 * reviewer learns to approve this job's diffs without reading them.
 */
export function reportDiff(
	adapterId: string,
	committedDir: string,
	freshDir: string,
	run: {
		readonly failed: number;
		readonly skipped: readonly string[];
		/** Categories whose fresh recording no longer parses to the outcome the matrix expects. */
		readonly mismatched: readonly string[];
		/**
		 * Categories the provider answered `RATE_LIMITED` — the plan's credits are spent or its
		 * concurrency cap was hit. Required rather than optional: a caller that has not decided
		 * what to do about an empty wallet is the caller this field exists for.
		 */
		readonly exhausted: readonly string[];
		/**
		 * Categories outside `--only`, which this run never tried. A scope decision, not a
		 * recording failure — see `partitionByOnly`. Optional, because a full run has none.
		 */
		readonly deferred?: readonly string[];
	},
): number {
	// A RECORDING PASS THAT COULD NOT RECORD IS NOT EVIDENCE OF NO DRIFT, and this is the hole
	// that shipped in the commit which fixed the previous version of this hole. `failed` was
	// incremented by three paths in the loop above — oversize, transport failure, deadline
	// refusal — and read by nothing in diff mode. So on a Wednesday when a provider was
	// unreachable, the fresh directory came back empty, the comparison had nothing to compare,
	// and the job printed "0 fixture(s) unchanged in shape" and exited 0. Reproduced against
	// the real corpus: 11 committed Scrapfly fixtures, none compared, exit 0.
	if (run.failed > 0) {
		process.stderr.write(
			`\n  ${adapterId}: ${run.failed} recording(s) failed, so nothing can be concluded about\n` +
				'  drift. A pass that could not record is not a pass.\n\n',
		);
		return 1;
	}

	if (!existsSync(committedDir)) {
		process.stdout.write(`\n  ${adapterId}: no committed fixtures to diff against\n\n`);
		return 0;
	}

	const changed: string[] = [];
	const unchecked: string[] = [];
	let confirmed = 0;
	let renewed = 0;

	// THE UNION OF BOTH DIRECTORIES, not just the fresh one. Walking only what was recorded
	// this run means a category that stopped recording disappears from the report entirely —
	// the fixture most likely to have drifted is the one silently dropped from the comparison.
	const jsons = (d: string) =>
		existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')) : [];
	const names = [...new Set([...jsons(committedDir), ...jsons(freshDir)])].sort();

	for (const name of names) {
		const committedPath = join(committedDir, name);
		const freshPath = join(freshDir, name);
		const category = name.replace(/\.json$/, '');

		// AN EMPTY WALLET IS NOT A CHANGED PROVIDER, and this is the same lesson as #266 arriving
		// at a command that never learned it. A spent plan answers 403 or 429 to every category
		// alike, so `parse()` returns RATE_LIMITED where the matrix expected a target fact — and
		// every branch below then reads that as drift. Observed on the 2026-09-02 scheduled run:
		// ScraperAPI at zero credits reported `dead-host` and `target-error` as having stopped
		// producing TARGET_ERROR, plus a `deadline.json` "absent from the corpus", none of which
		// had moved. A weekly report of fabricated drift is how a real one stops being read.
		//
		// Checked before the existence branches, because an exhausted run writes no fixture at
		// all for some categories and a partial one for others — both are the same non-event.
		// Not counted as a pass either: these land in NOT CHECKED, and the zero-denominator
		// guard below still fails a run where nothing could be compared.
		// Never re-recordable on demand: it exists only when a plan happened to be spent. A diff
		// run cannot compare it, and calling its absence from a funded run "recorded nothing" would
		// report drift every week the wallet has credit in it.
		if (category === QUOTA_FIXTURE) {
			unchecked.push(`${category} (captured only from a spent plan)`);
			continue;
		}
		if (run.exhausted.includes(category)) {
			unchecked.push(`${category} (account out of credit)`);
			continue;
		}

		// Outside `--only`. Not recorded on purpose, and said so, rather than read as a fixture
		// that stopped recording — which is what the branch below would otherwise conclude.
		if (run.deferred?.includes(category)) {
			unchecked.push(`${category} (outside --only)`);
			continue;
		}

		if (!existsSync(freshPath)) {
			// Deliberately not recorded this run, or not recorded at all. Only the first is
			// acceptable, and it still has to be SAID: `deadline` needs `--timeout-ms` below the
			// target's delay, so without a second scoped pass it is exempt from drift detection
			// every single week while the report calls everything else confirmed.
			if (run.skipped.includes(category)) unchecked.push(category);
			else changed.push(`${name}: committed, but this run recorded nothing for it`);
			continue;
		}
		if (!existsSync(committedPath)) {
			changed.push(`${name}: recorded now, absent from the corpus`);
			continue;
		}
		const before = JSON.parse(readFileSync(committedPath, 'utf8')) as Record<string, unknown>;
		const after = JSON.parse(readFileSync(join(freshDir, name), 'utf8')) as Record<
			string,
			unknown
		>;

		// A RESPONSE THAT PARSES TO A DIFFERENT OUTCOME is the most consequential drift there is,
		// and this compared two copies of the same source constant. `expect` is written verbatim
		// from the TARGETS matrix on every recording, so `before.expect` and `after.expect` are
		// the same literal and the branch could not fire — while the REAL verdict, `parse()` run
		// over the bytes just recorded, was computed for the console line and then discarded in
		// diff mode.
		//
		// `run.mismatched` carries it now. Exactly the shape of the defect this whole command
		// exists to prevent, in the command itself: a comparison whose two sides come from one
		// place.
		if (run.mismatched.includes(category)) {
			changed.push(
				`${category}: still records, but parse() no longer produces ${String(before.expect)}`,
			);
			continue;
		}

		const was = new Set(shapeOf(before));
		const now = new Set(shapeOf(after));
		const gone = [...was].filter((x) => !now.has(x));
		const added = [...now].filter((x) => !was.has(x));
		if (gone.length > 0 || added.length > 0) {
			const detail = [
				...gone.slice(0, 3).map((g) => `-${g}`),
				...added.slice(0, 3).map((a) => `+${a}`),
			].join(' ');
			changed.push(`${name}: ${gone.length} gone, ${added.length} new  ${detail}`);
			continue;
		}

		const at =
			typeof before.recordedAt === 'string' ? Date.parse(before.recordedAt) : Number.NaN;
		const fresh = after.recordedAt;
		const ageDays = (Date.parse(String(fresh)) - at) / 86_400_000;
		if (!Number.isFinite(ageDays) || ageDays >= RENEW_AFTER_DAYS) {
			// A date stamp, never a content update. Copying the fresh FILE would overwrite the
			// corpus with a differently-fingerprinted recording for no reason.
			before.recordedAt = fresh;
			writeFileSync(committedPath, `${JSON.stringify(before, null, '\t')}\n`);
			renewed += 1;
		} else {
			confirmed += 1;
		}
	}

	const uncheckedLine =
		unchecked.length > 0
			? `  NOT CHECKED: ${unchecked.join(', ')} — re-run with --only=<category> --timeout-ms=<n>\n`
			: '';

	if (changed.length === 0) {
		// Non-zero denominator. Comparing nothing and calling it unchanged is the failure this
		// whole function was rewritten to remove, so it cannot be allowed to pass quietly.
		if (confirmed + renewed === 0) {
			process.stderr.write(
				`\n  ${adapterId}: nothing was compared. ${unchecked.length} skipped, 0 recorded.\n` +
					'  An empty comparison is not a clean one.\n\n',
			);
			return 1;
		}
		process.stdout.write(
			`\n  ${adapterId}: ${confirmed + renewed} fixture(s) unchanged in shape` +
				`${renewed > 0 ? `, ${renewed} date(s) renewed` : ''}\n${uncheckedLine}\n`,
		);
		return 0;
	}
	process.stderr.write(
		`\n  ${adapterId}: ${changed.length} fixture(s) changed shape\n\n` +
			changed.map((c) => `    ${c}\n`).join('') +
			uncheckedLine +
			`\n  ${confirmed + renewed} unchanged. Re-record with \`pnpm record --adapter=${adapterId}\`\n` +
			'  and read the diff: a provider changing its response shape is what this job exists\n' +
			'  to catch, and it is what breaks parse().\n\n',
	);
	return 1;
}

// ---------------------------------------------------------------- cli
//
// Guarded so a test can import sanitize()/TARGETS without the script executing, exiting
// the test runner, or reaching for a key.

if (import.meta.filename === process.argv[1]) {
	const args = process.argv.slice(2);
	const adapterId = args.find((a) => a.startsWith('--adapter='))?.split('=')[1];
	const dryRun = args.includes('--dry-run');
	// RE-RECORD AND COMPARE, rather than overwrite. The weekly `record-diff` job has been running
	// `pnpm record --diff` since the scheduled workflow was written, and this flag did not exist
	// anywhere else in the repository — so the command exited 2 on the missing `--adapter`, the
	// `|| echo` swallowed it, and a drift detector reported success every Wednesday without ever
	// comparing anything. That is the exit-0 stub this whole repo is built against, wearing a
	// cron schedule.
	const diff = args.includes('--diff');
	const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
	// Without this there is no way to produce a deadline fixture at all: every launch
	// provider's maxTimeoutMs exceeds any delay a public test target will hold open, so the
	// abort path can never fire from the matrix alone.
	const timeoutArg = args.find((a) => a.startsWith('--timeout-ms='))?.split('=')[1];
	const timeoutOverride = timeoutArg === undefined ? undefined : Number(timeoutArg);
	if (timeoutOverride !== undefined && !Number.isFinite(timeoutOverride)) {
		process.stderr.write(`--timeout-ms must be a number, got "${timeoutArg}"\n`);
		process.exit(2);
	}

	if (!adapterId) {
		process.stderr.write(
			[
				'usage: pnpm record --adapter=<id> [--dry-run] [--only=<category>] [--diff]',
				'',
				'  --dry-run    print the plan and the credit cost. Spends nothing.',
				'  --diff       re-record and compare SHAPE. Exits 1 on drift; renews a stale date.',
				'  --only=<c>   record one category, for re-recording after drift.',
				'  --timeout-ms=<n>  override the per-attempt budget, to force a deadline fixture.',
				'',
				'Credits do not refund. Run --dry-run first.',
				'',
			].join('\n'),
		);
		process.exit(2);
	}

	const { selected: targets, deferred } = partitionByOnly(TARGETS, only);
	if (targets.length === 0) {
		process.stderr.write(
			`no target category "${only}". Known: ${TARGETS.map((t) => t.category).join(', ')}\n`,
		);
		process.exit(2);
	}

	// ---------------------------------------------------------------- run

	const envVar = `${adapterId.toUpperCase().replace(/-/g, '_')}_KEY`;
	// Trimmed for the reason `providerKeyFromEnv` gives. Not imported from `@proxlane/shared`
	// here: `scripts/` is zero-dependency by rule and runs without a build, so it repeats the
	// one line rather than reaching into a package's dist.
	const key = process.env[envVar]?.trim() || undefined;
	const registryKey = adapterId.replace(/-/g, '_');

	type DevEntry = { load: () => Promise<Adapter>; why: string; keyless: boolean };
	let registry: Record<string, () => Promise<Adapter>> = {};
	let devRegistry: Record<string, DevEntry> = {};
	try {
		const mod = (await import('@proxlane/adapters')) as unknown as {
			REGISTRY?: Record<string, () => Promise<Adapter>>;
		};
		registry = mod.REGISTRY ?? {};
	} catch {
		process.stderr.write('@proxlane/adapters failed to load. Run `pnpm build` first.\n');
		process.exit(2);
	}

	// Loaded from dev-dist/ by path, NOT from the package entry. `files: ["dist"]` cannot
	// reach dev-dist, which is what makes the dev adapters unpublishable rather than merely
	// asserted-absent. Missing is normal and not an error: it only means `pnpm build` has
	// not run, and real adapters do not need it.
	try {
		const devUrl = pathToFileURL(
			join(ROOT, 'packages/adapters/dev-dist/dev-registry.mjs'),
		).href;
		const devMod = (await import(devUrl)) as { DEV_REGISTRY?: Record<string, DevEntry> };
		devRegistry = devMod.DEV_REGISTRY ?? {};
	} catch {
		devRegistry = {};
	}

	// Real providers win a name collision — a dev entry must never shadow one. repo:check
	// asserts the two registries are disjoint, so this is belt and braces.
	const dev = registry[registryKey] ? undefined : devRegistry[registryKey];
	const load = registry[registryKey] ?? dev?.load;
	if (!load) {
		const known = [...Object.keys(registry), ...Object.keys(devRegistry)];
		process.stderr.write(
			`"${adapterId}" is not in the registry. Known: ${known.join(', ') || '(none)'}\n` +
				(Object.keys(registry).length === 0
					? 'No real adapters exist yet — run `pnpm new-adapter <id>` to scaffold one.\n'
					: ''),
		);
		process.exit(2);
	}
	const adapter = await load();

	// A dev adapter is not a provider. Say so every single time, on stderr, so it cannot be
	// mistaken for one in a scrollback or a pasted issue.
	if (dev) process.stderr.write(`\n  NOTE: ${adapterId} is a DEV adapter — ${dev.why}.\n`);

	if (dryRun) {
		process.stdout.write(
			[
				'',
				`  DRY RUN — ${adapterId}. Nothing is requested and no credits are spent.`,
				'',
				...targets.map(
					(t) =>
						`    ${t.category.padEnd(18)} ${t.renderJs ? 'renderJs ' : '         '} ${t.url}\n` +
						`    ${' '.repeat(18)} expect ${t.expect} — ${t.why}`,
				),
				'',
				`    ${targets.length} request(s). renderJs requests usually cost 5-25x a plain one,`,
				"    so check the provider's multiplier table before a full pass.",
				'',
				dev?.keyless
					? `    Key: none needed — ${adapterId} is keyless`
					: `    Key: ${envVar} ${key ? 'is set' : 'is NOT set — the real run will fail'}`,
				'',
			].join('\n'),
		);
		process.exit(0);
	}

	if (!key && !dev?.keyless) {
		process.stderr.write(
			[
				`${envVar} is not set.`,
				'',
				'Put it in .env.local (gitignored) or export it for this shell.',
				'Run with --dry-run first to see what would be requested.',
				'',
			].join('\n'),
		);
		process.exit(2);
	}

	// Narrowed once, here. A keyless adapter legitimately has no key, and `''` is the value
	// translate() is documented to treat as "send no credential" — but it must never reach
	// sanitize(), where an empty needle would match at every position.
	const providerKey = key ?? '';
	const secrets = secretsFor(providerKey);
	// A component too short to replace safely is a hole in exactly the redaction this step
	// exists for, and silence about it is how the Bright Data zone reached a public fixture.
	for (const s of secrets) {
		if (s.length >= MIN_SECRET_LENGTH) continue;
		process.stderr.write(
			`\n  WARNING: one component of ${envVar} is ${s.length} characters, below the ` +
				`${MIN_SECRET_LENGTH}-character floor, so it will NOT be redacted.\n` +
				'  Read the recorded fixtures before committing them.\n\n',
		);
	}

	// A dev adapter's fixtures must not land beside the real ones. Writing them to
	// packages/adapters/src/<id>/ produces a directory indistinguishable from a supported
	// provider, which is the same lie dev-registry.ts exists to prevent, arriving by a
	// different door.
	const adapterDir = dev
		? join('packages/adapters/src/_dev', adapterId)
		: join('packages/adapters/src', adapterId);
	const committedDir = join(ROOT, adapterDir, 'fixtures');
	// A diff run must not touch the committed corpus until it has decided nothing changed.
	const outDir = diff
		? mkdtempSync(join(tmpdir(), `proxlane-diff-${adapterId}-`))
		: committedDir;
	mkdirSync(outDir, { recursive: true });

	let failed = 0;
	const mismatched: string[] = [];
	const exhausted: string[] = [];
	let quotaKept = false;
	const unparsed: string[] = [];
	const skipped: string[] = [];
	for (const target of targets) {
		if (target.onlyAdapters !== undefined && !target.onlyAdapters.includes(adapterId)) {
			// Reported, never silent. A category that vanishes without a word is how a gap in the
			// corpus becomes invisible.
			process.stdout.write(
				`  ${target.category.padEnd(18)} skipped — recorded only for ${target.onlyAdapters.join(', ')}\n`,
			);
			skipped.push(target.category);
			continue;
		}
		if (target.method === 'POST' && !adapter.capabilities.post) {
			// The adapter refuses in translate(), by contract, and the recorder used to crash on
			// the throw. An adapter that cannot forward a POST has no POST fixture to record, and
			// conformance does not require one; it is reported here so the gap is a decision and
			// not a hole in the corpus. Firecrawl is the first adapter this applied to.
			process.stdout.write(
				`  ${target.category.padEnd(18)} skipped — this adapter declares post: false\n`,
			);
			skipped.push(target.category);
			continue;
		}
		if (target.needsDeadline === true && timeoutOverride === undefined) {
			// Not a failure: without the flag this category can only record something that is
			// not a deadline, which is how the old `timeout` fixture came to hold a 422.
			process.stdout.write(
				`  ${target.category.padEnd(18)} skipped — needs --timeout-ms below the target delay\n`,
			);
			skipped.push(target.category);
			continue;
		}
		const req: GatewayRequest = {
			url: target.url,
			method: target.method ?? 'GET',
			...(target.body === undefined ? {} : { body: target.body }),
			renderJs: target.renderJs,
			premium: 'none',
			deadlineMs: 60_000,
		};

		// The adapter builds the request, so the fixture is exactly what it will send in
		// production. Recording a hand-built request would test the recorder, not the adapter.
		const wire = adapter.translate(req, providerKey);

		process.stdout.write(`  ${target.category.padEnd(18)} `);
		// ONE EXECUTOR, the gateway's own, so a fixture records the request production sends and
		// the transfer production performs. A second hand-rolled fetch here is how the live canary
		// came to drop `wire.body` and report a working Bright Data key as dead for weeks.
		//
		// The transport also discriminates deadline from transport error on its own signal, which
		// is what `classifyTransportError` did here by hand. Branching on `kind` replaces a
		// throw/catch whose `finally` existed only to clear a timer this file no longer owns.
		const budgetMs = timeoutOverride ?? wire.timeoutMs;
		const transportResult = await createFetchTransport().execute(wire, {
			budgetMs,
			maxBodyBytes: MAX_FIXTURE_BYTES,
		});

		if (transportResult.kind === 'too-large') {
			// Refuse rather than commit a multi-megabyte fixture. operations.md section 1 caps a
			// real response at 10 MB; a fixture is read into memory by every contract test and
			// lives in git forever, so the recorder's ceiling is its own.
			process.stdout.write(`REFUSED: body exceeded ${MAX_FIXTURE_BYTES} bytes\n`);
			failed++;
			continue;
		}

		if (transportResult.kind === 'timeout') {
			// A deadline fixture has no status and no body. Writing one over a category that
			// expects content replaces a good recording with an artefact of the flag that produced
			// it — `--timeout-ms=1 --only=success-html` did exactly that, silently.
			if (target.expect !== 'PROVIDER_TIMEOUT') {
				process.stdout.write(
					`timed out after ${budgetMs}ms — NOT written: ${target.category} expects ` +
						`${target.expect}, and a deadline fixture would destroy it\n`,
				);
				failed++;
				continue;
			}
			process.stdout.write(`timed out after ${budgetMs}ms (recorded)\n`);
			const deadline: DeadlineFixture = {
				kind: 'deadline',
				category: target.category,
				recordedAt: new Date().toISOString(),
				adapter: adapterId,
				target: { url: target.url, renderJs: target.renderJs },
				expect: target.expect,
				transportError: 'aborted-by-deadline',
				timeoutMs: budgetMs,
			};
			writeFileSync(
				join(outDir, `${target.category}.json`),
				`${JSON.stringify(deadline, null, '\t')}\n`,
			);
			continue;
		}

		if (transportResult.kind !== 'response') {
			const detail =
				'message' in transportResult ? transportResult.message : transportResult.kind;
			process.stdout.write(`FAILED: ${detail}\n`);
			failed++;
			continue;
		}

		const res = transportResult.response;
		const rawBytes = res.body;
		// parse() sees the REAL bytes; only the stored fixture is redacted. Verifying the adapter
		// against a redacted body would test the redaction, not the provider.
		const bytes = sanitizeBody(rawBytes, secrets);
		const resHeaders = res.headers;

		const fixture: ExchangeFixture = {
			kind: 'exchange',
			category: target.category,
			recordedAt: new Date().toISOString(),
			adapter: adapterId,
			target: { url: target.url, renderJs: target.renderJs },
			expect: target.expect,
			request: {
				method: wire.method,
				url: sanitize(wire.url, secrets),
				headers: sanitizeHeaders(wire.headers, secrets),
				// RECORDED, because the comment above says a fixture is exactly what the adapter
				// sends and without this it was not. Every launch adapter but Bright Data puts its
				// parameters in the query string, so the omission was invisible until one POSTed a
				// JSON payload — and then the fixture showed a request with the target url nowhere
				// in it. Absent rather than empty for a GET: "no body" and "an empty body" are not
				// the same request.
				...(wire.body === undefined
					? {}
					: {
							body: redactIdentifyingFields(sanitize(wire.body, secrets), [
								...IDENTIFYING_FIELDS,
								...REQUEST_ONLY_FIELDS,
							]),
						}),
			},
			response: {
				status: res.status,
				headers: sanitizeHeaders(resHeaders, secrets),
				bodyBase64: Buffer.from(bytes).toString('base64'),
				bodyBytes: bytes.byteLength,
			},
		};

		// Assert the sanitizer worked rather than trusting it. A leaked key in a committed
		// fixture is unrecoverable once pushed — the check is cheap and the failure is not.
		const serialized = JSON.stringify(fixture, null, '\t');
		// Decode the body back out before scanning. The old check ran over the SERIALIZED
		// fixture, where the body is base64 — so it could never see a secret in a body, in
		// the one place nothing else was looking either.
		const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		const scannable = `${serialized}\n${bodyText}`;
		// COLLECTED, THEN ACTED ON. This used to `failed++` inside the loop and fall straight
		// through to `writeFileSync` — so a fixture whose `client_ip` survived redaction (the
		// maintainer's egress address, which CLAUDE.md bans from this repo outright) was
		// written into the tracked fixture directory while the operator was told it had been
		// refused. One `git add -A` and it is in public history. `continue` inside the loop
		// would only have advanced the FIELD, which is presumably how it was missed.
		const leaked = IDENTIFYING_FIELDS.filter((field) =>
			new RegExp(`"${field}"\\s*:\\s*"(?!${REDACTED})`).test(scannable),
		);
		if (fixtureCarriesEchoedAddress(serialized, bodyText))
			leaked.push('an echoed request-path address (origin, X-Forwarded-For)');
		if (leaked.length > 0) {
			process.stderr.write(
				`\n  REFUSING TO WRITE ${target.category}: ${leaked.map((f) => `"${f}"`).join(', ')} survived redaction.\n` +
					'  This is a bug in sanitizeBody(); fix it before recording again.\n',
			);
			failed++;
			continue;
		}
		// EVERY NEEDLE, not just the joined key. This gate read `providerKey` alone, which is
		// exactly the blindness that let the Bright Data zone through: the joined key never
		// reaches the wire for that adapter, so scanning for it could not fail.
		//
		// THE FLOOR APPLIES TO COMPONENTS ONLY, and the asymmetry is deliberate. A short
		// COMPONENT is excluded because `sanitize()` skips it too and a two-character needle
		// matches everything, so the operator is warned about those before the first request
		// instead. The joined KEY stays unconditional, exactly as it was before this function
		// existed: it is one exact string, it was always in this scan, and a gate that starts
		// waving through a short key would be this change making the check weaker than it
		// found it.
		const survived = secrets.filter(
			(needle) =>
				(needle === providerKey || needle.length >= MIN_SECRET_LENGTH) &&
				scannable.includes(needle),
		);
		if (survived.length > 0) {
			process.stderr.write(
				`\n  REFUSING TO WRITE ${target.category}: ${survived.length === 1 ? 'a key component' : `${survived.length} key components`} survived sanitization.\n` +
					'  This is a bug in sanitize(); fix it before recording again.\n',
			);
			failed++;
			continue;
		}

		// Close the loop: run the adapter's own parse() over what was just recorded and
		// say whether it produced the outcome the matrix expected. Without this the
		// recorder happily writes a fixture whose `expect` contradicts its contents — it
		// did exactly that on the first live run, storing a 422 under a fixture labelled
		// PROVIDER_TIMEOUT, and nothing noticed.
		//
		// Reported, never fatal. Fixtures are recorded BEFORE parse() is implemented, so a
		// throwing stub is the expected state on day one and asserting here would make the
		// normal authoring order impossible. Conformance is what asserts.
		//
		// PARSED BEFORE IT IS WRITTEN, because the outcome decides the file. See QUOTA_FIXTURE.
		let parsedOutcome: string | undefined;
		let parseError: string | undefined;
		try {
			parsedOutcome = adapter.parse({
				status: res.status,
				headers: resHeaders,
				body: rawBytes,
			}).outcome;
		} catch (err) {
			parseError = err instanceof Error ? err.message : String(err);
		}
		// What THIS adapter owes for the category, which is the matrix's expectation unless the
		// provider cannot report the target's status. Same helper conformance uses.
		const expect = expectedOutcome(adapter.capabilities, target.expect);
		const file = fixtureFileFor(target.category, expect, parsedOutcome, diff);
		// The FIRST refusal of a run, not the last: after it every category gets the same answer,
		// and overwriting it would only swap which interrupted target the file names.
		if (file === QUOTA_FIXTURE && !quotaKept) {
			quotaKept = true;
			const quota: ExchangeFixture = {
				...fixture,
				category: QUOTA_FIXTURE,
				expect: 'QUOTA_EXHAUSTED',
			};
			writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(quota, null, '\t')}\n`);
		} else if (file !== undefined && file !== QUOTA_FIXTURE) {
			writeFileSync(join(outDir, `${file}.json`), `${serialized}\n`);
		}

		let verdict: string;
		if (parsedOutcome === undefined) {
			verdict = `? parse() threw: ${parseError}`;
			unparsed.push(target.category);
		} else if (expect === 'provider-dependent') {
			verdict = `~ ${parsedOutcome} (provider-dependent, not asserted)`;
		} else if (parsedOutcome === expect) {
			verdict = `= ${parsedOutcome}`;
		} else if (parsedOutcome === 'RATE_LIMITED' || parsedOutcome === 'QUOTA_EXHAUSTED') {
			// The wallet, not the provider. Separated here rather than in reportDiff so the
			// console line a human reads says which of the two it was, and so the non-diff
			// summary below stops calling a spent plan an unexpected outcome.
			//
			// BOTH, and permanently. A spent plan is QUOTA_EXHAUSTED once the adapters emit it;
			// a concurrency cap hit mid-recording is RATE_LIMITED. Neither is a change in what a
			// fixture looks like, which is the only thing this command is asking.
			verdict =
				file === QUOTA_FIXTURE
					? `! got ${parsedOutcome} (account, not provider) — kept as ${QUOTA_FIXTURE}.json`
					: `! got ${parsedOutcome} (account, not provider)`;
			exhausted.push(target.category);
		} else {
			verdict = `! got ${parsedOutcome}`;
			mismatched.push(target.category);
		}
		process.stdout.write(
			`${String(res.status).padEnd(4)} ${String(bytes.byteLength).padStart(6)}b  ${verdict}\n`,
		);
	}

	if (diff) {
		process.exit(
			reportDiff(adapterId, committedDir, outDir, {
				failed,
				skipped,
				mismatched,
				exhausted,
				deferred,
			}),
		);
	}

	process.stdout.write(
		[
			'',
			`  ${targets.length - failed - skipped.length}/${targets.length - skipped.length} recorded to ${adapterDir}/fixtures/`,
			...(skipped.length > 0 ? [`  ${skipped.length} skipped: ${skipped.join(', ')}`] : []),
			...(unparsed.length > 0
				? [`  ${unparsed.length} not parsed yet (parse() throws): ${unparsed.join(', ')}`]
				: []),
			...(exhausted.length > 0
				? [
						`  ${exhausted.length} could not be recorded — account out of credit: ${exhausted.join(', ')}`,
						'  The provider is fine; the plan is spent. These fixtures were NOT refreshed.',
						...(existsSync(join(outDir, `${QUOTA_FIXTURE}.json`))
							? [`  The refusal itself is recorded as ${QUOTA_FIXTURE}.json.`]
							: []),
					]
				: []),
			...(mismatched.length > 0
				? [
						`  ${mismatched.length} parsed to an unexpected outcome: ${mismatched.join(', ')}`,
						'  Either parse() is wrong or the target stopped producing what it used to.',
						'  Both are worth knowing before these fixtures become the contract.',
					]
				: []),
			'',
			'  Block and captcha fixtures are NOT here: they cannot be produced on demand, and a',
			'  hand-written one would be a fabrication. Capture them from real traffic.',
			'',
		].join('\n'),
	);

	process.exit(failed > 0 ? 1 : 0);
}
