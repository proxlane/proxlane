// Remote MCP end to end, the way claude.ai or ChatGPT drives it: a 401 that points at metadata,
// registration, the consent form, a code, tokens, then `fetch_page` over /mcp. Real adapters and
// recorded provider traffic; only the network is stubbed.

import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { generateTokenKeypair, loadTokenKeyring } from '@proxlane/shared/token';
import { createReplayTransport, loadFixtures } from '@proxlane/vitest-config/replay-transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { clientAddressFrom } from './client-address.js';
import { InMemoryGrantStore } from './grant-store.js';
import type { RequestLine } from './log.js';
import { InMemoryRateLimiter } from './rate-limit.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const IDS = Object.keys(REGISTRY).sort();
const adapters = new Map<string, Adapter>();
for (const id of IDS) adapters.set(id, await (REGISTRY[id] as () => Promise<Adapter>)());
const entries = IDS.flatMap((id) => loadFixtures(ROOT, id));
const SUCCESS = (() => {
	const hit = entries.find((e) => e.category === 'success-html');
	if (hit === undefined) throw new Error('no success-html fixture');
	return hit.recording.target.url;
})();

const CB = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = `${'q'.repeat(48)}`;
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
let base: string;
let server: ReturnType<typeof serve>;
const lines: RequestLine[] = [];
const addressLimit = new InMemoryRateLimiter({ limit: 1000, windowMs: 60_000 });

beforeAll(async () => {
	const pair = await generateTokenKeypair();
	const keyring = await loadTokenKeyring([pair.secretKey]);
	const app = createApp({
		transport: createReplayTransport(entries),
		candidates: [],
		apiKey: 'operator-key-for-the-oauth-suite-0000',
		maxBodyBytes: 10 * 1024 * 1024,
		defaultDeadlineMs: 90_000,
		tenancy: {
			keyring,
			adapters,
			order: IDS,
			denied: new Set(),
			addressLimit,
			credentialLimit: new InMemoryRateLimiter({ limit: 1000, windowMs: 60_000 }),
			authFailures: new InMemoryRateLimiter({ limit: 1000, windowMs: 60_000 }),
		},
		clientAddress: clientAddressFrom(undefined),
		// Filled in once the port is known: the issuer has to be the address clients actually use.
		oauth: { origin: 'http://127.0.0.1:0', grants: new InMemoryGrantStore() },
		log: (l) => lines.push(l),
	});
	server = serve({ fetch: app.fetch, port: 0 });
	await new Promise((r) => setTimeout(r, 50));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The suite's server answers as `http://127.0.0.1:0`; requests go to its real port. */
const ORIGIN = 'http://127.0.0.1:0';
const at = (path: string) => `${base}${path}`;

async function signIn(
	redirect = CB,
	confirm = false,
): Promise<{ client: string; tokens: Record<string, unknown>; tokenId: string }> {
	const reg = (await (
		await fetch(at('/oauth/register'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude' }),
		})
	).json()) as { client_id: string };
	const q = new URLSearchParams({
		response_type: 'code',
		client_id: reg.client_id,
		redirect_uri: redirect,
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 'xyz',
		resource: `${ORIGIN}/mcp`,
	});
	const form = await (await fetch(at(`/oauth/authorize?${q}`))).text();
	const consent = /name="consent" value="([^"]+)"/.exec(form)?.[1] as string;
	const body = new URLSearchParams({
		consent,
		...Object.fromEntries(IDS.map((id) => [`key_${id}`, 'REPLAY'])),
	});
	if (confirm) body.set('confirm', new URL(redirect).host);
	const done = await (await fetch(at('/oauth/authorize'), { method: 'POST', body })).text();
	const href = /href="([^"]+)"/.exec(done)?.[1]?.replaceAll('&amp;', '&') as string;
	const tokenId = /<code>([0-9a-f]{32})<\/code>/.exec(done)?.[1] as string;
	const code = new URL(href).searchParams.get('code') as string;
	const tokens = (await (
		await fetch(at('/oauth/token'), {
			method: 'POST',
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: reg.client_id,
				code_verifier: VERIFIER,
				redirect_uri: redirect,
			}),
		})
	).json()) as Record<string, unknown>;
	return { client: reg.client_id, tokens, tokenId };
}

const rpc = (token: string | undefined, method: string, params: Record<string, unknown>) =>
	fetch(at('/mcp'), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});

describe('discovery, from one failed call', () => {
	it('answers /mcp without a token with a challenge naming the metadata', async () => {
		const r = await rpc(undefined, 'tools/list', {});
		expect(r.status).toBe(401);
		expect(r.headers.get('www-authenticate')).toContain(
			`${ORIGIN}/.well-known/oauth-protected-resource`,
		);
	});

	it('publishes the resource and the authorization server', async () => {
		const pr = (await (
			await fetch(at('/.well-known/oauth-protected-resource'))
		).json()) as Record<string, unknown>;
		expect(pr).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
		const as = (await (
			await fetch(at('/.well-known/oauth-authorization-server'))
		).json()) as Record<string, unknown>;
		expect(as).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ['S256'] });
	});
});

describe('a sign-in from a known app', () => {
	it('ends with fetch_page working over /mcp, on the keys pasted into the form', async () => {
		const { tokens, tokenId } = await signIn();
		expect(tokenId).toMatch(/^[0-9a-f]{32}$/);
		const access = tokens.access_token as string;
		expect(access).toMatch(/^pxa1_/);

		const list = await rpc(access, 'tools/list', {});
		expect(list.status).toBe(200);
		expect(JSON.stringify(await list.json())).toContain('fetch_page');

		lines.length = 0;
		const call = await rpc(access, 'tools/call', {
			name: 'fetch_page',
			arguments: { url: SUCCESS },
		});
		const result = (await call.json()) as {
			result: { isError?: boolean; structuredContent?: { ok: boolean } };
		};
		expect(result.result.isError).not.toBe(true);
		expect(result.result.structuredContent?.ok).toBe(true);
		// The /v1 call it made in process is logged as that tenant, by id.
		expect(lines.at(-1)?.token).toBe(tokenId);
		// And limited as that GRANT, not as the address it came from, which for every claude.ai user
		// is Anthropic's: one user's dead key must not lock the rest out.
		expect(await addressLimit.peek('127.0.0.1', Date.now())).toBe(0);
	});

	it('refuses a tenant token presented to /mcp directly: only grants open it', async () => {
		const { tokens } = await signIn();
		const r = await rpc(tokens.refresh_token as string, 'tools/list', {});
		expect(r.status).toBe(401);
	});
});

describe('a sign-in toward an unknown host', () => {
	it('names the host, warns, and refuses to continue without the confirmation', async () => {
		const evil = 'https://evil.example/cb';
		const reg = (await (
			await fetch(at('/oauth/register'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ redirect_uris: [evil], client_name: 'Claude' }),
			})
		).json()) as { client_id: string };
		const q = new URLSearchParams({
			response_type: 'code',
			client_id: reg.client_id,
			redirect_uri: evil,
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256',
		});
		const page = await fetch(at(`/oauth/authorize?${q}`));
		const html = await page.text();
		expect(html).toContain('evil.example is not a known AI app');
		// The registered name is never shown: it is the attacker's to choose.
		expect(html).not.toContain('Claude');
		expect(page.headers.get('x-frame-options')).toBe('DENY');
		expect(page.headers.get('cache-control')).toBe('no-store');

		const consent = /name="consent" value="([^"]+)"/.exec(html)?.[1] as string;
		const r = await fetch(at('/oauth/authorize'), {
			method: 'POST',
			body: new URLSearchParams({ consent, key_scraperapi: 'k' }),
		});
		expect(await r.text()).toContain('Tick the box');
	});
});

describe('unauthenticated bodies are bounded', () => {
	it('refuses an oversized registration before reading it', async () => {
		const r = await fetch(at('/oauth/register'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ redirect_uris: [CB], client_name: 'x'.repeat(20_000) }),
		});
		expect(r.status).toBe(413);
	});
});
