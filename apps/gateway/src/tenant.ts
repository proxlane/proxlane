// Hosted mode: a request that carries a tenant token instead of the gateway key.
//
// `plan.md` section 2, "Hosted BYOK". The token IS the tenant: the user's provider keys and
// their order, sealed to this gateway's public key, with no row behind it. So resolving one is
// the whole of hosted auth, and it happens here, before anything else about the request.
//
// THE ORDER OF REFUSALS IS THE SECURITY DESIGN, and `resolveTenant` keeps it in one place:
//
//   1. the source address limit, BEFORE the token is opened. Opening one that names a real kid
//      costs an X25519 operation, and the kid is public, so garbage would otherwise buy CPU.
//   2. opening, and the five ways it can fail.
//   3. the denylist, by token id. A thief cannot reseal a stolen box to escape it.
//   4. the per-key limit. NOT on the token id: the owner of a set of keys can seal them again
//      for a fresh id on every request, so only the credential hash is stable.
//
// Self-host never reaches this file. Its operator key is a different credential class, decided
// in `app.ts` by the shape of what was presented.

import type { Adapter } from '@proxlane/adapters';
import type { TokenKeyring, TokenPayload, TokenRefusal } from '@proxlane/shared/token';
import type { RateLimiter } from './rate-limit.js';

export interface Tenancy {
	readonly keyring: TokenKeyring;
	/** Every adapter this gateway ships, by id, whether or not the operator holds a key for it. */
	readonly adapters: ReadonlyMap<string, Adapter>;
	/** The gateway's provider order, used when a token does not carry its own. */
	readonly order: readonly string[];
	/** Token ids refused outright. `PROXLANE_TOKEN_DENY`. */
	readonly denied: ReadonlySet<string>;
	/** Per source address, before opening. */
	readonly addressLimit: RateLimiter;
	/** Per provider key, after opening. */
	readonly credentialLimit: RateLimiter;
}

export type Candidate = { adapter: Adapter; key: string; account: string };

export type TenantResolution =
	| { readonly ok: true; readonly id: string; readonly candidates: readonly Candidate[] }
	| {
			readonly ok: false;
			readonly status: 401 | 429;
			readonly code: 'UNAUTHORIZED' | 'TOO_MANY_REQUESTS';
			readonly message: string;
			/** For the log: why, in one word, without the token. */
			readonly why: TokenRefusal | 'denied' | 'address-limit' | 'key-limit';
			/** Present on a 429. */
			readonly retryAfterMs?: number;
			/** Present once the token opened, so a refused request is still attributable. */
			readonly id?: string;
	  };

/**
 * What a caller is told for each refusal. Every one says what to do, and none echoes the token:
 * these reach the response body, and a body gets pasted into an issue.
 */
const REFUSED: Record<TokenRefusal, string> = {
	malformed: 'not a proxlane token: expected pxl1_ followed by a key id and the sealed keys',
	'unknown-key':
		'this token was sealed to a key this gateway no longer holds. Make a new one on the connect page',
	unreadable: 'this token has been altered and does not open. Copy it again, or make a new one',
	invalid:
		'this token opened but its contents are not valid. Make a new one on the connect page',
	unsupported:
		'this token asks for a restriction this gateway cannot enforce yet, so it was refused rather than served without it',
};

/**
 * The chain's candidates for a token, in the order it asks for.
 *
 * The token's own `order` first, else the gateway's; then every other provider it holds a key for,
 * in the gateway's order. That mirrors self-host's `PROXLANE_PROVIDER_ORDER`, where anything
 * unnamed keeps its place behind the named ones.
 *
 * A provider this gateway does not ship is DROPPED, not refused. The connect page can be newer
 * than the gateway, and a token naming a provider added since must still route on the rest.
 */
export function candidatesFor(
	payload: TokenPayload,
	credentials: Readonly<Record<string, string>>,
	tenancy: Pick<Tenancy, 'adapters' | 'order'>,
): Candidate[] {
	const keyed = (id: string) => Object.hasOwn(payload.keys, id) && tenancy.adapters.has(id);
	const first = (payload.order ?? tenancy.order).filter(keyed);
	const rest = tenancy.order.filter((id) => keyed(id) && !first.includes(id));
	return [...first, ...rest].map((id) => ({
		adapter: tenancy.adapters.get(id) as Adapter,
		key: payload.keys[id] as string,
		// PREFIXED, so a tenant account can never equal `self` or an operator's PROXLANE_ORG_ID
		// and share their cooldowns. The hash is already keyed with the gateway's secret.
		account: `t.${credentials[id]}`,
	}));
}

/** The request's candidates if its token is good and within its limits, else why not. */
export async function resolveTenant(
	token: string,
	address: string,
	tenancy: Tenancy,
	now: number,
): Promise<TenantResolution> {
	const byAddress = await tenancy.addressLimit.take(address, now);
	if (!byAddress.ok) {
		return {
			ok: false,
			status: 429,
			code: 'TOO_MANY_REQUESTS',
			message: `over ${tenancy.addressLimit.rate.limit} requests a minute from this address; retry after the window`,
			why: 'address-limit',
			retryAfterMs: byAddress.retryAfterMs,
		};
	}

	const opened = tenancy.keyring.open(token, now);
	if (!opened.ok) {
		return {
			ok: false,
			status: 401,
			code: 'UNAUTHORIZED',
			message: REFUSED[opened.reason],
			why: opened.reason,
		};
	}
	if (tenancy.denied.has(opened.id)) {
		return {
			ok: false,
			status: 401,
			code: 'UNAUTHORIZED',
			message:
				'this token has been revoked. Make a new one, and rotate any provider key it held',
			why: 'denied',
			id: opened.id,
		};
	}

	const candidates = candidatesFor(opened.payload, opened.credentials, tenancy);
	// Every key the request could spend, not only the first: a token can list one real key among
	// junk, and the real one is what the limit protects.
	let wait = 0;
	for (const c of candidates) {
		const d = await tenancy.credentialLimit.take(c.account, now);
		if (!d.ok) wait = Math.max(wait, d.retryAfterMs);
	}
	if (wait > 0) {
		return {
			ok: false,
			status: 429,
			code: 'TOO_MANY_REQUESTS',
			message: `over ${tenancy.credentialLimit.rate.limit} requests a minute on a provider key in this token; retry after the window`,
			why: 'key-limit',
			retryAfterMs: wait,
			id: opened.id,
		};
	}
	return { ok: true, id: opened.id, candidates };
}
