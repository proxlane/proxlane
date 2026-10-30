// Hosted mode end to end: a real server, real adapters, recorded provider traffic. The only
// thing stubbed is the network, as everywhere else in this suite.

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { generateTokenKeypair, loadTokenKeyring, sealToken } from '@proxlane/shared/token';
import { createReplayTransport, loadFixtures } from '@proxlane/vitest-config/replay-transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { clientAddressFrom } from './client-address.js';
import type { RequestLine } from './log.js';
import { InMemoryRateLimiter } from './rate-limit.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const API_KEY = randomBytes(24).toString('hex');
const IDS = Object.keys(REGISTRY).sort();
const adapters = new Map<string, Adapter>();
for (const id of IDS) adapters.set(id, await (REGISTRY[id] as () => Promise<Adapter>)());
const entries = IDS.flatMap((id) => loadFixtures(ROOT, id));
const SUCCESS = (() => {
	const hit = entries.find((e) => e.category === 'success-html');
	if (hit === undefined) throw new Error('no success-html fixture');
	return encodeURIComponent(hit.recording.target.url);
})();

let hosted: string;
let selfHosted: string;
let token: string;
let publicKey: string;
const lines: RequestLine[] = [];
const servers: ReturnType<typeof serve>[] = [];

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
	const server = serve({ fetch: app.fetch, port: 0 });
	servers.push(server);
	await new Promise((r) => setTimeout(r, 50));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
	const pair = await generateTokenKeypair();
	publicKey = pair.publicKey;
	// The operator holds no provider key at all: every key arrives in the token.
	const common = {
		transport: createReplayTransport(entries),
		candidates: [],
		apiKey: API_KEY,
		maxBodyBytes: 10 * 1024 * 1024,
		defaultDeadlineMs: 90_000,
	};
	hosted = await listen(
		createApp({
			...common,
			tenancy: {
				keyring: await loadTokenKeyring([pair.secretKey]),
				adapters,
				order: IDS,
				denied: new Set(),
				addressLimit: new InMemoryRateLimiter({ limit: 1000, windowMs: 60_000 }),
				credentialLimit: new InMemoryRateLimiter({ limit: 1000, windowMs: 60_000 }),
			},
			clientAddress: clientAddressFrom(undefined),
			log: (l) => lines.push(l),
		}),
	);
	selfHosted = await listen(createApp(common));
	token = await sealToken(
		{ keys: Object.fromEntries(IDS.map((id) => [id, 'REPLAY'])) },
		publicKey,
	);
});

afterAll(async () => {
	await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const scrape = (base: string, auth?: string, qs = '') =>
	fetch(
		`${base}/v1?url=${SUCCESS}${qs}`,
		auth === undefined ? {} : { headers: { Authorization: `Bearer ${auth}` } },
	);

describe('a tenant token on a hosted gateway', () => {
	it('serves on the keys inside it, with no provider key configured', async () => {
		const r = await scrape(hosted, token);
		expect(r.status).toBe(200);
		expect(r.headers.get('x-outcome')).toBe('OK');
	});

	it('logs the token id and never the token', async () => {
		lines.length = 0;
		await scrape(hosted, token);
		const line = lines.at(-1);
		expect(line?.token).toMatch(/^[0-9a-f]{32}$/);
		expect(JSON.stringify(line)).not.toContain(token);
		expect(JSON.stringify(line)).not.toContain('REPLAY');
	});

	it('refuses one in the query string, before opening it', async () => {
		const r = await fetch(`${hosted}/v1?url=${SUCCESS}&api_key=${token}`);
		expect(r.status).toBe(400);
		expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(
			/Authorization/,
		);
	});

	it('refuses an altered one as UNAUTHORIZED, with no outcome header, and logs why', async () => {
		lines.length = 0;
		const altered = token.slice(0, -6) + (token.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
		const r = await scrape(hosted, altered);
		expect(r.status).toBe(401);
		expect(r.headers.get('x-outcome')).toBeNull();
		expect(lines.at(-1)?.token_refused).toMatch(/unreadable|malformed/);
	});

	it('says plainly when the token holds no provider this gateway runs', async () => {
		const none = await sealToken({ keys: { 'acme-unlocker': 'k' } }, publicKey);
		const r = await scrape(hosted, none);
		expect(r.status).toBe(503);
		expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(
			/holds no key/,
		);
	});

	it('is live, so the sandbox header is refused rather than spending a test', async () => {
		const r = await fetch(`${hosted}/v1?url=${SUCCESS}`, {
			headers: { Authorization: `Bearer ${token}`, 'X-Proxlane-Simulate': 'OK' },
		});
		expect(r.status).toBe(400);
	});

	it('leaves the operator key working beside it', async () => {
		// The operator configured no provider, so the operator's own scrape has nothing to route on.
		const r = await fetch(`${hosted}/v1?url=${SUCCESS}&api_key=${API_KEY}`);
		expect(r.status).toBe(503);
		expect(r.headers.get('x-outcome')).toBe('NO_PROVIDER_AVAILABLE');
	});
});

describe('the public key, for the connect page', () => {
	it('is served by a hosted gateway, unauthenticated', async () => {
		const r = await fetch(`${hosted}/token-key`);
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual({ publicKey, kid: expect.stringMatching(/^[0-9a-f]{8}$/) });
	});

	it('is NOT_ENABLED on a self-hosted one', async () => {
		expect((await fetch(`${selfHosted}/token-key`)).status).toBe(501);
	});
});

describe('a self-hosted gateway', () => {
	it('treats a token as just a wrong key', async () => {
		expect((await scrape(selfHosted, token)).status).toBe(401);
	});
});
