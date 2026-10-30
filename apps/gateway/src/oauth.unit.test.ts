// The authorize side of the authorization server, against a real keyring: registration, the
// consent form, and every refusal that keeps a code from going where it should not.

import { createHash } from 'node:crypto';
import {
	generateTokenKeypair,
	loadTokenKeyring,
	type TokenKeyring,
} from '@proxlane/shared/token';
import { beforeAll, describe, expect, it } from 'vitest';
import { finishAuthorize, isKnownCallback, register, startAuthorize } from './oauth.js';

const ORIGIN = 'https://gateway.test';
const CB = 'https://claude.ai/api/mcp/auth_callback';
const T0 = Date.UTC(2026, 9, 30, 12);
const CHALLENGE = createHash('sha256')
	.update(`${'v'.repeat(43)}-._~`)
	.digest('base64url');

let keyring: TokenKeyring;
beforeAll(async () => {
	keyring = await loadTokenKeyring([(await generateTokenKeypair()).secretKey]);
});

function clientFor(...uris: string[]): string {
	const r = register({ redirect_uris: uris, client_name: 'Claude' }, keyring, T0);
	expect(r.status).toBe(201);
	return r.body.client_id as string;
}

function authorize(over: Record<string, string | undefined> = {}, client = clientFor(CB)) {
	return startAuthorize(
		{
			response_type: 'code',
			client_id: client,
			redirect_uri: CB,
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256',
			state: 'st8',
			resource: `${ORIGIN}/mcp`,
			...over,
		},
		keyring,
		ORIGIN,
		T0,
	);
}

describe('registration', () => {
	it('seals the registration into the client_id and makes every client public', () => {
		const r = register(
			{ redirect_uris: [CB], token_endpoint_auth_method: 'client_secret_post' },
			keyring,
			T0,
		);
		expect(r.body).toMatchObject({ token_endpoint_auth_method: 'none', redirect_uris: [CB] });
		expect(r.body.client_id).toMatch(/^pxc1_/);
	});

	it('refuses redirect URIs a code must never reach', () => {
		for (const bad of [
			[],
			['http://evil.example/cb'],
			['https://a.test/cb#frag'],
			['https://user:pw@a.test/cb'],
			['javascript:alert(1)'],
			[`https://a.test/${'x'.repeat(600)}`],
			Array(6).fill(CB),
		]) {
			expect(
				register({ redirect_uris: bad }, keyring, T0).status,
				JSON.stringify(bad).slice(0, 40),
			).toBe(400);
		}
		expect(register({ redirect_uris: ['http://127.0.0.1:33418/cb'] }, keyring, T0).status).toBe(
			201,
		);
	});
});

describe('the consent form, where open registration is closed', () => {
	it('names the redirect host, and calls only known callbacks verified', () => {
		expect(authorize()).toMatchObject({ kind: 'consent', host: 'claude.ai', verified: true });
		const evil = clientFor('https://evil.example/cb');
		expect(authorize({ redirect_uri: 'https://evil.example/cb' }, evil)).toMatchObject({
			kind: 'consent',
			host: 'evil.example',
			verified: false,
		});
	});

	it('never redirects to a URI the client did not register, nor for a forged client', () => {
		expect(authorize({ redirect_uri: 'https://evil.example/cb' })).toMatchObject({
			kind: 'fatal',
		});
		expect(authorize({ client_id: 'pxc1_forged' })).toMatchObject({ kind: 'fatal' });
	});

	it('sends protocol errors back to the client, with state and iss', () => {
		for (const [over, error] of [
			[{ response_type: 'token' }, 'unsupported_response_type'],
			[{ code_challenge: undefined }, 'invalid_request'],
			[{ code_challenge_method: 'plain' }, 'invalid_request'],
			[{ resource: 'https://other.test/mcp' }, 'invalid_target'],
		] as const) {
			const r = authorize(over);
			expect(r.kind).toBe('redirect');
			const u = new URL(r.kind === 'redirect' ? r.location : '');
			expect([
				u.searchParams.get('error'),
				u.searchParams.get('state'),
				u.searchParams.get('iss'),
			]).toEqual([error, 'st8', ORIGIN]);
		}
	});

	it('never bounces an error to a host that is not a known app: no open redirector', () => {
		const evil = clientFor('https://evil.example/cb');
		expect(
			authorize({ redirect_uri: 'https://evil.example/cb', response_type: 'token' }, evil),
		).toMatchObject({
			kind: 'fatal',
		});
		expect(authorize({ state: 's'.repeat(600) })).toMatchObject({ kind: 'redirect' });
	});

	it('refuses an altered or stale consent form', () => {
		const start = authorize();
		if (start.kind !== 'consent') throw new Error(start.kind);
		expect(finishAuthorize(`${start.consent}x`, 'pxl1_t', keyring, ORIGIN, T0)).toMatchObject({
			ok: false,
		});
		expect(
			finishAuthorize(start.consent, 'pxl1_t', keyring, ORIGIN, T0 + 11 * 60_000),
		).toMatchObject({
			ok: false,
			message: expect.stringMatching(/too long/),
		});
	});

	it('recognises ChatGPT callbacks, old and per connector, and loopback', () => {
		expect(isKnownCallback('https://chatgpt.com/connector/oauth/abc_123')).toBe(true);
		expect(isKnownCallback('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
		expect(isKnownCallback('http://localhost:6274/oauth/callback')).toBe(true);
		expect(isKnownCallback('https://chatgpt.com/connector/oauth/../../evil')).toBe(false);
		expect(isKnownCallback('https://claude.ai.evil.example/api/mcp/auth_callback')).toBe(false);
	});
});
