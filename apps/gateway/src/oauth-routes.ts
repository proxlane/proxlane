// The remote MCP endpoint and the authorization server's routes, mounted only in hosted mode with
// `PROXLANE_PUBLIC_URL` set. `plan.md` section 2. The logic is in `oauth.ts` and `oauth-token.ts`;
// this file is HTTP.
//
// `/mcp` IS THE `fetch_page` SERVER FROM `@proxlane/sdk`, the same one `npx @proxlane/sdk` runs over
// stdio, here over Streamable HTTP and stateless. It calls this gateway's own `/v1` IN PROCESS with
// the tenant token from the grant, so every limit, refusal and log line in `/v1` applies unchanged.
// The caller's address travels in the server bindings of that internal request, which no external
// request can set, so the per-address limits still see the real caller rather than this process.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from '@proxlane/sdk';
import { sealToken, TOKEN_PREFIX, type TokenKeyring } from '@proxlane/shared/token';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { connectedPage, consentPage, fatalPage, PAGE_HEADERS } from './consent-page.js';
import type { GrantStore } from './grant-store.js';
import {
	authorizationServerMetadata,
	finishAuthorize,
	isKnownCallback,
	protectedResourceMetadata,
	register,
	startAuthorize,
} from './oauth.js';
import { exchange, familyOf, verifyAccess } from './oauth-token.js';
import type { Tenancy } from './tenant.js';

export interface OAuthDeps {
	/** The gateway's public origin, e.g. `https://api.example.com`. The issuer, exactly. */
	readonly origin: string;
	readonly grants: GrantStore;
}

/** The binding an in-process request carries its caller's address in. See the header. */
export interface InternalBindings {
	readonly proxlaneAddress?: string;
}

const CORS = { 'Access-Control-Allow-Origin': '*' } as const;
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' } as const;

export function mountOAuth(
	// biome-ignore lint/suspicious/noExplicitAny: the app's own Vars, which this file does not read
	app: Hono<any>,
	tenancy: Tenancy,
	oauth: OAuthDeps,
	addressOf: (c: Context) => string,
): void {
	const { origin, grants } = oauth;

	// Bounded before any body is read: these routes take no key, and `maxBodyBytes` guards `/v1` only.
	const tooLarge = (c: Context) =>
		c.json({ error: 'invalid_request', error_description: 'body too large' }, 413);
	app.use('/oauth/*', bodyLimit({ maxSize: 16 * 1024, onError: tooLarge }));
	app.use('/mcp', bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }));
	const keyring: TokenKeyring = tenancy.keyring;

	/** The same per-address budget as `/v1`, under its own prefix: sign-in is not free either. */
	// Keyed on the grant when there is one: a vendor's users all arrive from the vendor's addresses.
	const limited = async (c: Context, key = `oauth:${addressOf(c)}`) => {
		const d = await tenancy.addressLimit.take(key, Date.now());
		return d.ok ? undefined : Math.ceil(d.retryAfterMs / 1000);
	};

	// ---- discovery, open and cacheable ------------------------------------------------------
	const resourceMeta = (c: Context) => c.json(protectedResourceMetadata(origin), 200, CORS);
	app.get('/.well-known/oauth-protected-resource', resourceMeta);
	app.get('/.well-known/oauth-protected-resource/mcp', resourceMeta);
	app.get('/.well-known/oauth-authorization-server', (c) =>
		c.json(authorizationServerMetadata(origin), 200, CORS),
	);

	// ---- registration -----------------------------------------------------------------------
	app.post('/oauth/register', async (c) => {
		const wait = await limited(c);
		if (wait !== undefined)
			return c.json({ error: 'slow_down' }, 429, { ...CORS, 'Retry-After': String(wait) });
		const body = await c.req.json().catch(() => undefined);
		const r = register(body, keyring, Date.now());
		return c.json(r.body, r.status as 201, { ...CORS, ...NO_STORE });
	});

	// ---- authorization ----------------------------------------------------------------------
	app.get('/oauth/authorize', (c) => {
		const start = startAuthorize(c.req.query(), keyring, origin, Date.now());
		if (start.kind === 'redirect') return c.redirect(start.location, 302);
		if (start.kind === 'fatal') return c.body(fatalPage(start.message), 400, PAGE_HEADERS);
		return c.body(consentPage(start), 200, PAGE_HEADERS);
	});

	app.post('/oauth/authorize', async (c) => {
		const form = await c.req.parseBody();
		const consent = typeof form.consent === 'string' ? form.consent : '';
		const request = keyring.unseal('consent', consent, Date.now());
		if (!request.ok)
			return c.body(
				fatalPage('This sign-in form expired or was altered. Start again from your app.'),
				400,
				PAGE_HEADERS,
			);
		const redirect = (request.value as { r: string }).r;
		const host = new URL(redirect).host;
		const verified = isKnownCallback(redirect);
		const again = (error: string, status: 400 | 429 = 400) =>
			c.body(consentPage({ consent, host, verified, error }), status, PAGE_HEADERS);

		if ((await limited(c)) !== undefined)
			return again('Too many attempts from here. Wait a minute and try again.', 429);
		if (!verified && form.confirm !== host)
			return again(`Tick the box to confirm you started this from ${host}.`);

		// A token pasted as is, or one sealed here from the keys: the gateway sees keys on every
		// request anyway, so sealing them server-side gives nothing away the design kept back.
		let token = typeof form.token === 'string' ? form.token.trim() : '';
		if (token === '') {
			const keys = Object.fromEntries(
				Object.entries(form).flatMap(([k, v]) =>
					k.startsWith('key_') && typeof v === 'string' && v.trim() !== ''
						? [[k.slice(4), v]]
						: [],
				),
			);
			if (Object.keys(keys).length === 0)
				return again('Add a key for at least one provider, or paste a token.');
			try {
				token = await sealToken({ keys }, keyring.publicKey);
			} catch (err) {
				return again(err instanceof Error ? err.message : 'Those keys could not be sealed.');
			}
		}
		if (!token.startsWith(TOKEN_PREFIX)) return again('That is not a proxlane token.');
		const opened = keyring.open(token);
		if (!opened.ok)
			return again(
				'That token does not open on this gateway. Make a new one, or paste your keys instead.',
			);
		if (tenancy.denied.has(opened.id)) return again('That token has been revoked.');

		const done = finishAuthorize(consent, token, keyring, origin, Date.now());
		if (!done.ok) return c.body(fatalPage(done.message), 400, PAGE_HEADERS);
		return c.body(
			connectedPage({ location: done.location, host, tokenId: opened.id }),
			200,
			PAGE_HEADERS,
		);
	});

	// ---- tokens -----------------------------------------------------------------------------
	app.options('/oauth/token', (c) =>
		c.body(null, 204, {
			...CORS,
			'Access-Control-Allow-Methods': 'POST',
			'Access-Control-Allow-Headers': 'content-type',
		}),
	);
	app.post('/oauth/token', async (c) => {
		const type = c.req.header('content-type') ?? '';
		const raw = type.includes('json')
			? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
			: await c.req.parseBody();
		const form = Object.fromEntries(
			Object.entries(raw).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
		) as Record<string, string>;
		const family = familyOf(form, keyring, Date.now());
		const wait = await limited(c, family === undefined ? undefined : `grant:${family}`);
		if (wait !== undefined)
			return c.json({ error: 'slow_down' }, 429, { ...CORS, 'Retry-After': String(wait) });
		const r = await exchange(form, {
			keyring,
			grants,
			isRevoked: (t) => {
				const o = keyring.open(t);
				return !o.ok || tenancy.denied.has(o.id);
			},
			origin,
			now: Date.now(),
		});
		return c.json(r.body, r.status as 200, { ...CORS, ...NO_STORE });
	});

	// ---- the MCP endpoint -------------------------------------------------------------------
	app.on(['GET', 'DELETE'], '/mcp', (c) =>
		c.json({ error: 'this MCP server is stateless: POST only' }, 405, { Allow: 'POST' }),
	);
	app.post('/mcp', async (c) => {
		let access: Awaited<ReturnType<typeof verifyAccess>>;
		try {
			access = await verifyAccess(c.req.header('authorization'), {
				keyring,
				grants,
				origin,
				now: Date.now(),
			});
		} catch {
			return c.json({ error: 'temporarily_unavailable' }, 503, { 'Retry-After': '5' });
		}
		if (!access.ok) {
			return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': access.challenge });
		}
		// THE GRANT, not the address, is who this is: every claude.ai or ChatGPT user calls from the
		// vendor's addresses, so per-address limits would make one user's dead key everyone's outage.
		// The bearer is verified already, so the caller cannot choose the family.
		const bindings: InternalBindings = { proxlaneAddress: `grant:${access.family}` };
		const server = createServer({
			gatewayUrl: origin,
			apiKey: access.tenantToken,
			fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init), bindings)),
		});
		// No session id generator: stateless, one transport per request.
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});
}
