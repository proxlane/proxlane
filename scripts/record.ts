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
import type { Adapter, GatewayRequest } from '@proxlane/adapters';

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
	| 'render-js';

export interface Target {
	readonly category: TargetCategory;
	readonly url: string;
	readonly renderJs: boolean;
	/**
	 * What the adapter's parse() should map this to, compared against reality after
	 * recording. `provider-dependent` means there is no single right answer across providers
	 * and the comparison is skipped rather than reported as a mismatch forever.
	 */
	readonly expect: string;
	/**
	 * Only recorded when `--timeout-ms` forces our own deadline. A normal run skips it: no
	 * public target stays open longer than a provider's own budget, so without the flag this
	 * category can only ever record something that is not a deadline.
	 */
	readonly needsDeadline?: true;
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
		body: '{"proxlane":"post-fixture"}',
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
];

// ---------------------------------------------------------------- fixture shape

interface FixtureCommon {
	readonly category: TargetCategory;
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

/**
 * Did the deadline fire, or did the transport genuinely fail?
 *
 * Discriminated on the signal, never on the error message. Node reports an abort as
 * `AbortError: This operation was aborted`, so message-matching happens to work — but a DNS
 * or TLS failure whose text merely contains "abort" would then be recorded as a deadline
 * fixture. That is the recorder FABRICATING a fixture, and `CLAUDE.md` is explicit that CI
 * cannot tell a recording from a fabrication. The signal is a fact; the message is prose.
 */
export function classifyTransportError(signal: AbortSignal): 'deadline' | 'failure' {
	return signal.aborted ? 'deadline' : 'failure';
}

export const REDACTED = 'REDACTED';

/**
 * Ceiling on a recorded body.
 *
 * `operations.md` section 1 caps a real response at 10 MB. A fixture's ceiling is its own
 * concern and lower: every contract test reads it into memory, and it lives in git forever.
 */
export const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
	// A plain field, not a parameter property: `erasableSyntaxOnly` is on, because
	// scripts/*.ts run under Node's type stripping rather than through a compiler.
	bytes: number;
	constructor(bytes: number) {
		super(`response exceeded ${MAX_FIXTURE_BYTES} bytes`);
		this.name = 'ResponseTooLargeError';
		this.bytes = bytes;
	}
}

/**
 * Read the body with a ceiling, streaming rather than buffering blind.
 *
 * `res.arrayBuffer()` will happily accumulate whatever arrives, so a provider streaming an
 * enormous target would balloon memory and then commit the result. Streaming also means the
 * cap trips at the moment it is exceeded rather than after the whole transfer.
 */
export async function readCapped(
	res: { body: ReadableStream<Uint8Array> | null; arrayBuffer(): Promise<ArrayBuffer> },
	max: number,
): Promise<Uint8Array> {
	if (res.body === null) {
		// 204/304 and friends. arrayBuffer() on a null body yields an empty buffer.
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.byteLength > max) throw new ResponseTooLargeError(buf.byteLength);
		return buf;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined) continue;
			total += value.byteLength;
			if (total > max) throw new ResponseTooLargeError(total);
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

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
	/^(traceparent|tracestate)$|^x-b3-|(^|-)(trace|request|correlation)[-_]?(id|context)$/i;
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

	let out = sanitize(text, secrets);
	for (const field of IDENTIFYING_FIELDS) {
		out = out.replace(new RegExp(`("${field}"\\s*:\\s*)"[^"]*"`, 'g'), `$1"${REDACTED}"`);
	}
	return out === text ? bytes : new TextEncoder().encode(out);
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
		if (s.length < 8) continue; // too short to replace safely
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
		out[k] = isVolatile(lower) ? VOLATILE : sanitize(v, secrets);
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
function shapeOf(fixture: Record<string, unknown>): string[] {
	const r = (fixture.response ?? {}) as Record<string, unknown>;
	const out: string[] = [`status:${String(r.status)}`];

	const headers = (r.headers ?? {}) as Record<string, unknown>;
	for (const h of Object.keys(headers).sort()) out.push(`header:${h}`);

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

		if (!existsSync(freshPath)) {
			// Deliberately not recorded this run, or not recorded at all. Only the first is
			// acceptable, and it still has to be SAID: `deadline` needs `--timeout-ms` below the
			// target's delay, so without a second scoped pass it is exempt from drift detection
			// every single week while the report calls everything else confirmed.
			const category = name.replace(/\.json$/, '');
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
		const category = name.replace(/\.json$/, '');
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

	const targets = only ? TARGETS.filter((t) => t.category === only) : TARGETS;
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
	const secrets = providerKey === '' ? [] : [providerKey];

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
	const unparsed: string[] = [];
	const skipped: string[] = [];
	for (const target of targets) {
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
		// Declared out here, not in the try: the catch discriminates a deadline from a real
		// transport failure by reading this signal, and cannot see a try-scoped binding.
		const controller = new AbortController();
		const budgetMs = timeoutOverride ?? wire.timeoutMs;
		// Cleared in the `finally` below, NOT on the fetch promise. fetch() resolves when
		// HEADERS arrive, so clearing it there leaves the body read with no deadline at all —
		// measured: a 2000ms budget allowed a 12730ms request against a trickling target. For
		// a scraping gateway that is the case that matters, because providers stream the
		// target's response, so slowness lands in the body rather than the headers.
		const timer = setTimeout(() => controller.abort(), budgetMs);
		try {
			const res = await fetch(wire.url, {
				method: wire.method,
				headers: wire.headers,
				// Spread rather than `body: wire.body`. exactOptionalPropertyTypes rejects an
				// explicit undefined for an optional property, and it is right to: "absent"
				// and "present but undefined" are not the same request.
				...(wire.body === undefined ? {} : { body: wire.body }),
				signal: controller.signal,
				// fetch already handled content-encoding, which is what "post-transfer-decoding"
				// means. Charset decoding has not happened and must not.
			});

			const rawBytes = await readCapped(res, MAX_FIXTURE_BYTES);
			// parse() sees the REAL bytes; only the stored fixture is redacted. Verifying the
			// adapter against a redacted body would test the redaction, not the provider.
			const bytes = sanitizeBody(rawBytes, secrets);
			const resHeaders: Record<string, string> = {};
			res.headers.forEach((v, k) => {
				resHeaders[k] = v;
			});

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
			const scannable = `${serialized}\n${new TextDecoder('utf-8', { fatal: false }).decode(bytes)}`;
			// COLLECTED, THEN ACTED ON. This used to `failed++` inside the loop and fall straight
			// through to `writeFileSync` — so a fixture whose `client_ip` survived redaction (the
			// maintainer's egress address, which CLAUDE.md bans from this repo outright) was
			// written into the tracked fixture directory while the operator was told it had been
			// refused. One `git add -A` and it is in public history. `continue` inside the loop
			// would only have advanced the FIELD, which is presumably how it was missed.
			const leaked = IDENTIFYING_FIELDS.filter((field) =>
				new RegExp(`"${field}"\\s*:\\s*"(?!${REDACTED})`).test(scannable),
			);
			if (leaked.length > 0) {
				process.stderr.write(
					`\n  REFUSING TO WRITE ${target.category}: ${leaked.map((f) => `"${f}"`).join(', ')} survived redaction.\n` +
						'  This is a bug in sanitizeBody(); fix it before recording again.\n',
				);
				failed++;
				continue;
			}
			if (providerKey !== '' && scannable.includes(providerKey)) {
				process.stderr.write(
					`\n  REFUSING TO WRITE ${target.category}: the key survived sanitization.\n` +
						'  This is a bug in sanitize(); fix it before recording again.\n',
				);
				failed++;
				continue;
			}

			writeFileSync(join(outDir, `${target.category}.json`), `${serialized}\n`);

			// Close the loop: run the adapter's own parse() over what was just recorded and
			// say whether it produced the outcome the matrix expected. Without this the
			// recorder happily writes a fixture whose `expect` contradicts its contents — it
			// did exactly that on the first live run, storing a 422 under a fixture labelled
			// PROVIDER_TIMEOUT, and nothing noticed.
			//
			// Reported, never fatal. Fixtures are recorded BEFORE parse() is implemented, so a
			// throwing stub is the expected state on day one and asserting here would make the
			// normal authoring order impossible. Conformance is what asserts.
			let verdict: string;
			try {
				const got = adapter.parse({ status: res.status, headers: resHeaders, body: rawBytes });
				if (target.expect === 'provider-dependent') {
					verdict = `~ ${got.outcome} (provider-dependent, not asserted)`;
				} else {
					verdict = got.outcome === target.expect ? `= ${got.outcome}` : `! got ${got.outcome}`;
					if (got.outcome !== target.expect) mismatched.push(target.category);
				}
			} catch (err) {
				verdict = `? parse() threw: ${err instanceof Error ? err.message : String(err)}`;
				unparsed.push(target.category);
			}
			process.stdout.write(
				`${String(res.status).padEnd(4)} ${String(bytes.byteLength).padStart(6)}b  ${verdict}\n`,
			);
		} catch (err) {
			// A timeout here is a RESULT, not an error — the timeout fixture is meant to time out.
			// Record what happened so parse() has something to map. Anything else is a genuine
			// failure and must NOT leave a fixture behind.
			if (err instanceof ResponseTooLargeError) {
				// Refuse rather than commit a multi-megabyte fixture. operations.md section 1
				// caps a real response at 10 MB; a fixture is read into memory by every contract
				// test and lives in git forever, so the recorder's ceiling is its own.
				process.stdout.write(`REFUSED: body exceeded ${MAX_FIXTURE_BYTES} bytes\n`);
				failed++;
			} else if (classifyTransportError(controller.signal) === 'deadline') {
				// A deadline fixture has no status and no body. Writing one over a category that
				// expects content replaces a good recording with an artefact of the flag that
				// produced it — `--timeout-ms=1 --only=success-html` did exactly that, silently.
				if (target.expect !== 'PROVIDER_TIMEOUT') {
					process.stdout.write(
						`timed out after ${budgetMs}ms — NOT written: ${target.category} expects ` +
							`${target.expect}, and a deadline fixture would destroy it\n`,
					);
					failed++;
				} else {
					process.stdout.write(`timed out after ${budgetMs}ms (recorded)\n`);
					const fixture: DeadlineFixture = {
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
						`${JSON.stringify(fixture, null, '\t')}\n`,
					);
				}
			} else {
				process.stdout.write(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
				failed++;
			}
		} finally {
			clearTimeout(timer);
		}
	}

	if (diff) {
		process.exit(reportDiff(adapterId, committedDir, outDir, { failed, skipped, mismatched }));
	}

	process.stdout.write(
		[
			'',
			`  ${targets.length - failed - skipped.length}/${targets.length - skipped.length} recorded to ${adapterDir}/fixtures/`,
			...(skipped.length > 0 ? [`  ${skipped.length} skipped: ${skipped.join(', ')}`] : []),
			...(unparsed.length > 0
				? [`  ${unparsed.length} not parsed yet (parse() throws): ${unparsed.join(', ')}`]
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
