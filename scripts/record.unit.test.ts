// The recorder must be right BEFORE a key exists, because credits do not refund and a
// leaked key in a committed fixture is unrecoverable once pushed.
//
// Everything here runs without a provider key and without spending anything.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	fixtureCarriesEchoedAddress,
	fixtureFileFor,
	hasEchoedAddress,
	MAX_FIXTURE_BYTES,
	partitionByOnly,
	QUOTA_FIXTURE,
	redactEchoedAddresses,
	redactIdentifyingFields,
	reportDiff,
	sanitize,
	sanitizeBody,
	sanitizeHeaders,
	secretsFor,
	shapeOf,
	strayAddresses,
	TARGETS,
} from './record.ts';

// Spawns a subprocess per case, so the unit of work is a process rather than a function call.
// vitest's 5s default was never chosen for that — it is what applies when nobody says
// otherwise, and it leaves a spawn almost no headroom. These have never failed in CI, where the
// runner is unloaded; they fail reliably on a developer machine that is also building something
// else, which is the case that matters, because that is where a false red costs someone an hour
// chasing a regression that is not there. The ceiling measures nothing: a few seconds each when
// the machine is idle.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(args: string[], env: Record<string, string> = {}) {
	try {
		const out = execFileSync(process.execPath, ['scripts/record.ts', ...args], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...process.env, ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

describe('secretsFor', () => {
	// Bright Data's key is `<zone>:<token>`, split by the adapter and sent as two separate
	// fields, so the whole key never reaches the wire and a whole-key needle matches nothing.
	// That is how the zone name reached `slow-target.json` in a public repo.
	const ZONE = 'zone-name-long-enough';
	const TOKEN = 'token-part-long-enough';

	it('returns nothing for a keyless adapter', () => {
		expect(secretsFor('')).toEqual([]);
	});

	it('returns the key alone when it has no separator', () => {
		expect(secretsFor('plain-key-with-no-colon')).toEqual(['plain-key-with-no-colon']);
	});

	it('adds each component of a composite key', () => {
		const out = secretsFor(`${ZONE}:${TOKEN}`);
		expect(out).toContain(`${ZONE}:${TOKEN}`);
		expect(out).toContain(ZONE);
		expect(out).toContain(TOKEN);
	});

	it('orders longest first, so the whole key is replaced before its parts', () => {
		const out = secretsFor(`${ZONE}:${TOKEN}`);
		expect(out[0]).toBe(`${ZONE}:${TOKEN}`);
		expect([...out]).toEqual([...out].sort((a, b) => b.length - a.length));
	});

	it('redacts a composite key that only ever appears split', () => {
		// The exact shape of the leak: the adapter sends `{"zone":"<zone>","..."}` and never
		// the joined key, so sanitising with the key alone leaves the zone in the fixture.
		const body = `{"zone":"${ZONE}","url":"https://httpbin.dev/delay/30"}`;
		expect(sanitize(body, [`${ZONE}:${TOKEN}`])).toContain(ZONE);
		expect(sanitize(body, secretsFor(`${ZONE}:${TOKEN}`))).not.toContain(ZONE);
	});

	it('keeps an empty component out, so an empty needle never reaches sanitize', () => {
		expect(secretsFor(':token-part-long-enough')).not.toContain('');
		expect(secretsFor('zone-name-long-enough:')).not.toContain('');
	});

	it('mirrors the adapter split, not only the naive one', () => {
		// brightdata/index.ts splits at the FIRST colon, so `a:b:c` goes on the wire as zone
		// `a` and token `b:c`. Splitting on every colon alone never lists the token that was
		// actually sent, and would rewrite it as REDACTED:REDACTED if both halves cleared the
		// floor — corrupting a fixture instead of protecting it.
		const out = secretsFor(`${ZONE}:first-half-long:second-half-long`);
		expect(out).toContain('first-half-long:second-half-long');
		expect(out).toContain('first-half-long');
		expect(out).toContain(ZONE);
	});

	it('does not repeat a component', () => {
		expect(secretsFor(`${ZONE}:${TOKEN}`).filter((x) => x === ZONE)).toHaveLength(1);
	});

	it('replaces a key component wherever it appears, which is why a zone must not be a word', () => {
		// The blunt replace has no idea what it is looking at. The floor stops `cat`; nothing
		// stops an eight-character component that happens to be a word in a response body.
		// This is pinned rather than fixed: the mitigation is not naming a zone after
		// something a page would say, and `TARGETS`' POST payload no longer collides with ours.
		const innocent = '{"proxlane":"an ordinary body that happens to say it"}';
		expect(sanitize(innocent, secretsFor('proxlane:a-token-long-enough'))).toBe(
			'{"REDACTED":"an ordinary body that happens to say it"}',
		);
	});

	it('still returns a component below the length floor, for the caller to warn about', () => {
		// sanitize() skips it either way. Dropping it here would hide the fact that a key
		// component is going to survive into the fixture.
		expect(secretsFor(`ab:${TOKEN}`)).toContain('ab');
		expect(sanitize('ab', secretsFor(`ab:${TOKEN}`))).toBe('ab');
	});
});

describe('redactEchoedAddresses', () => {
	// Every shape below was found in a committed fixture by decoding all of them (#364).
	it('redacts httpbin origin, the provider exit address', () => {
		expect(redactEchoedAddresses('{"origin": "203.0.113.7", "url": "x"}')).toBe(
			'{"origin": "REDACTED", "url": "x"}',
		);
	});

	it('redacts every address in a comma-separated forwarding chain, keeping its shape', () => {
		expect(redactEchoedAddresses('{"origin": "203.0.113.7, 198.51.100.2"}')).toBe(
			'{"origin": "REDACTED, REDACTED"}',
		);
	});

	// Each of these was LEFT UNREDACTED by the first version, found by the security review (#369).
	it.each([
		['every element of an array', '{"X-Forwarded-For": [ "203.0.113.7", "198.51.100.2" ]}'],
		['a port', '{"origin": "203.0.113.7:4321"}'],
		['a bracketed IPv6 with a port', '{"X-Forwarded-For": "[2001:db8::1]:443"}'],
		['a v4-mapped IPv6', '{"origin": "::ffff:203.0.113.7"}'],
		['an IPv6 zone', '{"origin": "fe80::1%en0"}'],
		[
			'a chain with a non-address entry',
			'{"X-Forwarded-For": "203.0.113.7, unknown, 198.51.100.2:80"}',
		],
		['a CGI-style key', '{"HTTP_X_FORWARDED_FOR": "203.0.113.7"}'],
		['an underscore key', '{"x_forwarded_for": "203.0.113.7"}'],
		['RFC 7239 Forwarded', '{"Forwarded": "for=203.0.113.7;proto=https;by=198.51.100.2"}'],
		['remote_addr', '{"remote_addr": "203.0.113.7"}'],
		[
			'an escaped, pretty-printed array, as Scrapfly carries httpbin',
			String.raw`{"c":"{\n \"X-Forwarded-For\": [\n      \"203.0.113.7\"\n    ]\n}"}`,
		],
		['a double-escaped value', String.raw`{"c":"{\\\"origin\\\": \\\"203.0.113.7\\\"}"}`],
		['an HTML-escaped value', '<pre>{&quot;origin&quot;: &quot;203.0.113.7&quot;}</pre>'],
	])('redacts %s', (_why, body) => {
		const out = redactEchoedAddresses(body);
		expect(out).not.toMatch(/203\.0\.113\.7|198\.51\.100\.2|2001:db8|fe80/);
		expect(out).toContain('REDACTED');
	});

	it('keeps a non-address entry in a chain', () => {
		expect(redactEchoedAddresses('{"X-Forwarded-For": "203.0.113.7, unknown"}')).toBe(
			'{"X-Forwarded-For": "REDACTED, unknown"}',
		);
	});

	it('redacts an echoed forwarded-for header, in the array form httpbin uses', () => {
		// Bright Data's X-Brd-Api-Forwarded-For is the address of the machine that called its
		// API: the recorder, which can be the maintainer's own connection.
		expect(redactEchoedAddresses('{"X-Brd-Api-Forwarded-For": [ "203.0.113.7" ]}')).toBe(
			'{"X-Brd-Api-Forwarded-For": [ "REDACTED" ]}',
		);
		expect(redactEchoedAddresses('{"X-Real-Ip": "203.0.113.7"}')).toBe(
			'{"X-Real-Ip": "REDACTED"}',
		);
	});

	it('redacts inside an escaped JSON string, which is how Scrapfly carries the page', () => {
		const escaped = String.raw`{"content":"{\n \"origin\": \"203.0.113.7\",\n \"url\": \"x\"}"}`;
		const out = redactEchoedAddresses(escaped);
		expect(out).not.toContain('203.0.113.7');
		expect(out).toContain(String.raw`\"origin\": \"REDACTED\"`);
	});

	it('redacts an IPv6 origin', () => {
		expect(redactEchoedAddresses('{"origin": "2001:db8::1"}')).toBe('{"origin": "REDACTED"}');
	});

	it("leaves Scrapfly's origin enum alone, because it is not an address", () => {
		const envelope = '{"origin":"WEB_SCRAPING_API","os":"win11"}';
		expect(redactEchoedAddresses(envelope)).toBe(envelope);
	});

	it("leaves the target's DNS resolution alone, because it is public and not in the request path", () => {
		const dns = '{"dns":{"resolved":[{"entries":[{"ip":"203.0.113.9","type":"A"}]}]}}';
		expect(redactEchoedAddresses(dns)).toBe(dns);
	});

	it('the gate is structural, so it catches shapes a textual pass would miss', () => {
		// Independent of the redaction: it parses the JSON, including JSON inside strings.
		expect(hasEchoedAddress('{"X-Forwarded-For": ["REDACTED", "198.51.100.2"]}')).toBe(true);
		expect(
			hasEchoedAddress(JSON.stringify({ content: JSON.stringify({ origin: '203.0.113.7' }) })),
		).toBe(true);
		expect(hasEchoedAddress('{"a": {"b": {"remote_addr": "[2001:db8::1]:443"}}}')).toBe(true);
		// Genuine double encoding: a JSON string holding a JSON-encoded string holding JSON.
		const doubled = JSON.stringify({
			c: JSON.stringify(JSON.stringify({ origin: '203.0.113.7' })),
		});
		expect(hasEchoedAddress(doubled)).toBe(true);
		expect(hasEchoedAddress(redactEchoedAddresses(doubled))).toBe(false);
		// ...and leaves the values that are not an echoed address alone.
		expect(
			hasEchoedAddress('{"result":{"dns":{"resolved":[{"entries":[{"ip":"203.0.113.9"}]}]}}}'),
		).toBe(false);
		expect(hasEchoedAddress('<html>not json</html>')).toBe(false);
	});

	it('the recorder checks the body and the fixture separately, and text is checked too', () => {
		const body = '{"origin": "203.0.113.7"}';
		const serialized = JSON.stringify({ kind: 'exchange', response: { status: 200 } });
		expect(fixtureCarriesEchoedAddress(serialized, body)).toBe(true);
		expect(fixtureCarriesEchoedAddress(serialized, '{"origin": "REDACTED"}')).toBe(false);
		// Joined they are not JSON, and a body that is not JSON is now checked as text rather than
		// passed: the first structural gate passed exactly this, and every non-JSON body.
		expect(hasEchoedAddress(`${serialized}\n${body}`)).toBe(true);
	});

	it('the refusal gate sees exactly what the redaction misses', () => {
		expect(hasEchoedAddress('{"origin": "203.0.113.7"}')).toBe(true);
		expect(hasEchoedAddress(redactEchoedAddresses('{"origin": "203.0.113.7"}'))).toBe(false);
		expect(hasEchoedAddress('{"origin":"WEB_SCRAPING_API"}')).toBe(false);
		// Called twice in a row: a global regex keeps lastIndex between calls, and a gate that
		// alternated between true and false on the same input would pass half the time.
		expect(hasEchoedAddress('{"origin": "203.0.113.7"}')).toBe(true);
		expect(hasEchoedAddress('{"origin": "203.0.113.7"}')).toBe(true);
	});

	it('runs as part of sanitizeBody', () => {
		const out = new TextDecoder().decode(
			sanitizeBody(new TextEncoder().encode('{"origin": "203.0.113.7"}'), []),
		);
		expect(out).toBe('{"origin": "REDACTED"}');
	});
});

describe("a provider's handle for our request", () => {
	// Found in review of the Scrapfly quota-exhausted fixture (#370): the envelope's uuid and the
	// reject id survived, while Firecrawl's equivalent scrapeId was already redacted.
	it('redacts the body uuid, in the envelope and in its config', () => {
		// Scrapfly carries two: a top-level `uuid`, the one its schema declares, and `config.uuid`.
		expect(
			redactIdentifyingFields(
				'{"uuid":"01M3AM5JHZFSXH45RJ3MATM4V8","config":{"uuid":"01M3AM5JHZFSXH45RJ3MATM4V9"}}',
			),
		).toBe('{"uuid":"REDACTED","config":{"uuid":"REDACTED"}}');
	});

	it('normalises the reject id header like any request id', () => {
		const out = sanitizeHeaders(
			{ 'x-scrapfly-reject-id': 'f2cb96a0-aaaa-bbbb-cccc-000000000000' },
			[],
		);
		expect(out['x-scrapfly-reject-id']).toBe('VOLATILE');
	});

	it('leaves the reject CODE alone, which is the data', () => {
		const out = sanitizeHeaders(
			{ 'x-scrapfly-reject-code': 'ERR::SCRAPE::QUOTA_LIMIT_REACHED' },
			[],
		);
		expect(out['x-scrapfly-reject-code']).toBe('ERR::SCRAPE::QUOTA_LIMIT_REACHED');
	});
});

describe('redactIdentifyingFields', () => {
	it('redacts a zone too short for the length floor, which sanitize cannot touch', () => {
		const body = '{"zone":"ab","url":"https://httpbin.dev/delay/30"}';
		expect(sanitize(body, secretsFor('ab:a-token-long-enough'))).toContain('"zone":"ab"');
		expect(redactIdentifyingFields(body, ['zone'])).toBe(
			'{"zone":"REDACTED","url":"https://httpbin.dev/delay/30"}',
		);
	});

	it('leaves zone alone by default, because a response may use the word', () => {
		// `zone` is ours in a request we construct and an ordinary word anywhere else. In the
		// default set it would rewrite a recorded response, in files that are `-diff` and so
		// invisible in review.
		const response = '{"zone":"europe-west","status":"ok"}';
		expect(redactIdentifyingFields(response)).toBe(response);
	});

	it('leaves everything else alone', () => {
		const body = '{"url":"https://example.com","format":"raw"}';
		expect(redactIdentifyingFields(body)).toBe(body);
	});
});

describe('sanitize', () => {
	// Deliberately not shaped like any real vendor's key. An earlier version used an
	// `sk_live_…` string, which gitleaks correctly flagged as a Stripe token — the scanner
	// cannot know a secret is fake, and it should not try. Test data that trips the secret
	// scanner either goes red forever or gets an allowlist entry, and an allowlist carved
	// for test data is what later swallows a real leak.
	const KEY = 'proxlane-test-key-not-a-real-secret';

	it('removes the key from a query string, a header value and a body', () => {
		expect(sanitize(`https://api.example/?api_key=${KEY}&url=x`, [KEY])).toBe(
			'https://api.example/?api_key=REDACTED&url=x',
		);
		expect(sanitize(`Bearer ${KEY}`, [KEY])).toBe('Bearer REDACTED');
		expect(sanitize(`{"key":"${KEY}"}`, [KEY])).toBe('{"key":"REDACTED"}');
	});

	it('removes every occurrence, not just the first', () => {
		// Providers echo the key back in error envelopes surprisingly often.
		expect(sanitize(`${KEY} then ${KEY}`, [KEY])).toBe('REDACTED then REDACTED');
	});

	it('does not touch text that merely resembles a key', () => {
		// Shares a long prefix with KEY and differs only at the tail — the case a naive
		// prefix or fuzzy match would corrupt.
		const text = 'proxlane-test-key-not-a-real-value';
		expect(sanitize(text, [KEY])).toBe(text);
	});

	it('ignores secrets too short to replace safely', () => {
		// Replacing a 3-character "secret" would corrupt the fixture everywhere it appears
		// as ordinary text. Better to leave it and let the post-write assertion catch it.
		expect(sanitize('the cat sat', ['cat'])).toBe('the cat sat');
	});

	it('redacts auth-shaped headers whatever their value', () => {
		const out = sanitizeHeaders(
			{
				authorization: 'Bearer something-we-never-saw',
				'X-API-Key': 'another-unknown-secret',
				'set-cookie': 'session=abc',
				'content-type': 'text/html; charset=Shift_JIS',
			},
			[KEY],
		);
		expect(out.authorization).toBe('REDACTED');
		expect(out['X-API-Key']).toBe('REDACTED');
		expect(out['set-cookie']).toBe('REDACTED');
		// Content-Type must survive intact — charset resolution depends on it.
		expect(out['content-type']).toBe('text/html; charset=Shift_JIS');
	});

	it('redacts an unknown value in an underscore-separated key header', () => {
		// ScraperAPI's header is `x-sapi-api_key`. The old `api-?key` pattern could not spell
		// an underscore, so it matched nothing — the real key survived only because its VALUE
		// was known. The name matcher's whole job is the case where it is not.
		const out = sanitizeHeaders({ 'x-sapi-api_key': 'a-value-we-never-saw' }, []);
		expect(out['x-sapi-api_key']).toBe('REDACTED');
	});

	it('redacts by name even with no secrets supplied at all', () => {
		const out = sanitizeHeaders({ api_key: 'x', 'x-client-secret': 'y', bearer: 'z' }, []);
		expect(Object.values(out)).toEqual(['REDACTED', 'REDACTED', 'REDACTED']);
	});

	it('keeps usage counters that only LOOK secret to a substring matcher', () => {
		// `x-usage-tokens` was being redacted because "token" is a substring of it, which
		// threw away the one header that reports what a request cost.
		const out = sanitizeHeaders({ 'x-usage-tokens': '4142', 'x-token-count': '7' }, [KEY]);
		expect(out['x-usage-tokens']).toBe('VOLATILE');
		expect(out['x-token-count']).toBe('7');
	});

	it('redacts before marking volatile, so a header that is both is not merely marked', () => {
		// Ordering matters: `set-cookie` is volatile AND secret. Marking it volatile first
		// would be a leak wearing a placeholder.
		const out = sanitizeHeaders({ 'set-cookie': `s=${KEY}` }, [KEY]);
		expect(out['set-cookie']).toBe('REDACTED');
	});

	it('flattens headers that change every request, so a re-record diff means something', () => {
		// integrations.md section 6 claims "diffs in recorded responses show provider changes
		// in code review". With cf-ray and date live, the diff is never empty and nobody
		// reads it, which makes the claim false rather than merely noisy.
		const out = sanitizeHeaders(
			{ 'cf-ray': 'a277a708cc69c07d-EWR', date: 'Thu, 07 Aug 2026 16:28:06 GMT' },
			[KEY],
		);
		expect(out['cf-ray']).toBe('VOLATILE');
		expect(out.date).toBe('VOLATILE');
	});

	it('keeps the stable half of a rate-limit pair', () => {
		const out = sanitizeHeaders(
			{ 'x-ratelimit-limit': '20, 20;w=60', 'x-ratelimit-remaining': '19' },
			[KEY],
		);
		expect(out['x-ratelimit-limit']).toBe('20, 20;w=60');
		expect(out['x-ratelimit-remaining']).toBe('VOLATILE');
	});
});

describe('a shape is what the provider decides, not what a request happened to get', () => {
	// 2026-09-16: once record-diff stopped swallowing its exit code, it opened a drift issue on
	// every adapter for fields that change per request. Each case below is a pair from those two
	// runs that was reported as drift and was not.
	const fixture = (headers: Record<string, string>, body: unknown) => ({
		response: {
			status: 200,
			headers,
			bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64'),
		},
	});
	const same = (a: ReturnType<typeof fixture>, b: ReturnType<typeof fixture>) =>
		expect(shapeOf(a)).toEqual(shapeOf(b));

	it('ignores headers that come and go per request', () => {
		same(
			fixture({ 'content-length': '10', 'sa-proxy-hash': 'x', 'sa-statuscode': '200' }, {}),
			fixture(
				{ 'transfer-encoding': 'chunked', connection: 'keep-alive', 'sa-statuscode': '200' },
				{},
			),
		);
	});

	it("ignores which request headers httpbin echoed, since the provider's exit chose them", () => {
		same(
			fixture({}, { headers: { 'Sec-Ch-Ua': ['x'], Dnt: ['1'] }, json: { a: 1 } }),
			fixture({}, { headers: { Accept: ['*/*'], Priority: ['u=1'] }, json: { a: 1 } }),
		);
	});

	it("ignores keys inside Scrapfly's config echo and the target's storage", () => {
		same(
			fixture(
				{},
				{ config: { url: 'u' }, result: { browser_data: { session_storage_data: {} } } },
			),
			fixture(
				{},
				{
					config: { url: 'u', unblocker: false },
					result: { browser_data: { session_storage_data: { 'https://a': { k: 'v' } } } },
				},
			),
		);
	});

	it('still reports the map disappearing, which is a real change', () => {
		const before = shapeOf(fixture({}, { result: { response_headers: { a: 'b' } } }));
		const after = shapeOf(fixture({}, { result: {} }));
		expect(before).toContain('body.result.response_headers:object');
		expect(after).not.toContain('body.result.response_headers:object');
	});

	it('still reports a provider header disappearing, which is what breaks parse()', () => {
		expect(shapeOf(fixture({ 'sa-statuscode': '200' }, {}))).toContain('header:sa-statuscode');
		expect(shapeOf(fixture({}, {}))).not.toContain('header:sa-statuscode');
	});

	it('still reports an envelope field changing type', () => {
		const a = shapeOf(fixture({}, { result: { status_code: 200 } }));
		const b = shapeOf(fixture({}, { result: { status_code: '200' } }));
		expect(a).not.toEqual(b);
	});
});

describe('the fixture byte format', () => {
	it('round-trips bytes that are not valid UTF-8', () => {
		// A Shift_JIS page is the motivating case: decode it to a string on the way into a
		// fixture and the mojibake is baked in permanently, and /detect then fingerprints
		// the corruption rather than the page.
		const shiftJis = new Uint8Array([
			0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x3c, 0x2f, 0x62, 0x3e,
		]);
		const b64 = Buffer.from(shiftJis).toString('base64');
		const back = new Uint8Array(Buffer.from(b64, 'base64'));
		expect(back).toEqual(shiftJis);

		// The lossy path, for contrast: this is what storing a string would do.
		const lossy = new Uint8Array(Buffer.from(new TextDecoder().decode(shiftJis), 'utf8'));
		expect(lossy).not.toEqual(shiftJis);
	});
});

describe('the fixture ceiling', () => {
	// The streaming read itself now lives in `@proxlane/shared/transport` and is covered by
	// `transport.e2e.test.ts` — including the POST body this file's caller used to drop. What
	// stays here is the one thing that is the recorder's own: how big a committed fixture may be.
	it('has a cap well under the 10 MB response limit in operations.md section 1', () => {
		// A fixture is read into memory by every contract test and lives in git forever, so
		// its ceiling is its own concern and lower than a live response's.
		expect(MAX_FIXTURE_BYTES).toBeLessThan(10 * 1024 * 1024);
		expect(MAX_FIXTURE_BYTES).toBeGreaterThan(64 * 1024);
	});
});

describe('the target matrix', () => {
	it('covers every category exactly once', () => {
		const cats = TARGETS.map((t) => t.category);
		expect(new Set(cats).size).toBe(cats.length);
		expect(cats.length).toBeGreaterThan(0);
	});

	it('states an expected outcome and a reason for every target', () => {
		for (const t of TARGETS) {
			expect(t.expect, `${t.category} has no expected outcome`).toBeTruthy();
			expect(t.why, `${t.category} has no stated reason`).toBeTruthy();
			expect(t.url).toMatch(/^https:\/\//);
		}
	});

	it('does not pretend to produce block or captcha fixtures', () => {
		// They cannot be summoned from httpbin on demand. A target claiming to would
		// produce a fixture that is really a 200, mislabelled — worse than having none.
		const cats = TARGETS.map((t) => t.category).join(',');
		expect(cats).not.toContain('block');
		expect(cats).not.toContain('captcha');
	});

	it('exercises renderJs, or the capability is never checked', () => {
		expect(TARGETS.some((t) => t.renderJs)).toBe(true);
	});
});

// A committed fixture reduced to what reportDiff reads.
const fixture = (category: string) =>
	JSON.stringify({
		category,
		recordedAt: new Date().toISOString(),
		adapter: 'x',
		expect: 'OK',
		kind: 'exchange',
		response: { status: 200, headers: {}, bodyBase64: '', bodyBytes: 0 },
	});

// Captures what reportDiff prints, so a test can assert what a human is told.
const quiet = () => {
	const out: string[] = [];
	const so = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
		out.push(String(s));
		return true;
	});
	const se = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
		out.push(String(s));
		return true;
	});
	return {
		text: () => out.join(''),
		restore: () => {
			so.mockRestore();
			se.mockRestore();
		},
	};
};

describe('--only is a scope, not a disappearance', () => {
	// EVERY SCHEDULED record:diff WAS RED, from the second pass — the one that exists to check
	// `deadline`, which the first pass cannot record. `--only=deadline` filtered the other
	// categories out before the loop, so they never reached `skipped`, and reportDiff read each
	// as "committed, but this run recorded nothing for it". Eleven fabricated drifts per
	// adapter per week, and that step opens no issue, so it stayed red where nobody looks.

	it('names what it left out, so the diff can tell scope from loss', () => {
		const { selected, deferred } = partitionByOnly(TARGETS, 'deadline');
		expect(selected.map((t) => t.category)).toEqual(['deadline']);
		expect(deferred).not.toContain('deadline');
		expect(deferred.length).toBe(TARGETS.length - 1);
	});

	it('defers nothing on a full run', () => {
		const { selected, deferred } = partitionByOnly(TARGETS, undefined);
		expect(selected).toBe(TARGETS);
		expect(deferred).toEqual([]);
	});

	it('selects nothing for an unknown category, so the CLI can refuse it', () => {
		expect(partitionByOnly(TARGETS, 'no-such-category').selected).toEqual([]);
	});

	// A corpus with three committed fixtures and a fresh run that recorded only `deadline`.
	// With `deferred` the other two are NOT CHECKED and the run passes on the one comparison
	// it made; without it, the same directories are read as two fixtures that stopped
	// recording — the exact output of the 2026-09-09 scheduled run.
	const corpus = () => {
		const root = mkdtempSync(join(tmpdir(), 'record-only-'));
		const committed = join(root, 'committed');
		const fresh = join(root, 'fresh');
		mkdirSync(committed);
		mkdirSync(fresh);
		for (const c of ['success-html', 'target-error', 'deadline']) {
			writeFileSync(join(committed, `${c}.json`), fixture(c));
		}
		writeFileSync(join(fresh, 'deadline.json'), fixture('deadline'));
		return { committed, fresh };
	};

	it('passes a scoped pass on the one fixture it compared, and says what it did not', () => {
		const { committed, fresh } = corpus();
		const q = quiet();
		try {
			const code = reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: [],
				exhausted: [],
				deferred: ['success-html', 'target-error'],
			});
			expect(code).toBe(0);
			expect(q.text()).toMatch(/1 fixture\(s\) unchanged/);
			expect(q.text()).toMatch(/NOT CHECKED: .*success-html \(outside --only\)/);
			expect(q.text()).not.toMatch(/recorded nothing for it/);
		} finally {
			q.restore();
		}
	});

	it('still reads a genuinely missing recording as drift when nothing was deferred', () => {
		// The guard this fix must not weaken: a category that stopped recording, on a full
		// run, is the fixture most likely to have drifted.
		const { committed, fresh } = corpus();
		const q = quiet();
		try {
			const code = reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: [],
				exhausted: [],
			});
			expect(code).toBe(1);
			expect(q.text()).toMatch(/success-html\.json: committed, but this run recorded nothing/);
		} finally {
			q.restore();
		}
	});
});

describe('the CLI refuses to spend credits by accident', () => {
	it('requires --adapter', () => {
		const { code, out } = run([]);
		expect(code).not.toBe(0);
		expect(out).toContain('Credits do not refund');
	});

	it('rejects an unknown category before touching the network', () => {
		const { code, out } = run(['--adapter=x', '--only=not-a-category']);
		expect(code).not.toBe(0);
		expect(out).toContain('no target category');
	});

	it('fails on an unregistered adapter rather than guessing', () => {
		const { code, out } = run(['--adapter=nope']);
		expect(code).not.toBe(0);
		expect(out).toContain('is not in the registry');
	});
});

describe('a spent plan does not overwrite the fixture it interrupted', () => {
	// `pnpm record` wrote each recording BEFORE running parse() over it, so a run on an empty
	// wallet replaced `success-html.json` with a quota refusal and then printed "These fixtures
	// were NOT refreshed". The file a recording lands in is now decided by its outcome.

	it('keeps an expected outcome in its own category', () => {
		expect(fixtureFileFor('success-html', 'OK', 'OK', false)).toBe('success-html');
		expect(fixtureFileFor('slow-target', 'provider-dependent', 'PROVIDER_ERROR', false)).toBe(
			'slow-target',
		);
	});

	it('moves a spent plan to its own file, and writes nothing for it in a diff run', () => {
		expect(fixtureFileFor('success-html', 'OK', 'QUOTA_EXHAUSTED', false)).toBe(QUOTA_FIXTURE);
		expect(fixtureFileFor('success-html', 'OK', 'QUOTA_EXHAUSTED', true)).toBeUndefined();
	});

	it('writes nothing for a concurrency cap', () => {
		expect(fixtureFileFor('success-html', 'OK', 'RATE_LIMITED', false)).toBeUndefined();
	});

	it('still writes real drift, and a parse() that does not exist yet, to the category', () => {
		// The guard this must not weaken: a provider that changed what it returns is exactly what
		// the fixture and the diff exist to show.
		expect(fixtureFileFor('target-error', 'TARGET_ERROR', 'PROVIDER_ERROR', false)).toBe(
			'target-error',
		);
		expect(fixtureFileFor('success-html', 'OK', undefined, false)).toBe('success-html');
	});

	it('does not read a committed refusal as drift on a funded run', () => {
		// Committed `quota-exhausted.json`, fresh run with credit: nothing records it, and the
		// union walk would otherwise report "committed, but this run recorded nothing" weekly.
		const root = mkdtempSync(join(tmpdir(), 'record-quota-'));
		const committed = join(root, 'committed');
		const fresh = join(root, 'fresh');
		mkdirSync(committed);
		mkdirSync(fresh);
		writeFileSync(join(committed, 'success-html.json'), fixture('success-html'));
		writeFileSync(join(committed, `${QUOTA_FIXTURE}.json`), fixture(QUOTA_FIXTURE));
		writeFileSync(join(fresh, 'success-html.json'), fixture('success-html'));
		const q = quiet();
		try {
			const code = reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: [],
				exhausted: [],
			});
			expect(code).toBe(0);
			expect(q.text()).toMatch(
				/NOT CHECKED: quota-exhausted \(captured only from a spent plan\)/,
			);
			expect(q.text()).not.toMatch(/recorded nothing for it/);
		} finally {
			q.restore();
		}
	});
});

describe('echoed addresses: what the second security review found (#369)', () => {
	// Each case below was missed by redaction, the gate, or both, in the version first merged.
	it.each([
		[
			'an RFC 7239 value with escaped inner quotes',
			String.raw`{"Forwarded": "for=\"[2001:db8::1]:443\""}`,
		],
		[
			'a bracketed IPv6 before another array element',
			'{"X-Forwarded-For": ["[2001:db8::1]:443", "198.51.100.2"]}',
		],
		['a prefixed Forwarded', '{"HTTP_FORWARDED": "for=203.0.113.7"}'],
		['a prefixed Via, as ScrapingBee relays it', '{"spb-via": "1.1 203.0.113.7"}'],
		['x-remote-addr', '{"x-remote-addr": "203.0.113.7"}'],
		['x-originating-ip', '{"x-originating-ip": "203.0.113.7"}'],
		['remote_ip', '{"remote_ip": "203.0.113.7"}'],
		['an object under an echo key', '{"origin": {"ip": "203.0.113.7"}}'],
	])('redacts %s, and the gate agrees', (_why, body) => {
		const out = redactEchoedAddresses(body);
		expect(out).not.toMatch(/203\.0\.113\.7|198\.51\.100\.2|2001:db8/);
		expect(hasEchoedAddress(body)).toBe(true);
		expect(hasEchoedAddress(out)).toBe(false);
	});

	it('refuses an address in a body that is not JSON at all', () => {
		// The first structural gate returned false for anything that did not start like JSON.
		expect(strayAddresses('<pre>origin: 203.0.113.7</pre>')).toHaveLength(1);
		expect(strayAddresses('callback({"origin":"203.0.113.7"})')).toHaveLength(1);
		expect(strayAddresses(')]}\',\n{"origin":"203.0.113.7"}')).toHaveLength(1);
	});

	it('refuses an address anywhere, not only under a key it recognises', () => {
		expect(strayAddresses('{"some_new_header": ["203.0.113.7"]}')).toHaveLength(1);
		expect(strayAddresses('["203.0.113.7"]')).toHaveLength(1);
	});

	it('passes what fixtures legitimately carry', () => {
		// Established by running the gate over every committed fixture.
		expect(
			strayAddresses('{"result":{"dns":{"resolved":[{"entries":[{"ip":"203.0.113.9"}]}]}}}'),
		).toEqual([]);
		expect(
			strayAddresses('{"User-Agent": ["Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36"]}'),
		).toEqual([]);
		expect(strayAddresses('{"created_at": "2026-09-24 21:11:59"}')).toEqual([]);
		expect(strayAddresses('{"origin": "WEB_SCRAPING_API"}')).toEqual([]);
		expect(strayAddresses('<html>no addresses</html>')).toEqual([]);
	});

	const utf16 = [...'origin 203.0.113.7'].join('\u0000');
	it.each([
		['a trailing period', 'Your IP address is 203.0.113.7.'],
		['an IPv6 with a trailing period', 'Your IP address is 2001:db8::1.'],
		['a colon before it', 'remote_addr:203.0.113.7'],
		['a gRPC peer', 'peer ipv4:203.0.113.7:443'],
		['a full mapped IPv6', '0:0:0:0:0:ffff:203.0.113.7'],
		['an escaped newline before it, in text', String.raw`<pre>seen\n203.0.113.7</pre>`],
		['an object key', '{"203.0.113.7": {"hits": 1}}'],
		['an object key inside a JSON string', JSON.stringify({ c: '{"203.0.113.7":1}' })],
		['the losing half of a duplicate key', '{"note":"203.0.113.7","note":"x"}'],
		["a target's own dns.ip", '{"dns":{"ip":"203.0.113.7"}}'],
		[
			"Scrapfly's DNS shape, but inside the target's page",
			JSON.stringify({
				result: {
					content: JSON.stringify({
						dns: { resolved: [{ entries: [{ ip: '203.0.113.7' }] }] },
					}),
				},
			}),
		],
		['percent-encoded IPv4', 'ip=203%2E0%2E113%2E7'],
		['percent-encoded IPv6', 'ip=2001%3Adb8%3A%3A1'],
		['doubly percent-encoded', 'ip=203%252E0%252E113%252E7'],
		['decimal entities', '<b>203&#46;0&#46;113&#46;7</b>'],
		['hex entities', '<b>203&#x2e;0&#x2E;113&#46;7</b>'],
		['named entities', '<b>2001&colon;db8&colon;&colon;1</b>'],
		['a JSON unicode escape', String.raw`{"a":"203\u002e0\u002e113\u002e7"}`],
		['UTF-16 text', utf16],
	])('the gate refuses %s', (_why, text) => {
		expect(strayAddresses(text).length).toBeGreaterThan(0);
	});

	it.each([
		['a version with a fifth part', 'lib 1.2.3.4.5'],
		['an octet above 255', 'build 999.1.1.1'],
		["a script's slice", 'a[::2]'],
		['loopback, one hex group', 'bind ::1'],
		['a CSS pseudo-element', 'a::before { content: "" }'],
	])('the gate passes %s', (_why, text) => {
		expect(strayAddresses(text)).toEqual([]);
	});

	it('keeps redacting past a null, where pass two cannot help', () => {
		// HTML-escaped JSON does not parse, so only pass one sees it. It used to stop at `null`.
		const body =
			'<pre>{&quot;via&quot;: null, &quot;origin&quot;: &quot;203.0.113.7&quot;}</pre>';
		expect(redactEchoedAddresses(body)).toBe(
			'<pre>{&quot;via&quot;: null, &quot;origin&quot;: &quot;REDACTED&quot;}</pre>',
		);
	});

	it('redacts every copy of an echoed address, whatever its case or spelling', () => {
		// Pass one erases the echo value first; the copies are found from the original text.
		const body =
			'{"origin":"2001:DB8::1, 203.0.113.7","seen":"2001:db8::1","peer":"::ffff:203.0.113.7"}';
		const out = redactEchoedAddresses(body);
		expect(out).toBe(
			'{"origin":"REDACTED, REDACTED","seen":"REDACTED","peer":"::ffff:REDACTED"}',
		);
		expect(strayAddresses(out)).toEqual([]);
	});

	it('does not rewrite an address that merely contains the literal', () => {
		const body = '{"origin":"1.2.3.4","a":"11.2.3.45","b":"1.2.3.4.5","c":"v1.2.3.4"}';
		expect(redactEchoedAddresses(body)).toBe(
			'{"origin":"REDACTED","a":"11.2.3.45","b":"1.2.3.4.5","c":"v1.2.3.4"}',
		);
	});

	it('survives nesting deep enough to overflow a recursive walk', () => {
		const deep = `${'['.repeat(20000)}"203.0.113.7"${']'.repeat(20000)}`;
		expect(() => redactEchoedAddresses(deep)).not.toThrow();
		expect(strayAddresses(deep)).toHaveLength(1);
	});

	it('survives nesting under an echo key too', () => {
		const deep = `{"origin":${'['.repeat(100000)}"203.0.113.7"${']'.repeat(100000)}}`;
		expect(() => redactEchoedAddresses(deep)).not.toThrow();
		expect(strayAddresses(deep).length).toBeGreaterThan(0);
	});

	it('undoes escapes in linear time, however long the backslash run', () => {
		const run = `a${'\\'.repeat(200000)}x 203.0.113.7`;
		const t0 = performance.now();
		expect(strayAddresses(run)).toHaveLength(1);
		expect(performance.now() - t0).toBeLessThan(250);
	});

	it('redacts an address a word runs into, keeping the bracket', () => {
		const out = redactEchoedAddresses('{"origin":"2001:db8::1","x":"a[2001:db8::1]"}');
		expect(out).toBe('{"origin":"REDACTED","x":"a[REDACTED]"}');
		expect(strayAddresses(out)).toEqual([]);
	});

	it('redacts a forwarding header in the RESPONSE, which used to be gated but kept', () => {
		const out = sanitizeHeaders(
			{ 'x-forwarded-for': '203.0.113.7, 198.51.100.2', via: '1.1 vegur' },
			[],
		);
		expect(out['x-forwarded-for']).toBe('REDACTED, REDACTED');
		expect(out.via).toBe('1.1 vegur');
	});

	it('does not re-scan the body for every key after an unterminated value', () => {
		// A malformed tail used to cost O(keys x length). It stops at the first value with no end.
		const body = `{"a":"x"${',"via":['.repeat(20000)}`;
		const t0 = performance.now();
		redactEchoedAddresses(body);
		expect(performance.now() - t0).toBeLessThan(250);
	});
});

describe('committed fixtures carry no echoed address (#364)', () => {
	// Run over every fixture in the repository, not a sample. KNOWN is the list of fixtures that
	// still carry one only because their account is out of credit and a fixture is re-recorded,
	// never edited. It can only shrink: an entry that no longer carries one fails too, so the
	// re-recording that fixes it also has to remove it from here.
	const KNOWN = ['scraperapi/post.json', 'scrapfly/post.json'];

	// Every fixture, at any depth (the `_dev` adapters' too), and every part of it: the body, the
	// request body and the headers. The first sweep read one directory level and bodies only.
	const root = fileURLToPath(new URL('../packages/adapters/src/', import.meta.url));
	const files: string[] = [];
	const collect = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) collect(p);
			else if (p.includes(`${sep}fixtures${sep}`) && p.endsWith('.json')) files.push(p);
		}
	};
	collect(root);
	const carriers: string[] = [];
	for (const file of files) {
		const raw = readFileSync(file, 'utf8');
		const b64 = JSON.parse(raw)?.response?.bodyBase64;
		const body = typeof b64 === 'string' ? Buffer.from(b64, 'base64').toString('utf8') : '';
		if (fixtureCarriesEchoedAddress(raw, body))
			carriers.push(relative(root, file).split(sep).join('/').replace('/fixtures/', '/'));
	}

	it('sweeps the fixtures it claims to', () => {
		expect(files.length).toBeGreaterThan(50);
		expect(files.some((f) => f.includes(`${sep}_dev${sep}`))).toBe(true);
	});

	it('none beyond the known list', () => {
		expect(carriers.filter((c) => !KNOWN.includes(c))).toEqual([]);
	});

	it('the known list names only fixtures that still need re-recording', () => {
		expect(
			KNOWN.filter((k) => !carriers.includes(k)),
			'remove these from KNOWN',
		).toEqual([]);
	});
});
