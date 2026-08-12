// One error shape for every non-2xx the gateway returns.
//
// There used to be two. Auth and validation answered `{error, message}` while a failed scrape
// answered `{outcome, class, reason, attempts}`, so a client had to work out which SHAPE it
// had before it could read the error at all. That is the kind of thing everyone wraps once
// and then resents, and it is free to fix at 0.x and expensive after anyone integrates.
//
// The envelope is the same open/closed pair as the headers: `class` is closed and safe to
// branch on, `code` is open and carries the detail.

import type { Outcome, OutcomeClass } from './outcome.js';
import { FAILOVER } from './outcome.js';

/**
 * Failures that are NOT outcomes, because they never became a scrape.
 *
 * The taxonomy describes what happened to an attempt against a provider. A request rejected
 * for a bad gateway key never reached one, and reusing `AUTH_FAILED` for it would file gateway
 * auth failures under provider health — the provider was never asked.
 *
 * Kept deliberately tiny. Anything describing a real attempt belongs in `Outcome`.
 */
export const GATEWAY_ERROR_CODES = {
	/** The caller's gateway key is missing or wrong. */
	UNAUTHORIZED: 'client',
	/** The endpoint exists but this deployment runs without the subsystem behind it. */
	NOT_ENABLED: 'gateway',
} as const satisfies Record<string, OutcomeClass>;

export type GatewayErrorCode = keyof typeof GATEWAY_ERROR_CODES;

/** Everything that can appear as `error.code`. Open, like `Outcome`. */
export type ErrorCode = Outcome | GatewayErrorCode;

/**
 * Where a caller is sent to understand a code.
 *
 * The GitHub source rather than `docs.proxlane.dev`, because that domain does not resolve and
 * `README.md` says so in its second line. Emitting a dead link on every single failure is
 * worse than emitting none — it is a broken promise repeated at request rate. Swap the
 * default when the docs site is actually live; `AppDeps.docsUrl` overrides it meanwhile.
 */
export const DEFAULT_DOCS_URL =
	'https://github.com/proxlane/proxlane/blob/main/docs/integrations.md#3-error-taxonomy-and-failover-semantics';

export interface ErrorBody {
	/** Always present, on every response. The join key to the request log and to support. */
	readonly requestId: string;
	readonly error: {
		readonly code: ErrorCode;
		/** Closed. Branch on this. */
		readonly class: OutcomeClass;
		readonly message: string;
		readonly docs: string;
	};
	/** Present only when providers were actually tried. The logged grain is the attempt. */
	readonly attempts?: readonly unknown[];
}

/**
 * The class for any error code, outcome or not.
 *
 * Falls back to `gateway` for a code this build has never heard of, matching `outcomeClass`:
 * an SDK older than the gateway must degrade rather than throw.
 */
export function errorClassFor(code: ErrorCode | (string & {})): OutcomeClass {
	if (code in GATEWAY_ERROR_CODES) {
		return GATEWAY_ERROR_CODES[code as GatewayErrorCode];
	}
	return (
		(FAILOVER as Record<string, { class: OutcomeClass } | undefined>)[code]?.class ?? 'gateway'
	);
}

export function errorBody(args: {
	readonly requestId: string;
	readonly code: ErrorCode;
	readonly message: string;
	readonly docsUrl?: string;
	readonly attempts?: readonly unknown[];
}): ErrorBody {
	return {
		requestId: args.requestId,
		error: {
			code: args.code,
			class: errorClassFor(args.code),
			message: args.message,
			docs: args.docsUrl ?? DEFAULT_DOCS_URL,
		},
		...(args.attempts === undefined ? {} : { attempts: args.attempts }),
	};
}
