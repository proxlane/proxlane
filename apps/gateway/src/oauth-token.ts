// The token side of the hosted gateway's authorization server: the token endpoint and the bearer
// check on `/mcp`. The authorize side, and why any of this exists, is in `oauth.ts`.
//
// Codes and refresh tokens are single use through `grant-store.ts`, the one piece of state; a
// reused one revokes its grant family, as OAuth 2.1 asks. Everything else is a sealed box.

import { createHash, randomUUID } from 'node:crypto';
import type { TokenKeyring } from '@proxlane/shared/token';
import type { GrantStore } from './grant-store.js';
import { CODE_TTL_MS, challenge, err, type OAuthReply, resourceOf } from './oauth.js';

export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000;

type Grant = {
	readonly t: string;
	readonly c: string;
	readonly res: string;
	readonly f: string;
};

function pkceMatches(verifier: unknown, challenge: string): boolean {
	if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
	return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

function issue(grant: Grant, keyring: TokenKeyring, now: number): OAuthReply {
	return {
		status: 200,
		body: {
			access_token: keyring.seal(
				'access',
				{ t: grant.t, c: grant.c, aud: grant.res, f: grant.f },
				now + ACCESS_TTL_MS,
			),
			token_type: 'Bearer',
			expires_in: ACCESS_TTL_MS / 1000,
			refresh_token: keyring.seal(
				'refresh',
				{ ...grant, j: randomUUID() },
				now + REFRESH_TTL_MS,
			),
		},
	};
}

/**
 * The token endpoint. `isRevoked` asks whether the tenant token inside a grant has been denied,
 * so a refresh cannot outlive the revocation of what it was made from.
 *
 * The store failing is a 503, never a token: see `grant-store.ts`.
 */
export async function exchange(
	form: Readonly<Record<string, string | undefined>>,
	deps: {
		readonly keyring: TokenKeyring;
		readonly grants: GrantStore;
		readonly isRevoked: (tenantToken: string) => boolean;
		readonly origin: string;
		readonly now: number;
	},
): Promise<OAuthReply> {
	const { keyring, grants, now } = deps;
	try {
		if (form.grant_type === 'authorization_code') {
			const opened = keyring.unseal('code', form.code ?? '', now);
			if (!opened.ok)
				return err(
					400,
					'invalid_grant',
					`the code is ${opened.reason === 'expired' ? 'expired' : 'not valid'}`,
				);
			const g = opened.value as Grant & { r: string; ch: string; j: string };
			if (form.client_id !== g.c)
				return err(400, 'invalid_grant', 'the code was issued to another client');
			if (form.redirect_uri !== undefined && form.redirect_uri !== g.r) {
				return err(
					400,
					'invalid_grant',
					'redirect_uri does not match the authorization request',
				);
			}
			if (!pkceMatches(form.code_verifier, g.ch))
				return err(400, 'invalid_grant', 'the PKCE verifier does not match');
			if (form.resource !== undefined && form.resource.replace(/\/$/, '') !== g.res) {
				return err(400, 'invalid_target', `this server issues tokens for ${g.res} only`);
			}
			if (!(await grants.claim(`code:${g.j}`, CODE_TTL_MS))) {
				// A replayed code: OAuth 2.1 says revoke what the first use issued.
				await grants.revoke(g.f, REFRESH_TTL_MS);
				return err(400, 'invalid_grant', 'the code has already been used');
			}
			if (deps.isRevoked(g.t))
				return err(400, 'invalid_grant', 'the token behind this grant has been revoked');
			return issue({ t: g.t, c: g.c, res: g.res, f: g.f }, keyring, now);
		}

		if (form.grant_type === 'refresh_token') {
			const opened = keyring.unseal('refresh', form.refresh_token ?? '', now);
			if (!opened.ok)
				return err(
					400,
					'invalid_grant',
					`the refresh token is ${opened.reason === 'expired' ? 'expired' : 'not valid'}`,
				);
			const g = opened.value as Grant & { j: string };
			if (form.client_id !== g.c)
				return err(400, 'invalid_grant', 'the refresh token was issued to another client');
			if (await grants.revoked(g.f))
				return err(400, 'invalid_grant', 'this grant has been revoked');
			if (!(await grants.claim(`refresh:${g.j}`, REFRESH_TTL_MS))) {
				// Reuse of a rotated refresh token means one copy was stolen. Revoke the family.
				await grants.revoke(g.f, REFRESH_TTL_MS);
				return err(
					400,
					'invalid_grant',
					'the refresh token has already been used; sign in again',
				);
			}
			if (deps.isRevoked(g.t))
				return err(400, 'invalid_grant', 'the token behind this grant has been revoked');
			return issue({ t: g.t, c: g.c, res: g.res, f: g.f }, keyring, now);
		}

		return err(400, 'unsupported_grant_type', 'authorization_code or refresh_token');
	} catch {
		return err(503, 'temporarily_unavailable', 'the grant store is unavailable; retry shortly');
	}
}

/**
 * The grant family a code or refresh token belongs to, if it opens: the token endpoint's rate-limit
 * key. Not the caller's address, which for every ChatGPT or claude.ai user is the vendor's own.
 */
export function familyOf(
	form: Readonly<Record<string, string | undefined>>,
	keyring: TokenKeyring,
	now: number,
): string | undefined {
	const opened =
		form.grant_type === 'refresh_token'
			? keyring.unseal('refresh', form.refresh_token ?? '', now)
			: keyring.unseal('code', form.code ?? '', now);
	const f = opened.ok ? (opened.value as { f?: unknown }).f : undefined;
	return typeof f === 'string' ? f : undefined;
}

/**
 * A `/mcp` request's bearer token, checked: sealed by this gateway, unexpired, for exactly this
 * resource, and from a family nobody revoked. Returns the tenant token inside it.
 */
export async function verifyAccess(
	authorization: string | undefined,
	deps: {
		readonly keyring: TokenKeyring;
		readonly grants: GrantStore;
		readonly origin: string;
		readonly now: number;
	},
): Promise<
	| { readonly ok: true; readonly tenantToken: string; readonly family: string }
	| { readonly ok: false; readonly challenge: string }
> {
	const bearer = /^[Bb][Ee][Aa][Rr][Ee][Rr] (.+)$/.exec(authorization ?? '')?.[1];
	if (bearer === undefined) return { ok: false, challenge: challenge(deps.origin) };
	const opened = deps.keyring.unseal('access', bearer, deps.now);
	const g = opened.ok ? (opened.value as Partial<Grant & { aud: string }>) : undefined;
	if (
		g?.aud !== resourceOf(deps.origin) ||
		typeof g.t !== 'string' ||
		typeof g.f !== 'string'
	) {
		return { ok: false, challenge: challenge(deps.origin, 'invalid_token') };
	}
	if (await deps.grants.revoked(g.f))
		return { ok: false, challenge: challenge(deps.origin, 'invalid_token') };
	return { ok: true, tenantToken: g.t, family: g.f };
}
