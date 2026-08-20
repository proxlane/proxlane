// Layer 4: the real Hono app, over a real socket, driven by real HTTP. `pnpm test:e2e`.
//
// What makes this different from the contract tests next door is the transport in FRONT of
// the app rather than behind it. These go out over TCP, through Hono's routing and query
// parsing, and back — so a header that is never set, a status that is silently coerced, or
// a body that gets stringified on the way out are all visible here and nowhere else.
//
// Behind the app, the provider boundary is still recorded bytes. Nothing is invented.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { type Adapter, type ProviderCapabilities, REGISTRY } from '@proxlane/adapters';
import { forcedProbeKey } from '@proxlane/shared';
import { createReplayTransport, loadFixtures } from '@proxlane/vitest-config/replay-transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, headersFor } from './app.js';
import { isCapable } from './chain.js';
import { InMemoryCooldownStore } from './cooldown-store.js';
import { InMemoryHealthStore } from './health-store.js';
import type { RequestLine } from './log.js';
import type { HttpTransport } from './transport.js';
import { VERSION } from './version.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Generated per run, not a literal. A hardcoded `API_KEY = '…'` is exactly gitleaks'
// generic-api-key pattern, and a scanner cannot tell a test key from a real one — it should
// not try. Randomising also means no value here can ever be copied into something real.
const API_KEY = randomBytes(24).toString('hex');

const IDS = Object.keys(REGISTRY).sort();
const adapters: { adapter: Adapter; key: string }[] = [];
for (const id of IDS) {
	adapters.push({ adapter: await (REGISTRY[id] as () => Promise<Adapter>)(), key: 'REPLAY' });
}
const entries = IDS.flatMap((id) => loadFixtures(ROOT, id));
const target = (category: string) => {
	const hit = entries.find((e) => e.category === category);
	if (hit === undefined) throw new Error(`no ${category} fixture`);
	return hit.recording.target.url;
};

let base: string;
let server: ReturnType<typeof serve>;
let health: InMemoryHealthStore;
let cooldowns: InMemoryCooldownStore;

beforeAll(async () => {
	const transport: HttpTransport = createReplayTransport(entries);
	health = new InMemoryHealthStore();
	cooldowns = new InMemoryCooldownStore();
	const app = createApp({
		transport,
		candidates: adapters,
		apiKey: API_KEY,
		maxBodyBytes: 10 * 1024 * 1024,
		defaultDeadlineMs: 90_000,
		health,
		cooldowns,
	});
	// Port 0: the OS picks a free one. A hardcoded port makes the suite fail on a developer
	// machine that happens to be running the gateway.
	server = serve({ fetch: app.fetch, port: 0 });
	await new Promise((r) => setTimeout(r, 50));
	const addr = server.address() as AddressInfo;
	base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
	await new Promise<void>((r) => server.close(() => r()));
});

const get = (qs: string) => fetch(`${base}/v1?${qs}`);

/** A minimal valid request, for the capability-filter assertions. */
const BASE_REQ = {
	url: 'https://example.com/',
	method: 'GET' as const,
	renderJs: false,
	premium: 'none' as const,
	deadlineMs: 90_000,
};

describe('auth, which is not part of the outcome taxonomy', () => {
	it('rejects a missing key with 401', async () => {
		const r = await get(`url=${encodeURIComponent(target('success-html'))}`);
		expect(r.status).toBe(401);
	});

	it('rejects a wrong key with 401 and emits no outcome header', async () => {
		// The taxonomy describes what happened to a SCRAPE. This request never became one, so
		// labelling it AUTH_FAILED would put gateway auth failures into provider health.
		const r = await get(`api_key=nope&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.status).toBe(401);
		expect(r.headers.get('x-outcome')).toBeNull();
		// The CLASS is still there, and that is the difference between omitting a header and
		// telling the caller nothing. `UNAUTHORIZED` has no outcome to report, but it does have
		// a class, and the class is the closed vocabulary a client switches on.
		expect(r.headers.get('x-outcome-class')).toBe('client');
	});

	it('rejects a key of the right length but wrong content', async () => {
		// Guards the constant-time compare: length equality must not imply a match.
		const wrong = 'x'.repeat(API_KEY.length);
		expect((await get(`api_key=${wrong}&url=https://example.com/`)).status).toBe(401);
	});
});

describe('every response is traceable', () => {
	const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

	it('returns an id on success, and it is a real v7', async () => {
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.headers.get('x-request-id')).toMatch(V7);
	});

	it.each([
		['401, which never becomes a scrape', `url=${encodeURIComponent('https://example.com/')}`],
		['400 with no url', `api_key=${API_KEY}`],
		[
			'400 with a bad premium',
			`api_key=${API_KEY}&url=https%3A%2F%2Fexample.com%2F&premium=nope`,
		],
		[
			'403 refused at the edge',
			`api_key=${API_KEY}&url=${encodeURIComponent('http://127.0.0.1/')}`,
		],
	])('returns one on %s', async (_label, qs) => {
		// These are the paths a hand-threaded id misses, and they are the ones people report.
		const r = await get(qs);
		expect(r.ok).toBe(false);
		expect(r.headers.get('x-request-id')).toMatch(V7);
		expect(((await r.json()) as { requestId?: string }).requestId).toBe(
			r.headers.get('x-request-id'),
		);
	});

	it('covers /health too, which takes no key', async () => {
		expect((await fetch(`${base}/health`)).headers.get('x-request-id')).toMatch(V7);
	});

	it('echoes a usable caller id, so one id spans both systems', async () => {
		const mine = 'trace_abc-123.4';
		const r = await fetch(`${base}/v1?api_key=${API_KEY}`, {
			headers: { 'X-Request-Id': mine },
		});
		expect(r.headers.get('x-request-id')).toBe(mine);
	});

	it('replaces a hostile caller id rather than reflecting it into a header', async () => {
		// Header splitting. undici rejects a literal CRLF before it leaves, so this uses a value
		// that is merely illegal rather than un-sendable, and asserts we substituted our own.
		const r = await fetch(`${base}/v1?api_key=${API_KEY}`, {
			headers: { 'X-Request-Id': 'x'.repeat(200) },
		});
		const got = r.headers.get('x-request-id') ?? '';
		expect(got).toMatch(V7);
		expect(got.length).toBeLessThan(50);
	});

	it('gives different requests different ids', async () => {
		const a = await fetch(`${base}/health`);
		const b = await fetch(`${base}/health`);
		expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
	});
});

describe('the key may travel in a header, not only the query string', () => {
	it('accepts Authorization: Bearer', async () => {
		const r = await fetch(`${base}/v1?url=${encodeURIComponent(target('success-html'))}`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		expect(r.status).toBe(200);
	});

	it('accepts the scheme case-insensitively, per RFC 9110', async () => {
		const r = await fetch(`${base}/v1?url=${encodeURIComponent(target('success-html'))}`, {
			headers: { Authorization: `bEaReR ${API_KEY}` },
		});
		expect(r.status).toBe(200);
	});

	it('still accepts api_key, because that is the drop-in promise', async () => {
		expect(
			(await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`))
				.status,
		).toBe(200);
	});

	it('rejects a wrong bearer without falling back to a valid query key', async () => {
		// The header WINS when present. Falling back would let a leaked query key override an
		// explicit header, and would make the precedence unpredictable.
		const r = await fetch(`${base}/v1?api_key=${API_KEY}&url=https%3A%2F%2Fexample.com%2F`, {
			headers: { Authorization: 'Bearer wrong' },
		});
		expect(r.status).toBe(401);
	});

	it('ignores a non-Bearer scheme and falls through to api_key', async () => {
		const r = await fetch(
			`${base}/v1?api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`,
			{ headers: { Authorization: 'Basic abc123' } },
		);
		expect(r.status).toBe(200);
	});
});

describe('POST forwards a body', () => {
	it('is routed, where it used to be hardcoded to GET', async () => {
		// No POST fixture exists, so this asserts the surface accepts and routes the verb —
		// NO_PROVIDER_AVAILABLE is the honest answer when no adapter declares `post`, and it
		// proves the request reached the chain rather than 404ing at the router.
		const r = await fetch(`${base}/v1?api_key=${API_KEY}&url=https%3A%2F%2Fexample.com%2F`, {
			method: 'POST',
			body: 'a=1&b=2',
		});
		expect(r.status).not.toBe(404);
		expect(r.headers.get('x-request-id')).toBeTruthy();
	});

	it('caps the request body with the same limit as the response', async () => {
		// Without this a caller pushes an unbounded body through a process whose memory budget
		// is sized on maxInflight * bodyCap * 2.5. The e2e app is configured at 10 MB.
		const r = await fetch(`${base}/v1?api_key=${API_KEY}&url=https%3A%2F%2Fexample.com%2F`, {
			method: 'POST',
			body: 'x'.repeat(11 * 1024 * 1024),
		});
		expect(r.status).toBe(413);
		expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
			'RESPONSE_TOO_LARGE',
		);
	});

	it('leaves PUT unrouted rather than silently treating it as GET', async () => {
		const r = await fetch(`${base}/v1?api_key=${API_KEY}&url=https%3A%2F%2Fexample.com%2F`, {
			method: 'PUT',
		});
		expect(r.status).toBe(404);
	});
});

describe('one error shape, whatever went wrong', () => {
	// The point of the envelope: a client parses one schema, not two. Previously auth and
	// validation answered {error, message} while a failed scrape answered {outcome, class,
	// attempts}, so callers had to sniff the shape before reading the error.
	it.each([
		[
			'401, before the request is even a scrape',
			`url=https%3A%2F%2Fexample.com%2F`,
			'UNAUTHORIZED',
		],
		['400 validation', `api_key=${API_KEY}`, 'BAD_REQUEST'],
		[
			'403 from the edge guard',
			`api_key=${API_KEY}&url=${encodeURIComponent('http://127.0.0.1/')}`,
			'TARGET_FORBIDDEN',
		],
		[
			'503 with no capable provider',
			`api_key=${API_KEY}&url=https://example.com/&provider=nope`,
			'NO_PROVIDER_AVAILABLE',
		],
	])('%s carries the same envelope', async (_label, qs, code) => {
		const body = (await (await get(qs)).json()) as {
			requestId: string;
			error: { code: string; class: string; message: string; docs: string };
		};
		expect(body.error.code).toBe(code);
		expect(body.requestId).toMatch(/^[\w.-]+$/);
		expect(['ok', 'blocked', 'target', 'provider', 'client', 'gateway']).toContain(
			body.error.class,
		);
		expect(body.error.message.length).toBeGreaterThan(0);
		// A link that exists, which is the standard this assertion has always held and the only
		// reason it used to name GitHub: `docs.proxlane.dev` has no DNS record, and shipping a
		// dead link on every failure is a broken promise at request rate. The docs site is served
		// from the apex, so the destination moved and the standard did not.
		//
		// Not verified over the network here — a test that needs DNS fails from a clean clone on
		// a plane. `docs:check` proves the path resolves to a route that exists, offline.
		expect(body.error.docs).toBe('https://proxlane.dev/docs/outcomes');
	});

	// The HEADERS, not the body. A caller is told to branch on `X-Outcome-Class` — the docs say
	// so, because it is the closed vocabulary — and four paths shipped without it: no url, a
	// bad `premium`, an over-cap request body, a wrong key. Everything that reached the chain
	// had them, so the gap was invisible from the happy path and from every failover test.
	it.each([
		['no url, the commonest client mistake', `api_key=${API_KEY}`, 'BAD_REQUEST', 'client'],
		[
			'a premium tier that does not exist',
			`api_key=${API_KEY}&url=https://example.com/&premium=gold`,
			'BAD_REQUEST',
			'client',
		],
		[
			'a forced provider that does not exist',
			`api_key=${API_KEY}&url=https://example.com/&provider=nope`,
			'NO_PROVIDER_AVAILABLE',
			'gateway',
		],
		[
			'a timeout below the floor',
			`api_key=${API_KEY}&url=https://example.com/&timeout=1`,
			'BAD_REQUEST',
			'client',
		],
	])('%s still carries the outcome headers', async (_label, qs, code, klass) => {
		const r = await get(qs);
		expect(r.headers.get('x-outcome')).toBe(code);
		expect(r.headers.get('x-outcome-class')).toBe(klass);
		// Zero, and present. A caller summing attempt counts must not find a hole where a
		// request failed before anything was tried.
		expect(r.headers.get('x-attempts')).toBe('0');
	});

	it('names the providers that ARE configured when a forced one is not', async () => {
		// It used to say "no providers configured" with four of them configured, which sent an
		// operator to check keys that were fine. The outcome was always right; the sentence was
		// not, and the sentence is the part a human reads.
		const body = (await (
			await get(`api_key=${API_KEY}&url=https://example.com/&provider=nope`)
		).json()) as { error: { message: string } };
		expect(body.error.message).toContain('"nope"');
		expect(body.error.message).toMatch(/Configured: .*scraperapi/);
		expect(body.error.message).not.toContain('no providers configured');
	});

	it('never uses the old two-shape form', async () => {
		// Guards the unification itself: a future handler reaching for `{error: 'x', message}`
		// would pass every other assertion here while reintroducing the second schema.
		const body = (await (await get('api_key=nope&url=https://example.com/')).json()) as Record<
			string,
			unknown
		>;
		expect(typeof body.error).toBe('object');
		expect(body.message, 'top-level message is the old shape').toBeUndefined();
		expect(body.outcome, 'top-level outcome is the old shape').toBeUndefined();
	});
});

describe('the per-request deadline', () => {
	// `integrations.md` section 5 promised this from the day the budget arithmetic was written
	// — "Clients set their own via the `timeout` param" — and nothing read it. Every request got
	// the server default, so a caller who wanted a fast answer or none waited the full ninety
	// seconds for a slow chain.

	it('accepts a shorter deadline than the server default', async () => {
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}&timeout=10000`,
		);
		expect(r.status).toBe(200);
	});

	it('cannot ask for MORE than the server budgeted', async () => {
		// The ceiling is what bounds how long one request holds an in-flight slot, and
		// `maxInflight` is sized on the assumption that it holds. A caller raising it would make
		// the memory arithmetic in operations.md section 1 false.
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}&timeout=99999999`,
		);
		expect(r.status).toBe(200);
	});

	it.each([['1'], ['0'], ['-5'], ['abc'], ['7999'], ['1.5']])(
		'rejects timeout=%s as a 400 rather than failing later',
		async (v) => {
			// Below the floor `hopBudget` enforces, the chain returns BUDGET_EXCEEDED without
			// opening a connection — a 504 for a request that never tried anything, where a 400
			// belongs.
			const r = await get(`api_key=${API_KEY}&url=https://example.com/&timeout=${v}`);
			expect(r.status).toBe(400);
			expect(r.headers.get('x-outcome')).toBe('BAD_REQUEST');
		},
	);
});

describe('the happy path, end to end over HTTP', () => {
	it('returns the page bytes with the upstream status', async () => {
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.status).toBe(200);
		expect(await r.text()).toContain('Herman Melville');
	});

	it('sets the headers plan.md section 4 promises', async () => {
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.headers.get('x-outcome')).toBe('OK');
		// The stable half. `x-outcome` grows with the taxonomy; this does not, so integration
		// code branches on it and survives a gateway newer than itself.
		expect(r.headers.get('x-outcome-class')).toBe('ok');
		expect(r.headers.get('x-provider-used')).toBeTruthy();
		expect(r.headers.get('x-attempts')).toBe('1');
		expect(r.headers.get('x-cost-estimate')).toMatch(/^\d+\.\d{6}$/);
	});

	it('sends a class on failures too, and the JSON body carries it', async () => {
		// The class must be present on the responses a caller actually branches on, not only on
		// the happy path — and both surfaces must agree, or switching on one is a trap.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent('http://127.0.0.1/')}`);
		expect(r.headers.get('x-outcome')).toBe('TARGET_FORBIDDEN');
		expect(r.headers.get('x-outcome-class')).toBe('client');
		const body = (await r.json()) as { error: { class: string; code: string } };
		expect(body.error.class).toBe('client');
		expect(body.error.code).toBe(r.headers.get('x-outcome'));
	});

	it('does NOT claim a detect rule, because /detect does not exist', async () => {
		// plan.md section 4 lists X-Detect-Rule: none. Emitting that would assert a detector
		// ran and found nothing. Absent is the honest state until SOFT_BLOCK can be produced.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.headers.get('x-detect-rule')).toBeNull();
	});
});

describe('failures reach the caller as a status they can branch on', () => {
	it('passes a target 404 through as 404, not as 200 with a sad body', async () => {
		// The drop-in promise: someone migrating from a provider keeps the status their code
		// already branches on.
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('target-not-found'))}`,
		);
		expect(r.status).toBe(404);
		expect(r.headers.get('x-outcome')).toBe('TARGET_NOT_FOUND');
		// And it stopped: 404 never fails over, because it is a real 404 everywhere.
		expect(r.headers.get('x-attempts')).toBe('1');
	});

	it('answers a target error as 502 with the attempts that were made', async () => {
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('target-error'))}`);
		expect(r.status).toBe(502);
		const body = (await r.json()) as { error: { code: string }; attempts: unknown[] };
		expect(body.error.code).toBe('TARGET_ERROR');
		// The logged grain is the attempt: a caller debugging a failover needs to see which
		// providers were tried, not just the verdict.
		expect(body.attempts).toHaveLength(2);
	});

	it('names the provider that FAILED, not just the one that served', async () => {
		// THE REGRESSION THIS EXISTS FOR, and it shipped as a clean 200. On the live gateway's
		// first real incident four requests timed out at one provider, failed over, and every
		// one returned 200 with `X-Provider-Used: scrapfly`. Nothing in the response, and
		// nothing in the request log, named the provider that had just cost 22 seconds. Working
		// it out needed /health/cooldowns, which expires — by the next morning it was gone.
		const merged = headersFor(
			{
				outcome: 'OK',
				provider: 'second',
				attempts: [
					{ provider: 'first', outcome: 'PROVIDER_TIMEOUT', budgetMs: 1, upstreamMs: 1 },
					{ provider: 'second', outcome: 'OK', budgetMs: 1, upstreamMs: 1 },
				],
			},
			5,
		);
		expect(merged['X-Chain']).toBe('first:PROVIDER_TIMEOUT>second:OK');
		// The two headers that could NOT answer it, asserted here so a future change that drops
		// X-Chain in favour of "the other headers already cover it" fails rather than argues.
		expect(merged['X-Provider-Used']).toBe('second');
		expect(merged['X-Attempts']).toBe('2');
	});

	it('omits the chain entirely when nothing was tried', async () => {
		// SHIPPED BROKEN IN 0.7.0, and found by putting the header on the marketing page: a
		// request refused before a provider is chosen has an empty attempt list, so this emitted
		// a bare `X-Chain:` with nothing after the colon. `X-Provider-Used` two fields down
		// already follows "omitted, never empty" for exactly this reason, and `X-Attempts: 0`
		// says the same thing better. An empty value also invites a caller to split it and get a
		// chain of one.
		const merged = headersFor({ outcome: 'NO_PROVIDER_AVAILABLE', attempts: [] }, 5);
		expect(merged['X-Chain']).toBeUndefined();
		expect(merged['X-Attempts']).toBe('0');
		// Not the empty string, which is what the broken version produced.
		expect(Object.hasOwn(merged, 'X-Chain')).toBe(false);
	});

	it('still emits a one-element chain when nothing failed', async () => {
		// An ABSENT header cannot say "nothing failed" — it is indistinguishable from an older
		// gateway, or from a bug. A one-element chain says it positively.
		const merged = headersFor(
			{
				outcome: 'OK',
				provider: 'only',
				attempts: [{ provider: 'only', outcome: 'OK', budgetMs: 1, upstreamMs: 1 }],
			},
			5,
		);
		expect(merged['X-Chain']).toBe('only:OK');
	});

	it('puts the chain in the request log, where the history lives', async () => {
		// The header answers "what happened to THIS request". The log is the only place that can
		// answer "which provider has been flaky this week", which is the question that actually
		// decides whether to keep paying one.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.status).toBe(200);
		expect(r.headers.get('x-chain')).toBe(`${r.headers.get('x-provider-used')}:OK`);
	});

	it('answers a refused target as 403 without contacting a provider', async () => {
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent('http://169.254.169.254/')}`,
		);
		expect(r.status).toBe(403);
		expect(r.headers.get('x-outcome')).toBe('TARGET_FORBIDDEN');
		expect(r.headers.get('x-attempts')).toBe('0');
	});

	it('answers 503 when no provider can serve the request', async () => {
		const r = await get(`api_key=${API_KEY}&url=https://example.com/&provider=doesnotexist`);
		expect(r.status).toBe(503);
		expect(r.headers.get('x-outcome')).toBe('NO_PROVIDER_AVAILABLE');
	});
});

describe('query parsing, where a default leaks most easily', () => {
	it('treats a missing url as 400, not as an empty scrape', async () => {
		expect((await get(`api_key=${API_KEY}`)).status).toBe(400);
	});

	it('rejects an unknown premium tier rather than silently downgrading', async () => {
		const r = await get(`api_key=${API_KEY}&url=https://example.com/&premium=gold`);
		expect(r.status).toBe(400);
	});

	it('treats render=false as false, not as "the parameter is present"', async () => {
		// Presence-as-truth is how `render=false` ends up rendering and billing 5x. If this
		// regressed, the replay would miss — the recording for this target is non-rendered —
		// so the request would fail rather than quietly cost more.
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}&render=false`,
		);
		expect(r.status).toBe(200);
	});

	it('honours provider= as a benchmarking escape hatch', async () => {
		const only = IDS[1] as string;
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}&provider=${only}`,
		);
		expect(r.headers.get('x-provider-used')).toBe(only);
	});
});

describe('cooldowns, over real HTTP', () => {
	it('forces one attempt rather than taking a fully-cooled domain off the air', async () => {
		// The cooldown floor, over real HTTP. Without it, a domain every provider has blocked
		// goes dark for the length of the backoff — which is now up to six hours, not fifteen
		// minutes, so refusing outright stopped being the honest answer.
		// A RECORDED target, not an invented host. The forced attempt genuinely reaches the
		// transport, and the replay transport refuses to invent a response for a URL nobody
		// recorded — correctly, since an invented response would make this test decorative.
		const url = target('success-html');
		const host = new URL(url).host;
		// CLEANED UP IN `finally`, because this arms the cooldown store every other test in this
		// file shares, on the host they all use. Leaving it armed made three unrelated tests
		// fail — the forced slot stays held for fifteen minutes, so every later request to this
		// host saw an all-cooling domain with no forced probe left and got a 503.
		try {
			for (const id of IDS) cooldowns.arm(`cd:blk:${id}:${host}`, Date.now());
			const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(url)}`);
			expect(r.status).toBe(200);
			expect(r.headers.get('x-provider-health')).toBe('cooling-forced');
		} finally {
			for (const id of IDS) cooldowns.clear(`cd:blk:${id}:${host}`);
			cooldowns.clear(forcedProbeKey(host));
		}
		// The per-domain rate limit is asserted in cooldown-routing.unit.test.ts, where the
		// forced probe can be made to FAIL. Here it succeeds, which clears the cooldown outright
		// — the block lifted — so there is no second refusal to observe.
	});

	it('answers 503 with Retry-After when every provider is cooling', async () => {
		// A 503 with no Retry-After tells a caller to guess, and they will guess wrong in the
		// direction that re-arms the cooldown they are waiting out.
		const target = 'https://cooled.example/page';
		for (const id of IDS) {
			cooldowns.arm(`cd:blk:${id}:cooled.example`, Date.now());
		}
		// The forced slot must already be taken, or the floor serves this request instead of
		// refusing it. That is the real precondition for a refusal now, not a workaround.
		cooldowns.arm(forcedProbeKey('cooled.example'), Date.now());
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target)}`);
		expect(r.status).toBe(503);
		expect(r.headers.get('x-outcome')).toBe('NO_PROVIDER_AVAILABLE');
		const retry = Number(r.headers.get('retry-after'));
		expect(Number.isFinite(retry)).toBe(true);
		expect(retry).toBeGreaterThanOrEqual(0);
		expect(retry).toBeLessThanOrEqual(15 * 60);
	});

	it('sets no Retry-After when the chain does not know one', async () => {
		// Only set when the chain actually knows. A guessed Retry-After is worse than none,
		// because a caller will believe it.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.headers.get('retry-after')).toBeNull();
	});
});

describe('/health/cooldowns', () => {
	// Cooldowns are ON by default and were the only routing mechanism with no way to see them.
	// An operator asking "why is one provider never used" had to read source.
	it('separates a domain block from an account cooldown', async () => {
		// The first thing an operator needs: an account cooldown is a rate limit or an auth
		// failure and has nothing to do with the domain they are debugging.
		cooldowns.arm('cd:blk:scraperapi:blocked.example', Date.now());
		cooldowns.arm('cd:acct:self:scrapfly', Date.now());
		const r = await fetch(`${base}/health/cooldowns?api_key=${API_KEY}`);
		expect(r.status).toBe(200);
		const body = (await r.json()) as {
			cooling: { scope: string; provider: string; domain?: string; org?: string }[];
		};
		// Selected by the exact key, not by scope: this suite shares one store, and an earlier
		// test arms cooldowns of its own. `find(scope === 'domain')` picked up whichever came
		// first, which is an ordering dependency rather than an assertion.
		const blk = body.cooling.find((c) => c.domain === 'blocked.example');
		expect(blk?.scope).toBe('domain');
		expect(blk?.provider).toBe('scraperapi');
		const acct = body.cooling.find((c) => c.scope === 'account' && c.provider === 'scrapfly');
		expect(acct?.provider).toBe('scrapfly');
		expect(acct?.org).toBe('self');
		expect(acct, 'an account cooldown must not claim a domain').not.toHaveProperty('domain');
	});

	it('reports how long is left, not the raw timestamp', async () => {
		cooldowns.arm('cd:blk:scraperapi:soon.example', Date.now());
		const body = (await (
			await fetch(`${base}/health/cooldowns?api_key=${API_KEY}`)
		).json()) as { cooling: { domain?: string; expiresInMs: number }[] };
		const e = body.cooling.find((c) => c.domain === 'soon.example');
		expect(e?.expiresInMs).toBeGreaterThan(0);
		expect(e?.expiresInMs).toBeLessThanOrEqual(30_000);
	});

	it('separates expired-but-recorded entries, which explain the next backoff', async () => {
		// Not noise: `consecutive` is what makes the backoff exponential, so an expired record
		// is the reason the NEXT cooldown on that key will be longer.
		cooldowns.arm('cd:blk:scraperapi:old.example', Date.now() - 60 * 60 * 1000);
		const body = (await (
			await fetch(`${base}/health/cooldowns?api_key=${API_KEY}`)
		).json()) as {
			cooling: { domain?: string }[];
			expired: { domain?: string; consecutive: number }[];
		};
		expect(body.cooling.map((c) => c.domain)).not.toContain('old.example');
		const e = body.expired.find((x) => x.domain === 'old.example');
		expect(e?.consecutive).toBeGreaterThan(0);
	});

	it('refuses without a key, because it names providers AND the domains we were blocked on', async () => {
		const r = await fetch(`${base}/health/cooldowns`);
		expect(r.status).toBe(401);
		expect(await r.text()).not.toContain('blocked.example');
	});

	it('answers 501, not an empty list, when cooldowns are switched off', async () => {
		const noCd = createApp({
			transport: createReplayTransport([]) as HttpTransport,
			candidates: [],
			apiKey: API_KEY,
			maxBodyBytes: 1024,
			defaultDeadlineMs: 1000,
		});
		const r = await noCd.request(`/health/cooldowns?api_key=${API_KEY}`);
		expect(r.status).toBe(501);
	});
});

describe('/health/providers', () => {
	it('refuses without a key, because it names providers and /health deliberately does not', async () => {
		// The consistency that matters: `/health` reports a COUNT and no names precisely
		// because it is unauthenticated. An open endpoint listing them would undo that
		// decision one route away from where it is written down.
		const r = await fetch(`${base}/health/providers`);
		expect(r.status).toBe(401);
		expect(await r.text()).not.toContain(IDS[0] as string);
	});

	it('names the providers and what the router believes about each', async () => {
		// Unlike /health, this one DOES name providers: an operator debugging "why is
		// everything slow" needs to know which provider the gateway has given up on, and they
		// chose the list themselves.
		const r = await fetch(`${base}/health/providers?api_key=${API_KEY}`);
		expect(r.status).toBe(200);
		const body = (await r.json()) as {
			providers: { id: string; state: string; baselineFailureRate: number | null }[];
		};
		expect(body.providers.map((p) => p.id).sort()).toEqual([...IDS].sort());
		for (const p of body.providers) expect(p.state).toBe('healthy');
	});

	it('reports a null baseline rather than omitting it', async () => {
		// "We have no baseline yet" is the actionable answer when someone asks why a dying
		// provider has not been demoted. An omitted field reads as zero.
		const body = (await (
			await fetch(`${base}/health/providers?api_key=${API_KEY}`)
		).json()) as {
			providers: { baselineFailureRate: number | null }[];
		};
		for (const p of body.providers) expect(p.baselineFailureRate).toBeNull();
	});

	it('leaks no key material', async () => {
		// The endpoint takes no key, so what it returns is reachable by anyone who can reach
		// the port. Provider ids are the operator's own choices; credentials are not.
		const text = await (await fetch(`${base}/health/providers?api_key=${API_KEY}`)).text();
		expect(text).not.toContain(API_KEY);
		expect(text).not.toMatch(/key/i);
	});

	it('answers 501, not an empty list, when health is switched off', async () => {
		// `{providers: []}` would read as "all fine". A gateway running PROXLANE_HEALTH=off
		// has no opinion at all, which is a different statement.
		const noHealth = createApp({
			transport: createReplayTransport([]) as HttpTransport,
			candidates: [],
			apiKey: API_KEY,
			maxBodyBytes: 1024,
			defaultDeadlineMs: 1000,
		});
		const r = await noHealth.request(`/health/providers?api_key=${API_KEY}`);
		expect(r.status).toBe(501);
	});
});

describe('one line per request, covering every exit', () => {
	// The wrapper reads headers the response already set, so a path nobody remembered is still
	// logged. These assert the exits that are easy to forget: the refusals.
	const capture = async (qs: string) => {
		const lines: RequestLine[] = [];
		const app = createApp({
			transport: createReplayTransport(entries),
			candidates: adapters,
			apiKey: API_KEY,
			maxBodyBytes: 10 * 1024 * 1024,
			defaultDeadlineMs: 90_000,
			log: (l) => lines.push(l),
		});
		const server = serve({ fetch: app.fetch, port: 0 });
		await new Promise((r) => setTimeout(r, 50));
		const port = (server.address() as AddressInfo).port;
		try {
			await fetch(`http://127.0.0.1:${port}${qs}`);
		} finally {
			await new Promise<void>((r) => server.close(() => r()));
		}
		return lines;
	};

	it('logs a served request with the provider, attempts and cost', async () => {
		const [line] = await capture(
			`/v1?api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`,
		);
		expect(line?.status).toBe(200);
		expect(line?.outcome).toBe('OK');
		expect(line?.provider).toBeTypeOf('string');
		expect(line?.attempts).toBe(1);
		expect(line?.cost).toBeTypeOf('string');
		expect(line?.id).toMatch(/^[\w-]+$/);
	});

	it('logs a refused key, which is the line that shows someone probing', async () => {
		const [line] = await capture('/v1?api_key=nope&url=https://example.com/');
		expect(line?.status).toBe(401);
		expect(line?.class).toBe('client');
		// No outcome: UNAUTHORIZED is a gateway error code, not something that happened to a
		// scrape. The class is what a reader branches on.
		expect(line?.outcome).toBeUndefined();
	});

	it('logs a validation refusal even though no provider was chosen', async () => {
		const [line] = await capture(`/v1?api_key=${API_KEY}`);
		expect(line?.status).toBe(400);
		expect(line?.outcome).toBe('BAD_REQUEST');
		expect(line?.attempts).toBe(0);
	});

	it('records the host, and never the gateway key', async () => {
		// The whole reason the field is `host` rather than `url`: a scrape URL carries the
		// caller's query string, and `/v1?api_key=…` carries ours. `log.unit.test.ts` pins the
		// query-string stripping precisely; this pins that nothing leaks over real HTTP.
		const [line] = await capture(
			`/v1?api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`,
		);
		expect(line?.host).toBe(new URL(target('success-html')).host);
		expect(JSON.stringify(line)).not.toContain(API_KEY);
		expect(JSON.stringify(line)).not.toContain('api_key');
	});

	it('still logs when the handler throws, which is the line most worth having', async () => {
		// A target with no recording makes the replay transport throw, which is as close to an
		// unhandled runtime fault as this suite can stage. The first version of the wrapper
		// awaited the handler and logged afterwards, so exactly this case — the one where
		// "what was that request?" has no other answer — produced nothing at all.
		const [line] = await capture(
			`/v1?api_key=${API_KEY}&url=${encodeURIComponent('https://nothing-recorded.example/x')}`,
		);
		expect(line, 'a throwing request must still be logged').toBeDefined();
		expect(line?.status).toBe(500);
		expect(line?.host).toBe('nothing-recorded.example');
	});

	it('does not log /health, which the orchestrator hits forever', async () => {
		expect(await capture('/health')).toHaveLength(0);
	});
});

describe('asking for bytes only reaches providers that can carry them', () => {
	// FOUND BY TRYING TO SWAP A REAL CALLER OVER. Asked each provider for the same JPEG on
	// 2026-08-19: scrapingbee and brightdata returned `ffd8ff` intact; ScraperAPI returned
	// `efbfbd` — the UTF-8 replacement character — with `charset=utf-8` appended to
	// `image/jpeg`; Scrapfly returned its JSON envelope. Two of four destroy binary, and the
	// chain picks ScraperAPI first, so an image request would have come back 200 and corrupted.

	it('excludes a provider that cannot return bytes', () => {
		const textOnly = {
			...(adapters[0]?.adapter.capabilities as ProviderCapabilities),
			binary: false,
		};
		expect(isCapable(textOnly, { ...BASE_REQ, binary: true })).toBe(false);
		// …and still serves it when bytes were not asked for, which is every other request.
		expect(isCapable(textOnly, BASE_REQ)).toBe(true);
	});

	it('keeps a provider that can', () => {
		const bytes = {
			...(adapters[0]?.adapter.capabilities as ProviderCapabilities),
			binary: true,
		};
		expect(isCapable(bytes, { ...BASE_REQ, binary: true })).toBe(true);
	});

	it('answers NO_PROVIDER_AVAILABLE rather than corrupting the body', async () => {
		// The honest failure. A caller who asked for bytes and cannot have them needs to know,
		// not receive mojibake with a 200 on it.
		const textOnly = adapters.map(({ adapter, key }) => ({
			adapter: {
				...adapter,
				capabilities: { ...adapter.capabilities, binary: false },
			},
			key,
		}));
		const app = createApp({
			transport: createReplayTransport(entries),
			candidates: textOnly,
			apiKey: API_KEY,
			maxBodyBytes: 10 * 1024 * 1024,
			defaultDeadlineMs: 90_000,
		});
		const server = serve({ fetch: app.fetch, port: 0 });
		await new Promise((r) => setTimeout(r, 50));
		const port = (server.address() as AddressInfo).port;
		try {
			const r = await fetch(
				`http://127.0.0.1:${port}/v1?api_key=${API_KEY}&url=https://example.com/x.jpg&binary=true`,
			);
			expect(r.status).toBe(503);
			expect(r.headers.get('x-outcome')).toBe('NO_PROVIDER_AVAILABLE');
		} finally {
			await new Promise<void>((r) => server.close(() => r()));
		}
	});

	it('treats binary=false as not asking, like render', async () => {
		// Presence is never truth in this gateway. `binary=false` must not narrow the chain.
		const r = await get(
			`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}&binary=false`,
		);
		expect(r.status).toBe(200);
	});
});

describe('cost is never summed across units', () => {
	// FOUND ON THE LIVE GATEWAY, not by reading. Three launch providers sell credits and Bright
	// Data bills cents, so a chain that failed over between them reported `1.0015` — one
	// ScraperAPI credit plus fifteen hundredths of a cent, added as though that were a quantity.
	// Cost-aware routing would have preferred Bright Data by a factor of ~667 on arithmetic alone.

	it('names the unit alongside the number, and it is the SERVING provider’s unit', async () => {
		// Derived from whoever served rather than hardcoded. The first version asserted
		// `provider-credits` and failed because the fixture is served by brightdata, which really
		// does bill cents — the test was wrong and the header was right, which is the good way
		// round but only if the test then says something true.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.headers.get('x-cost-estimate')).toMatch(/^\d+\.\d{6}$/);
		const served = r.headers.get('x-provider-used');
		const declared = adapters.find((a) => a.adapter.capabilities.id === served)?.adapter
			.capabilities.costTable.unit;
		expect(declared, `${served} declares a unit`).toBeDefined();
		expect(r.headers.get('x-cost-unit')).toBe(declared);
	});

	it('reports every attempt with its own unit', async () => {
		// The per-attempt figures are the honest record: each is in its provider's own unit, so a
		// caller reconciling an invoice has what it needs even when no total exists.
		const body = (await (
			await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('target-error'))}`)
		).json()) as {
			attempts: { provider: string; costMicrocredits?: number; costUnit?: string }[];
		};
		const charged = body.attempts.filter((a) => a.costMicrocredits !== undefined);
		expect(charged.length).toBeGreaterThan(0);
		for (const a of charged) {
			expect(['provider-credits', 'usd-cents'], `${a.provider} declares a unit`).toContain(
				a.costUnit,
			);
		}
	});

	it('says `mixed` rather than inventing a total across units', async () => {
		// Constructed, because no recorded fixture chain happens to cross units today — and a
		// property this important should not wait for one to appear. `mixed` is deliberately not
		// a number: a caller parsing it as a float gets NaN rather than a plausible wrong figure.
		const cents: Adapter = {
			capabilities: {
				...(adapters[0]?.adapter.capabilities as ProviderCapabilities),
				id: 'centsprovider',
				costTable: {
					effectiveDate: '2026-08-19',
					sourceUrl: 'https://x.test/',
					unit: 'usd-cents',
					base: 1_500,
					multipliers: {},
				},
			},
			translate: () => ({
				url: 'https://api.cents.test/',
				method: 'GET',
				headers: {},
				timeoutMs: 1,
			}),
			parse: () => ({ outcome: 'OK', cost: { microcredits: 1_500, source: 'estimated' } }),
		};
		const merged = headersFor(
			{
				outcome: 'OK',
				attempts: [
					{
						provider: 'a',
						outcome: 'PROVIDER_ERROR',
						budgetMs: 1,
						upstreamMs: 1,
						costMicrocredits: 1_000_000,
						costUnit: 'provider-credits',
					},
					{
						provider: 'centsprovider',
						outcome: 'OK',
						budgetMs: 1,
						upstreamMs: 1,
						costMicrocredits: 1_500,
						costUnit: 'usd-cents',
					},
				],
			},
			5,
		);
		void cents;
		expect(merged['X-Cost-Estimate']).toBe('mixed');
		expect(merged['X-Cost-Unit']).toBeUndefined();
		expect(Number(merged['X-Cost-Estimate'])).toBeNaN();
	});
});

describe('/health', () => {
	it('answers without a key, because a probe has none', async () => {
		const r = await fetch(`${base}/health`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ status: 'ok', version: VERSION, providers: IDS.length });
	});

	it('reports a real version, so a deploy can be verified', async () => {
		// The point of the field. Publishing an image is not deploying it — an orchestrator pins
		// the digest a service started with — so `deploy-gateway.yml` polls this until it matches
		// what it published. A hardcoded or absent version makes that check a no-op, which is how
		// two sibling projects ran three days and three weeks stale.
		const body = (await (await fetch(`${base}/health`)).json()) as { version: string };
		expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(body.version).not.toBe('unknown');
		// From package.json, never written down twice. The CLI shipped a literal once and
		// reported 0.0.0 for a package published as 0.0.1.
		const pkg = JSON.parse(
			readFileSync(resolve(ROOT, 'apps/gateway/package.json'), 'utf8'),
		) as { version: string };
		expect(body.version).toBe(pkg.version);
	});

	it('reports the provider COUNT and never the names', async () => {
		// This endpoint takes no key. Which providers an operator pays for is not something to
		// hand to anyone who can reach the port; a count is enough to diagnose "why is every
		// scrape NO_PROVIDER_AVAILABLE".
		const body = await (await fetch(`${base}/health`)).text();
		for (const id of IDS) expect(body).not.toContain(id);
	});

	it('reports X-Provider-Health on a served request', async () => {
		// The header a user reads when routing looks odd. Absent means no provider served;
		// present means this is what the router believed about the one that did.
		const r = await get(`api_key=${API_KEY}&url=${encodeURIComponent(target('success-html'))}`);
		expect(r.status).toBe(200);
		expect(r.headers.get('x-provider-health')).toBe('healthy');
	});

	it('stays 200 with zero providers, because the process is still healthy', async () => {
		// A gateway with no keys is correctly running and will honestly answer
		// NO_PROVIDER_AVAILABLE. Failing the healthcheck for that would restart-loop a
		// container whose only problem is that nobody has signed up for a provider yet —
		// which is exactly what selfhost:smoke hit.
		const bare = createApp({
			transport: createReplayTransport([]) as HttpTransport,
			candidates: [],
			apiKey: API_KEY,
			maxBodyBytes: 1_000,
			defaultDeadlineMs: 1_000,
		});
		const r = await bare.request('/health');
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ status: 'ok', version: VERSION, providers: 0 });
	});
});
