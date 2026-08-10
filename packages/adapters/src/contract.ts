// The adapter contract. `docs/integrations.md` sections 2, 3 and 4 are the spec; this file
// is the executable form of it.
//
// Two properties everything else rests on:
//
//   1. `translate` and `parse` are PURE. All I/O goes through one shared HttpTransport
//      owned by the gateway. That is what makes the test strategy possible — pure
//      functions test against recorded bytes, the transport is tested separately, and no
//      provider class is ever mocked.
//   2. Failover behaviour is defined ONCE, per outcome, centrally (FAILOVER below). An
//      adapter maps a response to an outcome and stops. Retry logic inside an adapter
//      means the taxonomy is missing a case; add the case.

// ---------------------------------------------------------------- request

export type PremiumTier = 'none' | 'residential' | 'stealth';

export interface GatewayRequest {
	url: string;
	method: 'GET' | 'POST';
	body?: string;
	/** Explicit, never defaulted — provider defaults must not leak through. */
	renderJs: boolean;
	/** ISO 3166-1 alpha-2. */
	countryCode?: string;
	premium: PremiumTier;
	sessionId?: string;
	headers?: Record<string, string>;
	/** Global. The router derives per-attempt budgets from it; see section 5. */
	deadlineMs: number;
}

// ---------------------------------------------------------------- outcomes

/**
 * Everything an attempt can produce maps to exactly one of these.
 *
 * Ordered as in `integrations.md` section 3 so the two can be diffed by eye.
 */
export type Outcome =
	| 'OK'
	| 'SOFT_BLOCK'
	| 'HARD_BLOCK'
	| 'TARGET_NOT_FOUND'
	| 'TARGET_ERROR'
	| 'PROVIDER_TIMEOUT'
	| 'PROVIDER_ERROR'
	| 'RATE_LIMITED'
	| 'AUTH_FAILED'
	| 'PROVIDER_DRIFT'
	| 'INVALID_REQUEST'
	| 'BAD_REQUEST'
	| 'TARGET_FORBIDDEN'
	| 'NO_PROVIDER_AVAILABLE'
	| 'RESPONSE_TOO_LARGE'
	| 'BUDGET_EXCEEDED';

export const OUTCOMES = [
	'OK',
	'SOFT_BLOCK',
	'HARD_BLOCK',
	'TARGET_NOT_FOUND',
	'TARGET_ERROR',
	'PROVIDER_TIMEOUT',
	'PROVIDER_ERROR',
	'RATE_LIMITED',
	'AUTH_FAILED',
	'PROVIDER_DRIFT',
	'INVALID_REQUEST',
	'BAD_REQUEST',
	'TARGET_FORBIDDEN',
	'NO_PROVIDER_AVAILABLE',
	'RESPONSE_TOO_LARGE',
	'BUDGET_EXCEEDED',
] as const satisfies readonly Outcome[];

/**
 * `satisfies readonly Outcome[]` rejects a WRONG member but happily accepts a MISSING one,
 * and the invariant tests iterate OUTCOMES — so a forgotten entry would silently narrow
 * what they check. This errors instead.
 */
type _OutcomesAreExhaustive = Outcome extends (typeof OUTCOMES)[number]
	? true
	: ['OUTCOMES is missing a member of Outcome', Exclude<Outcome, (typeof OUTCOMES)[number]>];
const _outcomesExhaustive: _OutcomesAreExhaustive = true;
void _outcomesExhaustive;

/** Which cooldown namespace an outcome writes to, if any. */
export type CooldownScope =
	/** Shared across orgs, keyed (provider, domain). A block is a property of the domain. */
	| 'blk'
	/** Private to one org, keyed (org, provider). A rate limit is a property of an account. */
	| 'acct'
	| 'none';

export interface OutcomePolicy {
	/** Status the client sees. Drop-in compatibility makes this public surface. */
	readonly httpStatus: number | 'upstream';
	/** Hosted billing only ever charges on OK. */
	readonly chargeable: boolean | 'provider-dependent';
	readonly failover: boolean | 'once';
	readonly cooldown: CooldownScope;
	/** Wakes a human. Reserved for our bugs and provider contract breaks. */
	readonly pages: boolean;
	readonly meaning: string;
}

/**
 * Failover semantics, defined centrally and never inside an adapter.
 *
 * `satisfies` rather than a plain annotation so a missing outcome is a compile error —
 * adding a member to `Outcome` without deciding its policy should not compile.
 */
export const FAILOVER = {
	OK: {
		httpStatus: 'upstream',
		chargeable: true,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Real content, passed validation',
	},
	SOFT_BLOCK: {
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'blk',
		pages: false,
		meaning: '200 but our detector fired; a rule ID is attached',
	},
	HARD_BLOCK: {
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'blk',
		pages: false,
		meaning: 'Provider says blocked or banned',
	},
	TARGET_NOT_FOUND: {
		httpStatus: 404,
		chargeable: 'provider-dependent',
		// A real 404 on provider A is a real 404 on provider B. Retrying burns money —
		// ScraperAPI charges for 404s.
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Genuine 404, unless the provider has retry_404 semantics',
	},
	TARGET_ERROR: {
		httpStatus: 502,
		chargeable: false,
		failover: 'once',
		cooldown: 'none',
		pages: false,
		meaning: 'Target site 5xx or DNS dead',
	},
	PROVIDER_TIMEOUT: {
		httpStatus: 504,
		chargeable: false,
		failover: true,
		cooldown: 'acct',
		pages: false,
		meaning: 'Attempt exceeded its per-attempt budget',
	},
	PROVIDER_ERROR: {
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 5xx or infrastructure failure',
	},
	RATE_LIMITED: {
		httpStatus: 429,
		chargeable: false,
		failover: true,
		// Their 429 is a plan concurrency cap, not a ban — respect Retry-After.
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 429 or concurrency cap',
	},
	AUTH_FAILED: {
		httpStatus: 502,
		chargeable: false,
		failover: true,
		// Also marks the key unhealthy and notifies the user.
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 401/403 on the key',
	},
	PROVIDER_DRIFT: {
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'none',
		// Their API changed under us. That is worth waking someone for.
		pages: true,
		meaning: 'Response failed its Zod schema',
	},
	INVALID_REQUEST: {
		httpStatus: 500,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		// OUR translation produced a bad provider request. A real bug.
		pages: true,
		meaning: 'Our translation produced a provider 400',
	},
	BAD_REQUEST: {
		httpStatus: 400,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: "The client's request is malformed or impossible",
	},
	TARGET_FORBIDDEN: {
		httpStatus: 403,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		// Distinct from BAD_REQUEST so abuse is measurable — and so nobody can page the
		// on-call with a single curl at http://localhost:8080.
		pages: false,
		meaning: 'Target rejected at our edge: private range, denylist, metadata address',
	},
	NO_PROVIDER_AVAILABLE: {
		httpStatus: 503,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'No adapter matches the capability, or the chain is exhausted',
	},
	RESPONSE_TOO_LARGE: {
		httpStatus: 413,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Body exceeded the cap; see operations.md section 1',
	},
	BUDGET_EXCEEDED: {
		httpStatus: 504,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Global deadline or cost budget hit',
	},
} as const satisfies Record<Outcome, OutcomePolicy>;

// ---------------------------------------------------------------- cost

/** 1 credit = 1_000_000 microcredits. Integer arithmetic; never floats for money. */
export type Microcredits = number;
export const MICROCREDITS_PER_CREDIT = 1_000_000;

export interface CostTable {
	/** ISO date. A table without one cannot be audited against a provider's price change. */
	readonly effectiveDate: string;
	/** Where the numbers came from. */
	readonly sourceUrl: string;
	readonly base: Microcredits;
	readonly multipliers: {
		readonly renderJs?: number;
		readonly premium?: Partial<Record<PremiumTier, number>>;
		/** Providers price some domains differently; keyed by registrable domain. */
		readonly domain?: Readonly<Record<string, number>>;
	};
}

// ------------------------------------------------------- capabilities

export type ProviderId = string;

export interface ProviderCapabilities {
	readonly id: ProviderId;
	readonly renderJs: boolean;
	readonly countryCodes: ReadonlySet<string> | 'all';
	readonly premiumTiers: ReadonlySet<PremiumTier>;
	readonly sessions: boolean;
	/** Budget on the LAST hop, e.g. scraperapi 75_000. */
	readonly maxTimeoutMs: number;
	/** Budget on a non-terminal hop, e.g. scraperapi 22_000. */
	readonly fastTimeoutMs: number;
	readonly post: boolean;
	readonly costTable: CostTable;
}

// ---------------------------------------------------------------- wire

export interface ProviderHttpRequest {
	readonly url: string;
	readonly method: 'GET' | 'POST';
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	/** Per-attempt, derived by the router. The adapter does not choose it. */
	readonly timeoutMs: number;
}

export interface ProviderHttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	/**
	 * Wire bytes: after transfer-decoding, before charset decoding.
	 *
	 * undici has already handled `content-encoding`, so `parse` never sees gzip. Charset
	 * decoding has NOT happened — a page declaring Shift_JIS in a `<meta>` tag is still
	 * raw here, which is the only way `/detect` can fingerprint it without mojibake.
	 */
	readonly body: Uint8Array;
}

export interface ParsedResult {
	readonly outcome: Outcome;
	readonly body?: Uint8Array;
	readonly contentType?: string;
	/** Resolution order: response header, then `<meta>` sniff, then provider default. */
	readonly charset?: string;
	readonly upstreamStatusCode?: number;
	readonly cost: {
		readonly microcredits: Microcredits;
		readonly source: 'reported' | 'estimated';
	};
}

// NOTE: there is deliberately no `detectRuleId` here, and `parse` can never return
// SOFT_BLOCK.
//
// Detection is one shared step OUTSIDE adapters — `/detect` receives `(bytes, charset)`
// and decodes for itself. A pure `parse` has not run the detector and cannot know a rule
// fired. HARD_BLOCK is different: the provider says so in the response, so an adapter can
// return it. SOFT_BLOCK and its rule id are assigned by the gateway after detection runs.

/**
 * Assembled by the transport, not by the adapter.
 *
 * `latencyMs` and `providerRequestId` live here rather than on ParsedResult because a pure
 * function cannot measure elapsed time. Put them on the result and the first implementer
 * passes a clock into `parse`, and the purity the test strategy depends on quietly ends.
 */
export interface Exchange {
	readonly result: ParsedResult;
	readonly latencyMs: number;
	readonly providerRequestId?: string;
	/** Sanitized request/response, for logging and fixtures. Never contains a key. */
	readonly raw: RawExchange;
}

export interface RawExchange {
	/**
	 * Headers are REDACTED, not raw: the provider key travels in a header or query string
	 * and this shape is written to logs and fixtures. The recorder sanitizes, CI scans, and
	 * neither can be relied on alone — see the house rule on fixtures.
	 */
	readonly request: ProviderHttpRequest;
	readonly response: {
		readonly status: number;
		readonly headers: Readonly<Record<string, string>>;
		readonly bodyBytes: number;
	};
}

// ---------------------------------------------------------------- adapter

export interface Adapter {
	readonly capabilities: ProviderCapabilities;
	/** Pure. Must set every parameter explicitly — provider defaults never leak. */
	translate(req: GatewayRequest, key: string): ProviderHttpRequest;
	/** Pure. Parse with a Zod schema; a parse failure is PROVIDER_DRIFT, never a cast. */
	parse(res: ProviderHttpResponse): ParsedResult;
}

// ---------------------------------------------------------------- helpers

export function policyFor(outcome: Outcome): OutcomePolicy {
	return FAILOVER[outcome];
}

/** Does the chain continue after this outcome? `'once'` is the caller's to track. */
export function shouldFailover(outcome: Outcome): boolean {
	return FAILOVER[outcome].failover !== false;
}

export function cooldownScope(outcome: Outcome): CooldownScope {
	return FAILOVER[outcome].cooldown;
}

/**
 * Does this outcome carry the page body back to the caller?
 *
 * Defined ONCE here rather than decided per adapter, for the same reason FAILOVER is: the
 * three launch adapters each re-implemented it inline and had already drifted — ScraperAPI
 * returned a body for TARGET_ERROR while the other two did not, so the same outcome meant
 * different things depending on which provider happened to serve the request. A caller
 * cannot write correct code against that.
 *
 * The rule is: a body travels when the bytes ARE the answer.
 *
 *   OK                 the content, obviously.
 *   TARGET_NOT_FOUND   a real 404 page is a real answer, passed through with its status.
 *   SOFT_BLOCK         the 200 that fired the detector. The gateway assigns this outcome,
 *                      never an adapter, but it carries a body and /detect's corpus grows
 *                      from exactly these.
 *   HARD_BLOCK         the provider's block page — the thing you need to SEE to work out
 *                      why you are blocked.
 *
 * Everything else is a failure whose body is a provider error page or empty. The caller
 * receives FAILOVER's httpStatus, not the upstream page, so passing bytes through would be
 * handing over an artefact of a hop they were never told about.
 */
export function carriesBody(outcome: Outcome): boolean {
	return (
		outcome === 'OK' ||
		outcome === 'TARGET_NOT_FOUND' ||
		outcome === 'SOFT_BLOCK' ||
		outcome === 'HARD_BLOCK'
	);
}
