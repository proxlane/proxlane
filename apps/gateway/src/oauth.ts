// The hosted gateway as its own OAuth 2.1 authorization server, for the remote MCP endpoint.
// `plan.md` section 2, "Remote MCP, for ChatGPT and claude.ai, is OAuth with no state either".
//
// PURE but for the grant store: every function takes what it needs and returns a status and a
// body, so the routes in `app.ts` are wiring and this file is what the tests exercise. Every
// artefact is a box sealed by the token keyring (`@proxlane/shared/token`), so nothing here is
// stored; the one exception is single use, in `grant-store.ts`.
//
// The spec is MCP authorization 2026-07-28: protected resource metadata (RFC 9728), authorization
// server metadata (RFC 8414), Dynamic Client Registration (RFC 7591), PKCE with S256 only,
// resource indicators (RFC 8707) with an exact audience, and `iss` in the response (RFC 9207).

import { randomUUID } from 'node:crypto';
import type { TokenKeyring } from '@proxlane/shared/token';

export const CODE_TTL_MS = 60_000;
export const CONSENT_TTL_MS = 10 * 60_000;

/** Redirect URIs per registration, and their length: a `client_id` must stay a usable URL. */
const MAX_REDIRECTS = 5;
const MAX_URI = 512;

/**
 * Callbacks the consent form calls verified. Anything else can be registered by anyone, so it is
 * shown as unverified and needs a second step (`plan.md`: open registration is a phishing surface).
 * Exact URIs, plus ChatGPT's per-connector path; loopback is the user's own machine.
 */
const KNOWN_CALLBACKS = [
	'https://claude.ai/api/mcp/auth_callback',
	'https://claude.com/api/mcp/auth_callback',
	'https://chatgpt.com/connector_platform_oauth_redirect',
];
const KNOWN_PREFIXES = ['https://chatgpt.com/connector/oauth/'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isKnownCallback(uri: string): boolean {
	if (KNOWN_CALLBACKS.includes(uri)) return true;
	if (
		KNOWN_PREFIXES.some(
			(p) => uri.startsWith(p) && /^[A-Za-z0-9_-]+$/.test(uri.slice(p.length)),
		)
	) {
		return true;
	}
	try {
		const u = new URL(uri);
		return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
	} catch {
		return false;
	}
}

// ---- metadata ----------------------------------------------------------------------------

export function resourceOf(origin: string): string {
	return `${origin}/mcp`;
}

/** RFC 9728, at `/.well-known/oauth-protected-resource`. */
export function protectedResourceMetadata(origin: string) {
	return {
		resource: resourceOf(origin),
		authorization_servers: [origin],
		bearer_methods_supported: ['header'],
		resource_name: 'Proxlane',
	};
}

/** RFC 8414, at `/.well-known/oauth-authorization-server`. */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		authorization_response_iss_parameter_supported: true,
	};
}

/** The 401 challenge on `/mcp`, so a client can find everything above from one failed call. */
export function challenge(origin: string, error?: 'invalid_token'): string {
	return (
		`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` +
		(error === undefined ? '' : `, error="${error}"`)
	);
}

// ---- registration ------------------------------------------------------------------------

type Registration = { readonly r: readonly string[]; readonly n?: string };

export type OAuthReply = { readonly status: number; readonly body: Record<string, unknown> };

export const err = (status: number, error: string, description: string): OAuthReply => ({
	status,
	body: { error, error_description: description },
});

/** A redirect URI this server will ever send a code to: https, or http to this machine. */
function redirectProblem(uri: unknown): string | undefined {
	if (typeof uri !== 'string' || uri.length > MAX_URI)
		return 'each redirect URI is a string under 512 characters';
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return 'a redirect URI is not a URL';
	}
	if (u.hash !== '' || uri.includes('#')) return 'a redirect URI may not carry a fragment';
	if (u.username !== '' || u.password !== '') return 'a redirect URI may not carry credentials';
	if (u.protocol === 'https:') return undefined;
	if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return undefined;
	return 'a redirect URI must be https, or http to localhost';
}

/** RFC 7591. The `client_id` IS the registration, sealed; there is no client table. */
export function register(body: unknown, keyring: TokenKeyring, now: number): OAuthReply {
	const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	const uris = b.redirect_uris;
	if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS) {
		return err(
			400,
			'invalid_redirect_uri',
			`redirect_uris must list 1 to ${MAX_REDIRECTS} URIs`,
		);
	}
	for (const uri of uris) {
		const problem = redirectProblem(uri);
		if (problem !== undefined) return err(400, 'invalid_redirect_uri', problem);
	}
	const name =
		typeof b.client_name === 'string'
			? b.client_name.replace(/[^\x20-\x7e]/g, '').slice(0, 80)
			: undefined;
	const reg: Registration =
		name === undefined || name === '' ? { r: uris } : { r: uris, n: name };
	return {
		status: 201,
		body: {
			client_id: keyring.seal('client', reg),
			client_id_issued_at: Math.floor(now / 1000),
			redirect_uris: uris,
			...(reg.n === undefined ? {} : { client_name: reg.n }),
			// Public clients only, whatever was asked: RFC 7591 lets the server choose, and a secret
			// a client stores is a secret this server would have to be able to check.
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
		},
	};
}

function registrationOf(
	clientId: unknown,
	keyring: TokenKeyring,
	now: number,
): Registration | undefined {
	if (typeof clientId !== 'string') return undefined;
	const opened = keyring.unseal('client', clientId, now);
	if (!opened.ok) return undefined;
	const v = opened.value as Partial<Registration> | null;
	if (!Array.isArray(v?.r) || !v.r.every((u) => typeof u === 'string')) return undefined;
	return { r: v.r, ...(typeof v.n === 'string' ? { n: v.n } : {}) };
}

// ---- authorization -----------------------------------------------------------------------

/** What the consent form carries, sealed, so the POST answers exactly the GET that was shown. */
type AuthRequest = {
	readonly c: string;
	readonly r: string;
	readonly s?: string;
	readonly ch: string;
	readonly res: string;
};

export type AuthorizeStart =
	/** Shown on the gateway's own page. Never redirected: the redirect URI is not trusted yet. */
	| { readonly kind: 'fatal'; readonly message: string }
	/** The redirect URI is trusted; the error goes back to the client. */
	| { readonly kind: 'redirect'; readonly location: string }
	| {
			readonly kind: 'consent';
			/** Sealed `AuthRequest`, for the form's hidden field. */
			readonly consent: string;
			/** The host the code will be sent to. Shown on the form; the client's name never is. */
			readonly host: string;
			readonly verified: boolean;
	  };

function withParams(uri: string, params: Record<string, string | undefined>): string {
	const u = new URL(uri);
	for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
	return u.toString();
}

/** The GET of `/oauth/authorize`: validate in the order that never redirects somewhere untrusted. */
export function startAuthorize(
	q: Readonly<Record<string, string | undefined>>,
	keyring: TokenKeyring,
	origin: string,
	now: number,
): AuthorizeStart {
	const reg = registrationOf(q.client_id, keyring, now);
	if (reg === undefined) {
		return {
			kind: 'fatal',
			message: 'This sign-in link is not from a registered client. Start again from your app.',
		};
	}
	const redirect = q.redirect_uri ?? (reg.r.length === 1 ? reg.r[0] : undefined);
	if (redirect === undefined || !reg.r.includes(redirect)) {
		return {
			kind: 'fatal',
			message: 'This sign-in link sends you somewhere its client did not register.',
		};
	}
	// Errors go BACK only to a known callback. Registration is open, so redirecting an error to any
	// registered URI would make this origin an open redirector (RFC 9700 4.11.2): register
	// https://evil.example and hand out a malformed authorize link. Anyone else gets a page.
	const known = isKnownCallback(redirect);
	const back = (error: string, description: string): AuthorizeStart =>
		known
			? {
					kind: 'redirect',
					location: withParams(redirect, {
						error,
						error_description: description,
						state: q.state,
						iss: origin,
					}),
				}
			: {
					kind: 'fatal',
					message: `This sign-in link is malformed (${error}). Start again from your app.`,
				};
	if (q.state !== undefined && q.state.length > 512) {
		return back('invalid_request', 'state is longer than 512 characters');
	}
	if (q.response_type !== 'code')
		return back('unsupported_response_type', 'only response_type=code');
	if (q.code_challenge === undefined || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) {
		return back('invalid_request', 'a PKCE code_challenge is required');
	}
	if (q.code_challenge_method !== 'S256')
		return back('invalid_request', 'code_challenge_method must be S256');
	const resource = resourceOf(origin);
	if (q.resource !== undefined && q.resource.replace(/\/$/, '') !== resource) {
		return back('invalid_target', `this server issues tokens for ${resource} only`);
	}
	const request: AuthRequest = {
		c: q.client_id as string,
		r: redirect,
		...(q.state === undefined ? {} : { s: q.state }),
		ch: q.code_challenge,
		res: resource,
	};
	return {
		kind: 'consent',
		consent: keyring.seal('consent', request, now + CONSENT_TTL_MS),
		host: new URL(redirect).host,
		verified: known,
	};
}

/**
 * The POST: the user has supplied a tenant token (the caller checks it opens) and, for an
 * unverified host, confirmed it. Returns where to send the browser.
 */
export function finishAuthorize(
	consent: string,
	tenantToken: string,
	keyring: TokenKeyring,
	origin: string,
	now: number,
):
	| { readonly ok: true; readonly location: string }
	| { readonly ok: false; readonly message: string } {
	const opened = keyring.unseal('consent', consent, now);
	if (!opened.ok) {
		return {
			ok: false,
			message:
				opened.reason === 'expired'
					? 'This sign-in took too long. Start again from your app.'
					: 'This sign-in form was altered. Start again from your app.',
		};
	}
	const req = opened.value as AuthRequest;
	const code = keyring.seal(
		'code',
		{
			t: tenantToken,
			c: req.c,
			r: req.r,
			ch: req.ch,
			res: req.res,
			j: randomUUID(),
			f: randomUUID(),
		},
		now + CODE_TTL_MS,
	);
	return { ok: true, location: withParams(req.r, { code, state: req.s, iss: origin }) };
}
