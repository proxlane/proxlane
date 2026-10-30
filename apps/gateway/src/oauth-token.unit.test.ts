// The token side of the authorization server, against a real keyring: codes for tokens, rotation,
// single use, revocation, and the bearer check on /mcp.

import { createHash } from 'node:crypto';
import {
	generateTokenKeypair,
	loadTokenKeyring,
	type TokenKeyring,
} from '@proxlane/shared/token';
import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryGrantStore } from './grant-store.js';
import { CODE_TTL_MS, finishAuthorize, register, startAuthorize } from './oauth.js';
import { ACCESS_TTL_MS, exchange, verifyAccess } from './oauth-token.js';

const ORIGIN = 'https://gateway.test';
const CB = 'https://claude.ai/api/mcp/auth_callback';
const T0 = Date.UTC(2026, 9, 30, 12);
const VERIFIER = `${'v'.repeat(43)}-._~`;
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const TENANT = 'pxl1_00000000_tenant-token-stand-in';

let keyring: TokenKeyring;
beforeAll(async () => {
	keyring = await loadTokenKeyring([(await generateTokenKeypair()).secretKey]);
});

function clientFor(...uris: string[]): string {
	return register({ redirect_uris: uris }, keyring, T0).body.client_id as string;
}

function authorize(client: string) {
	return startAuthorize(
		{
			response_type: 'code',
			client_id: client,
			redirect_uri: CB,
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256',
			state: 'st8',
			resource: `${ORIGIN}/mcp`,
		},
		keyring,
		ORIGIN,
		T0,
	);
}

/** Consent, then the code from the redirect. */
function codeFor(client: string): string {
	const start = authorize(client);
	if (start.kind !== 'consent') throw new Error(start.kind);
	const done = finishAuthorize(start.consent, TENANT, keyring, ORIGIN, T0);
	if (!done.ok) throw new Error(done.message);
	const u = new URL(done.location);
	expect(u.searchParams.get('state')).toBe('st8');
	expect(u.searchParams.get('iss')).toBe(ORIGIN);
	return u.searchParams.get('code') as string;
}

const deps = (grants = new InMemoryGrantStore(() => T0), revoked = new Set<string>()) => ({
	keyring,
	grants,
	isRevoked: (t: string) => revoked.has(t),
	origin: ORIGIN,
	now: T0,
});

describe('the token endpoint', () => {
	it('trades a code and its verifier for tokens that open /mcp', async () => {
		const client = clientFor(CB);
		const d = deps();
		const r = await exchange(
			{
				grant_type: 'authorization_code',
				code: codeFor(client),
				client_id: client,
				code_verifier: VERIFIER,
				redirect_uri: CB,
			},
			d,
		);
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000 });
		const ok = await verifyAccess(`Bearer ${r.body.access_token}`, d);
		expect(ok).toEqual({ ok: true, tenantToken: TENANT });
	});

	it('refuses a wrong verifier, another client, or a code past its minute', async () => {
		const client = clientFor(CB);
		const code = codeFor(client);
		const base = {
			grant_type: 'authorization_code',
			code,
			client_id: client,
			code_verifier: VERIFIER,
		};
		expect(
			(await exchange({ ...base, code_verifier: 'w'.repeat(43) }, deps())).body.error,
		).toBe('invalid_grant');
		expect((await exchange({ ...base, client_id: clientFor(CB) }, deps())).body.error).toBe(
			'invalid_grant',
		);
		expect((await exchange(base, { ...deps(), now: T0 + CODE_TTL_MS + 1 })).body.error).toBe(
			'invalid_grant',
		);
	});

	it('uses a code once, and revokes what its first use issued when it comes back', async () => {
		const client = clientFor(CB);
		const d = deps();
		const form = {
			grant_type: 'authorization_code',
			code: codeFor(client),
			client_id: client,
			code_verifier: VERIFIER,
		};
		const first = await exchange(form, d);
		expect((await exchange(form, d)).body.error).toBe('invalid_grant');
		expect(await verifyAccess(`Bearer ${first.body.access_token}`, d)).toMatchObject({
			ok: false,
		});
	});

	it('rotates refresh tokens, and a reused one revokes the whole family', async () => {
		const client = clientFor(CB);
		const d = deps();
		const first = await exchange(
			{
				grant_type: 'authorization_code',
				code: codeFor(client),
				client_id: client,
				code_verifier: VERIFIER,
			},
			d,
		);
		const rt = first.body.refresh_token as string;
		const second = await exchange(
			{ grant_type: 'refresh_token', refresh_token: rt, client_id: client },
			d,
		);
		expect(second.status).toBe(200);
		expect(second.body.refresh_token).not.toBe(rt);
		// The old one again: one copy was stolen. Everything from this grant stops working.
		expect(
			(await exchange({ grant_type: 'refresh_token', refresh_token: rt, client_id: client }, d))
				.body.error,
		).toBe('invalid_grant');
		expect(await verifyAccess(`Bearer ${second.body.access_token}`, d)).toMatchObject({
			ok: false,
		});
	});

	it('refuses to refresh a grant whose tenant token has been revoked', async () => {
		const client = clientFor(CB);
		const d = deps();
		const first = await exchange(
			{
				grant_type: 'authorization_code',
				code: codeFor(client),
				client_id: client,
				code_verifier: VERIFIER,
			},
			d,
		);
		const revoked = deps(new InMemoryGrantStore(() => T0), new Set([TENANT]));
		const r = await exchange(
			{
				grant_type: 'refresh_token',
				refresh_token: first.body.refresh_token as string,
				client_id: client,
			},
			revoked,
		);
		expect(r.body.error).toBe('invalid_grant');
	});

	it('answers 503 rather than a token when the grant store is down', async () => {
		const client = clientFor(CB);
		const down = {
			...deps(),
			grants: {
				claim: () => Promise.reject(new Error('down')),
				revoke: () => Promise.reject(new Error('down')),
				revoked: () => Promise.reject(new Error('down')),
			},
		};
		const r = await exchange(
			{
				grant_type: 'authorization_code',
				code: codeFor(client),
				client_id: client,
				code_verifier: VERIFIER,
			},
			down,
		);
		expect(r.status).toBe(503);
		expect(r.body.access_token).toBeUndefined();
	});
});

describe('the /mcp bearer check', () => {
	it('refuses a missing token with a challenge that points at the metadata', async () => {
		expect(await verifyAccess(undefined, deps())).toEqual({
			ok: false,
			challenge: `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
		});
	});

	it('refuses a tenant token, a code or a refresh token presented as an access token', async () => {
		const client = clientFor(CB);
		const code = codeFor(client);
		const tokens = await exchange(
			{ grant_type: 'authorization_code', code, client_id: client, code_verifier: VERIFIER },
			deps(),
		);
		for (const wrong of [TENANT, code, tokens.body.refresh_token as string]) {
			expect(await verifyAccess(`Bearer ${wrong}`, deps())).toMatchObject({ ok: false });
		}
	});

	it('refuses a token minted for another gateway origin', async () => {
		const client = clientFor(CB);
		const tokens = await exchange(
			{
				grant_type: 'authorization_code',
				code: codeFor(client),
				client_id: client,
				code_verifier: VERIFIER,
			},
			deps(),
		);
		expect(
			await verifyAccess(`Bearer ${tokens.body.access_token}`, {
				...deps(),
				origin: 'https://other.test',
			}),
		).toMatchObject({
			ok: false,
		});
	});
});
