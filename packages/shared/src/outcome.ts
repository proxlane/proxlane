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
	/**
	 * The caller wants the body byte for byte — an image, a PDF, anything not text.
	 *
	 * Narrows the chain to providers that can actually deliver that, which is only some of them:
	 * one of the four launch providers destroys binary by decoding it as UTF-8. Without this the
	 * request goes to whoever is first, returns 200, and the body is quietly mojibake.
	 *
	 * It said TWO for a while, counting Scrapfly for wrapping bodies in a JSON envelope. The
	 * adapter decodes that envelope, so Scrapfly returns bytes intact and declares
	 * `binary: true`. The comment was measuring the provider's wire format rather than the
	 * adapter's output, which is the same mistake that set its capability wrong.
	 *
	 * NO PROVIDER SIDE EFFECT. It changes nothing about the outbound request; it is a routing
	 * constraint, which is why it lives here rather than in the translate step.
	 */
	binary?: boolean;
	/**
	 * A CSS selector the renderer must see before it snapshots the page.
	 *
	 * The gap this closes: proxlane renders, and on a late-hydrating page it returns the shell
	 * anyway, because "rendered" means the renderer ran — not that the content arrived. A caller
	 * measured 936KB with 50 results on one attempt and a 75KB empty shell on the next, from the
	 * same request. That is a race, not a capability gap, and nothing in the request could
	 * express the finish line.
	 *
	 * IMPLIES `renderJs`. A wait condition on a non-rendered fetch is meaningless — there is no
	 * renderer to wait. Rejecting the combination was the other option and it is worse: the
	 * caller's intent is unambiguous, and a 400 teaches them to send a flag they already meant.
	 * The gateway sets `renderJs` at the edge so every adapter sees a coherent request.
	 *
	 * NOT EVERY PROVIDER SELLS IT, so it narrows the chain like `binary` does. See
	 * `ProviderCapabilities.waitForSelector`.
	 */
	waitFor?: string;
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
	| 'PROVIDER_BODY_OFFLOADED'
	| 'INVALID_REQUEST'
	| 'BAD_REQUEST'
	| 'TARGET_FORBIDDEN'
	| 'NO_PROVIDER_AVAILABLE'
	| 'RESPONSE_TOO_LARGE'
	| 'BUDGET_EXCEEDED'
	| 'GATEWAY_BUSY';

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
	'PROVIDER_BODY_OFFLOADED',
	'INVALID_REQUEST',
	'BAD_REQUEST',
	'TARGET_FORBIDDEN',
	'NO_PROVIDER_AVAILABLE',
	'RESPONSE_TOO_LARGE',
	'BUDGET_EXCEEDED',
	'GATEWAY_BUSY',
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

/**
 * The stable half of the outcome contract. **This union is closed and does not grow.**
 *
 * `Outcome` is open by design: adapters come from strangers, and every new provider quirk is
 * a candidate member. But an open union is hostile to consumers — a `switch` over `Outcome`
 * with no default stops compiling the day we add one, and that is not hypothetical:
 * `TARGET_RATE_LIMITED` was added after launch. The 1.0 criterion in `plan.md` is "the outcome
 * taxonomy unchanged across two consecutive releases", which an open union can never satisfy.
 *
 * So consumers branch on the class and read the outcome for detail. Adding an outcome to an
 * existing class is then additive, and the stability promise attaches to something we can
 * actually keep. Adding a CLASS is a breaking change and needs a major.
 *
 * The classes answer "whose problem is it", because that is what a caller does next.
 */
export type OutcomeClass =
	/** Real content. Use the body. */
	| 'ok'
	/** Anti-bot stopped us. Different settings or a different provider may work. */
	| 'blocked'
	/** The site genuinely answered that way. Retrying changes nothing. */
	| 'target'
	/** The upstream provider failed us. Not the caller's fault; we failed over. */
	| 'provider'
	/** The caller asked for something malformed or not allowed. */
	| 'client'
	/** We refused or broke: our limits, our bug, or an exhausted chain. */
	| 'gateway';

export const OUTCOME_CLASSES = [
	'ok',
	'blocked',
	'target',
	'provider',
	'client',
	'gateway',
] as const satisfies readonly OutcomeClass[];

/** Same trap as OUTCOMES: `satisfies` accepts a missing member, so assert both directions. */
type _ClassesAreExhaustive = OutcomeClass extends (typeof OUTCOME_CLASSES)[number]
	? true
	: [
			'OUTCOME_CLASSES is missing a member',
			Exclude<OutcomeClass, (typeof OUTCOME_CLASSES)[number]>,
		];
const _classesExhaustive: _ClassesAreExhaustive = true;
void _classesExhaustive;

/**
 * The live site, and the only place a URL in this package is built from.
 *
 * `proxlane.dev` — the APEX, deliberately. `docs.proxlane.dev` and `api.proxlane.dev` have no
 * DNS record at all, and this package used to point at GitHub with a comment explaining that
 * the docs domain did not resolve. The docs site is live at `proxlane.dev/docs/**`; it was the
 * subdomain that never existed. Checked with `dig`, not assumed.
 */
export const DOCS_BASE = 'https://proxlane.dev';

/**
 * WHAT TO DO ABOUT IT, per class. The one question the policy fields do not answer.
 *
 * `failover` says what the GATEWAY does internally. It does not say what the CALLER should do,
 * and the two are close enough to be confused: `failover: true` on a `blocked` outcome means
 * proxlane already tried every provider, so a caller reading "it fails over" and retrying is
 * asking for the same answer at the same price. That gap is why this exists.
 *
 * Keyed by CLASS, not by outcome. The class is the closed vocabulary a caller is told to branch
 * on, and the remedy genuinely is the same for every member of one: a 404 and a target 500 are
 * both the site's own answer. Per-outcome advice would be sixteen strings restating six.
 *
 * These strings were written for the docs site and lived in `apps/web`'s outcomes route, which
 * meant the CLI — the surface written for an agent, the reader most in need of them — could not
 * reach them. One copy, here beside the taxonomy they describe.
 */
export const CLASS_ADVICE = {
	ok: { action: 'Use it', what: 'Real content that passed validation.' },
	blocked: {
		action: 'Retry later',
		what: 'Every provider was blocked. Trying again immediately will be blocked again.',
	},
	target: {
		action: 'Do not retry',
		what: 'The site itself answered. A 404 is still a 404 through another provider.',
	},
	provider: {
		action: 'Already retried',
		what: 'Proxlane failed over for you. Seeing this means the whole chain was exhausted.',
	},
	client: { action: 'Fix the request', what: 'Retrying an invalid request cannot help.' },
	gateway: { action: 'Retry later', what: 'Our side. Honour Retry-After when it is present.' },
} as const satisfies Record<OutcomeClass, { readonly action: string; readonly what: string }>;

/**
 * Where to read more about one outcome.
 *
 * Deep-links to the class heading, which is a real anchor: `/docs/outcomes` renders
 * `<h3 id={cls}>` for every member of OUTCOME_CLASSES, so every URL this can produce resolves.
 */
export function docsUrlFor(outcome: Outcome | (string & {})): string {
	return `${DOCS_BASE}/docs/outcomes#${outcomeClass(outcome)}`;
}

/** Which cooldown namespace an outcome writes to, if any. */
export type CooldownScope =
	/** Shared across orgs, keyed (provider, domain). A block is a property of the domain. */
	| 'blk'
	/** Private to one org, keyed (org, provider). A rate limit is a property of an account. */
	| 'acct'
	| 'none';

export interface OutcomePolicy {
	/**
	 * The coarse, closed class. Public surface, and the one consumers should branch on.
	 *
	 * It lives here rather than in a parallel map so that adding an outcome cannot compile
	 * until its class is decided — the same reason `httpStatus` is here.
	 */
	readonly class: OutcomeClass;
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
		class: 'ok',
		httpStatus: 'upstream',
		chargeable: true,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Real content, passed validation',
	},
	SOFT_BLOCK: {
		class: 'blocked',
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'blk',
		pages: false,
		meaning: 'our detector fired on the body; a rule ID is attached',
	},
	HARD_BLOCK: {
		class: 'blocked',
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'blk',
		pages: false,
		meaning: 'Provider says blocked or banned',
	},
	TARGET_NOT_FOUND: {
		class: 'target',
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
		class: 'target',
		httpStatus: 502,
		chargeable: false,
		failover: 'once',
		cooldown: 'none',
		pages: false,
		meaning: 'Target site 5xx or DNS dead',
	},
	TARGET_RATE_LIMITED: {
		class: 'target',
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
		class: 'provider',
		httpStatus: 504,
		chargeable: false,
		failover: true,
		cooldown: 'acct',
		pages: false,
		meaning: 'Attempt exceeded its per-attempt budget',
	},
	PROVIDER_ERROR: {
		class: 'provider',
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 5xx or infrastructure failure',
	},
	RATE_LIMITED: {
		class: 'provider',
		httpStatus: 429,
		chargeable: false,
		failover: true,
		// Their 429 is a plan concurrency cap, not a ban — respect Retry-After.
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 429 or concurrency cap',
	},
	AUTH_FAILED: {
		class: 'provider',
		httpStatus: 502,
		chargeable: false,
		failover: true,
		// Also marks the key unhealthy and notifies the user.
		cooldown: 'acct',
		pages: false,
		meaning: 'Provider 401/403 on the key',
	},
	PROVIDER_DRIFT: {
		class: 'provider',
		httpStatus: 502,
		chargeable: false,
		failover: true,
		cooldown: 'none',
		// Their API changed under us. That is worth waking someone for.
		pages: true,
		meaning: 'Response failed its Zod schema',
	},
	PROVIDER_BODY_OFFLOADED: {
		class: 'provider',
		httpStatus: 502,
		chargeable: false,
		// ANOTHER PROVIDER CAN SERVE THIS. Scrapfly offloads any body over 5 MB to a separate
		// object store and returns a URL in `content` instead — documented, permanent, and with
		// no request parameter to opt out of. The other three return the bytes, so failing over
		// is not a hopeful retry, it is the fix.
		failover: true,
		// NONE, and this is the reason the outcome exists rather than reusing PROVIDER_ERROR.
		// The provider is healthy: it served the request, billed for it, and told us plainly
		// what it did. Arming `acct` would sideline it for hours over one large page and
		// degrade every small request it handles perfectly well.
		cooldown: 'none',
		// Nor PROVIDER_DRIFT, which fits in every other respect and pages. This is documented
		// behaviour we did not handle, not a contract break, and paging on every large fetch
		// forever is how a pager stops being read.
		pages: false,
		meaning: 'the provider stored the body out of band and returned a pointer we cannot follow',
	},
	INVALID_REQUEST: {
		class: 'gateway',
		httpStatus: 500,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		// OUR translation produced a bad provider request. A real bug.
		pages: true,
		meaning: 'Our translation produced a provider 400',
	},
	BAD_REQUEST: {
		class: 'client',
		httpStatus: 400,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: "The client's request is malformed or impossible",
	},
	TARGET_FORBIDDEN: {
		class: 'client',
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
		class: 'gateway',
		httpStatus: 503,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'No adapter matches the capability, or the chain is exhausted',
	},
	RESPONSE_TOO_LARGE: {
		class: 'gateway',
		httpStatus: 413,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Body exceeded the cap; see operations.md section 1',
	},
	BUDGET_EXCEEDED: {
		class: 'gateway',
		httpStatus: 504,
		chargeable: false,
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'Global deadline or cost budget hit',
	},
	// DISTINCT FROM `RATE_LIMITED`, and the distinction is the whole reason this member
	// exists. `RATE_LIMITED` is class `provider`: a provider refused US, it writes an `acct`
	// cooldown, and it fails over — trying someone else is exactly right when one provider
	// caps us. Reusing it for our own capacity ceiling would be wrong three times over: it
	// would blame a provider for a fact about this process, write a cooldown against an
	// account that did nothing, and fail over to another provider because WE are full, which
	// spends the budget backpressure exists to protect.
	//
	// Class is `gateway`, which already existed, so `OutcomeClass` does not grow and no
	// caller's switch breaks — the property the closed class was designed for.
	GATEWAY_BUSY: {
		class: 'gateway',
		httpStatus: 429,
		chargeable: false,
		// Never. The request is shed BEFORE a provider is chosen, so there is no next hop to
		// try; the chain does not run at all. Retrying is the client's job, and `Retry-After`
		// is how we ask for it.
		failover: false,
		cooldown: 'none',
		pages: false,
		meaning: 'In-flight ceiling reached; the gateway shed this request rather than queue it',
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
 * The stable class for an outcome. Prefer this over matching on `Outcome` directly.
 *
 * Accepts a plain string, deliberately. A consumer holding an `X-Outcome` header from a
 * newer gateway than its SDK will pass a member it does not know about, and the honest
 * answer is `gateway` rather than a crash — unknown-to-us is our problem, not the caller's.
 */
export function outcomeClass(outcome: Outcome | (string & {})): OutcomeClass {
	return (FAILOVER as Record<string, OutcomePolicy | undefined>)[outcome]?.class ?? 'gateway';
}

/** Every outcome in a class. Ordered as `OUTCOMES` is, so output is stable. */
export function outcomesInClass(cls: OutcomeClass): readonly Outcome[] {
	return OUTCOMES.filter((o) => FAILOVER[o].class === cls);
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
