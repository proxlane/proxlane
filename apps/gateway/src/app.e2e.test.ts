// Layer 4: the real Hono app, over a real socket, driven by real HTTP. `pnpm test:e2e`.
//
// What makes this different from the contract tests next door is the transport in FRONT of
// the app rather than behind it. These go out over TCP, through Hono's routing and query
// parsing, and back — so a header that is never set, a status that is silently coerced, or
// a body that gets stringified on the way out are all visible here and nowhere else.
//
// Behind the app, the provider boundary is still recorded bytes. Nothing is invented.

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { createReplayTransport, loadFixtures } from '@proxlane/vitest-config/replay-transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InMemoryHealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

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

beforeAll(async () => {
	const transport: HttpTransport = createReplayTransport(entries);
	health = new InMemoryHealthStore();
	const app = createApp({
		transport,
		candidates: adapters,
		apiKey: API_KEY,
		maxBodyBytes: 10 * 1024 * 1024,
		defaultDeadlineMs: 90_000,
		health,
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
	});

	it('rejects a key of the right length but wrong content', async () => {
		// Guards the constant-time compare: length equality must not imply a match.
		const wrong = 'x'.repeat(API_KEY.length);
		expect((await get(`api_key=${wrong}&url=https://example.com/`)).status).toBe(401);
	});
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
		expect(r.headers.get('x-provider-used')).toBeTruthy();
		expect(r.headers.get('x-attempts')).toBe('1');
		expect(r.headers.get('x-cost-estimate')).toMatch(/^\d+\.\d{6}$/);
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
		const body = (await r.json()) as { outcome: string; attempts: unknown[] };
		expect(body.outcome).toBe('TARGET_ERROR');
		// The logged grain is the attempt: a caller debugging a failover needs to see which
		// providers were tried, not just the verdict.
		expect(body.attempts).toHaveLength(2);
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

describe('/health', () => {
	it('answers without a key, because a probe has none', async () => {
		const r = await fetch(`${base}/health`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ status: 'ok', providers: IDS.length });
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
		expect(await r.json()).toEqual({ status: 'ok', providers: 0 });
	});
});
