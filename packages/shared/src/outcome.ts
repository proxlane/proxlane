// The outcome taxonomy and the request surface. `docs/integrations.md` sections 2 and 3 are
// the spec; this file is the executable form of it.
//
// WHY THIS IS IN `shared` AND NOT IN `adapters`. It used to be in `adapters`, and the whole
// dependency graph pointed the wrong way because of it: `shared` — the base layer, per
// CLAUDE.md — had to depend on `adapters`, a leaf, purely to name `Outcome`. Three things
// followed, and all three were real:
//
//   - `adapters` could never import `shared`. It would have been a cycle. Adapters are the
//     package we most want strangers writing, and it was the one cut off from the base layer.
//   - CODEOWNERS put the taxonomy under adapter-engineer, while the taxonomy drives failover,
//     cooldowns, HTTP status and health attribution, which are platform-engineer's.
//   - `plan.md` predicted exactly this: "moving the Outcome union into packages/adapters is
//     an ownership transfer... every future taxonomy change would become an adapter-engineer
//     review." It ended up there anyway.
//
// `adapters` re-exports everything here, so adapter authors keep importing from
// `@proxlane/adapters` and nothing about the authoring surface changed.
//
// `repo:check` assertion 20 enforces the layering, so the inversion cannot come back by
// someone adding a convenient import.

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
	| 'TARGET_RATE_LIMITED'
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
	'TARGET_RATE_LIMITED',
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
	TARGET_RATE_LIMITED: {
		// 429, not 502. The status is public surface — a caller migrating from a provider
		// already branches on 429, and this genuinely is one. Answering 502 would be a lie
		// about what happened and would break code that already handles throttling.
		httpStatus: 429,
		chargeable: false,
		// A different provider is a different egress, which is the documented remedy for a
		// rate limit. Not 'once': the whole point is to get off the exhausted IP pool.
		failover: true,
		// The DOMAIN namespace, shared across orgs. A target throttling us is a property of
		// the target, exactly like a block.
		//
		// This cooldown is the reason the outcome exists. As TARGET_ERROR it armed NOTHING, so
		// the next request repeated the whole thing immediately — and repeatedly ignoring a
		// rate limit is what turns it into a ban. Providers already retry a target 429
		// internally first (ScraperAPI for up to 60s across its pool, uncharged), so one that
		// reaches us has already outlasted that.
		cooldown: 'blk',
		pages: false,
		meaning: 'Target rate-limited us (429); backs off per domain rather than retrying',
		// The cooldown uses the standard jittered backoff, NOT the target's Retry-After.
		//
		// Whether a provider passes that header through is UNMEASURED, and the recorded
		// fixtures cannot settle it: `httpbin.dev/status/429` sends no Retry-After itself, so
		// its absence in all three recordings shows only that nothing appears when nothing is
		// sent. Honouring a header we have never seen would be guessing.
		//
		// Settling it needs a target that actually throttles with a Retry-After, which is the
		// same "record it from real traffic" gap the block corpus has — smaller, because this
		// one is at least reachable without waiting for a live incident.
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
 *   TARGET_RATE_LIMITED  the target's own throttle page, which often carries the limit and
 *                      the window in prose when it does not carry Retry-After.
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
		outcome === 'HARD_BLOCK' ||
		outcome === 'TARGET_RATE_LIMITED'
	);
}
