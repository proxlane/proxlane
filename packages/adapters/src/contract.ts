// The adapter contract. `docs/integrations.md` sections 2, 3 and 4 are the spec; this file
// is the executable form of it.
//
// Two properties everything else rests on:
//
//   1. `translate` and `parse` are PURE. All I/O goes through one shared HttpTransport
//      owned by the gateway. That is what makes the test strategy possible — pure
//      functions test against recorded bytes, the transport is tested separately, and no
//      provider class is ever mocked.
//   2. Failover behaviour is defined ONCE, per outcome, centrally. An adapter maps a
//      response to an outcome and stops. Retry logic inside an adapter means the taxonomy is
//      missing a case; add the case.
//
// The taxonomy itself lives in `@proxlane/shared` and is re-exported below, so an adapter
// author imports everything from `@proxlane/adapters` and never needs to know. See
// `packages/shared/src/outcome.ts` for why it is not defined here.

export type { ErrorBody, ErrorCode, GatewayErrorCode } from '@proxlane/shared/error-body';
export {
	DEFAULT_DOCS_URL,
	errorBody,
	errorClassFor,
	GATEWAY_ERROR_CODES,
} from '@proxlane/shared/error-body';
export type {
	CooldownScope,
	GatewayRequest,
	Outcome,
	OutcomeClass,
	OutcomePolicy,
	PremiumTier,
} from '@proxlane/shared/outcome';
export {
	CLASS_ADVICE,
	carriesBody,
	cooldownScope,
	DOCS_BASE,
	docsUrlFor,
	FAILOVER,
	OUTCOME_CLASSES,
	OUTCOMES,
	outcomeClass,
	outcomesInClass,
	policyFor,
	shouldFailover,
} from '@proxlane/shared/outcome';

import type { GatewayRequest, Outcome, PremiumTier } from '@proxlane/shared/outcome';

// ---------------------------------------------------------------- cost

/** 1 credit = 1_000_000 microcredits. Integer arithmetic; never floats for money. */
export type Microcredits = number;
export const MICROCREDITS_PER_CREDIT = 1_000_000;

/**
 * WHAT A COST NUMBER IS DENOMINATED IN, and it has to be declared because the four launch
 * providers do not agree.
 *
 * Three of them sell credits and one sells requests for dollars, so there is no shared native
 * unit — and for a while the field pretended otherwise. Measured on the live gateway: a plain
 * fetch reported `1.000000` from ScraperAPI and `0.001500` from Bright Data. Those look like the
 * same unit three orders of magnitude apart. They are not the same unit at all: one is a
 * ScraperAPI credit, the other is fifteen hundredths of a US cent.
 *
 * Two things that broke, one of them already visible to callers:
 *
 *   `X-Cost-Estimate` sums every attempt in a chain, so a request that failed over from
 *   ScraperAPI to Bright Data reported `1.0015` — one provider credit plus a fraction of a cent,
 *   added together as though that meant something.
 *
 *   Cost-aware routing (`plan.md` phase 3) would have picked Bright Data every time by a factor
 *   of about 667, on the arithmetic alone, whatever the real prices were.
 *
 * WHY NOT JUST CONVERT EVERYTHING TO MONEY. Because an adapter cannot: a ScraperAPI credit is
 * worth whatever that account's plan says it is worth, and the same fetch costs different amounts
 * on different tiers. The adapter knows "this request costs one credit"; only the operator knows
 * what their credits cost. So the unit is declared here, conversion to money belongs to whoever
 * holds the invoice, and nothing adds two numbers that are not the same unit.
 */
export type CostUnit =
	/** The provider's own credits, whatever they sell those for. */
	| 'provider-credits'
	/** US cents. For providers that bill money per request and issue no credits. */
	| 'usd-cents';

/**
 * What one request costs, for every shape of request we can ask for.
 *
 * THIS USED TO BE `base` TIMES A SET OF MULTIPLIERS, and no provider prices that way. The
 * shape was known-inadequate and said so in its own comments — scrapingbee's read "the
 * combination cannot be expressed and the estimate for renderJs+residential is 2x too high" —
 * but the fix belonged to the contract, so every adapter wrote the closest product it could
 * and left a note. Checked against all four vendors' published rates on 2026-08-21:
 *
 *   ScraperAPI  combinations are NAMED, not derived. render 10, premium 10, and the two
 *               together 25 — not 100. ultra_premium+render is 75, not 300.
 *   ScrapingBee a 2-D lookup on (tier, render_js). premium is 10 without rendering and 25
 *               with it, and render_js DEFAULTS TO TRUE.
 *   Scrapfly    additive. residential 25, rendering +5, together 30 — the product said 125,
 *               which is 4.17x too high on exactly the requests it is best at.
 *   Bright Data flat. One price whatever you ask for.
 *
 * A product cannot express a sum, a named pair, or a lookup. So the table stops being a
 * formula and becomes the answers: one cost per (premiumTier, renderJs) pair, exhaustive and
 * required, in the provider's own unit.
 *
 * EXHAUSTIVE IS THE POINT. Six cells with no defaults means a new adapter cannot ship a
 * partial table, and cannot approximate one either — there is nothing to approximate, only
 * six numbers to read off a page. `null` says the provider does not sell that combination,
 * which is a different fact from "we did not look" and the type makes you pick one.
 */
export interface CostTable {
	/**
	 * The day somebody last read `sourceUrl` and confirmed these numbers. Not the day they were
	 * first written: prices move, and only the re-read date says how much to trust them.
	 */
	readonly effectiveDate: string;
	/** The page these were read off. One click for a reader who thinks we are wrong. */
	readonly sourceUrl: string;
	/**
	 * What the numbers count. REQUIRED, so a new adapter cannot quietly introduce a third unit —
	 * which is exactly how the first two got mixed. Costs in different units are never compared.
	 */
	readonly unit: CostUnit;
	/**
	 * Cost of one request, by proxy tier and whether JavaScript is rendered.
	 *
	 * `null` means the provider does not sell that combination — ScrapingBee's stealth tier
	 * without rendering is theirs, listed as "coming soon" with no price.
	 */
	readonly matrix: Readonly<Record<PremiumTier, CostRow>>;
}

/** One tier's two prices. Both required; `null` is a real answer and absence is not. */
export interface CostRow {
	/** No JavaScript rendering. */
	readonly plain: Microcredits | null;
	/** With JavaScript rendering. */
	readonly rendered: Microcredits | null;
}

/**
 * The cheapest request this provider sells, for callers that cannot know the shape.
 *
 * `parse()` takes a response and nothing else, so an adapter falling back to an estimate has no
 * idea whether the caller asked for rendering or a residential IP. It used to reach for `base`,
 * which meant the same thing and hid it. This is named for what it is: a FLOOR, correct only for
 * the plainest request and an under-estimate for every other.
 *
 * Three of the four providers report their real cost on the response and `parse()` prefers it, so
 * this is the path taken when a provider stays silent — and the result carries
 * `source: 'estimated'` so nothing downstream mistakes it for a fact.
 */
export function cheapestCost(table: CostTable): Microcredits {
	const cells = Object.values(table.matrix).flatMap((r) =>
		[r.plain, r.rendered].filter((n): n is Microcredits => n !== null),
	);
	if (cells.length === 0) {
		throw new Error('cost matrix sells nothing: every combination is null');
	}
	return Math.min(...cells);
}

/**
 * What one request costs at this provider, or `null` if it will not serve that shape.
 *
 * The single reader of `matrix`, so the lookup exists once. Adapters call it for their
 * pre-flight estimate; the page and the CLI call it to compare.
 */
export function costOf(
	table: CostTable,
	shape: { readonly premium: PremiumTier; readonly renderJs: boolean },
): Microcredits | null {
	const row = table.matrix[shape.premium];
	return shape.renderJs ? row.rendered : row.plain;
}

// ------------------------------------------------------- capabilities

/**
 * One unsellable combination. Every field present must match for the conflict to apply, so a
 * conflict naming two things is a conjunction and one naming a single thing is a plain exclusion.
 *
 * `premium` is a LIST because a conflict usually covers several tiers at once, and spelling it
 * out beats a `not: 'none'` that reads backwards at the call site.
 */
export interface CapabilityConflict {
	readonly sessions?: true;
	readonly renderJs?: boolean;
	readonly premium?: readonly PremiumTier[];
	readonly binary?: true;
	readonly method?: 'POST';
	/**
	 * Where the provider says so. Same rule as a cost table's `sourceUrl`: a constraint sourced
	 * from memory is folklore, and this one decides whether a caller gets served at all.
	 */
	readonly why: string;
}

/** Does this conflict apply to this request? All named conditions must hold. */
export function conflictApplies(
	c: CapabilityConflict,
	req: {
		readonly premium: PremiumTier;
		readonly renderJs: boolean;
		readonly sessionId?: string;
		readonly binary?: boolean;
		readonly method: 'GET' | 'POST';
	},
): boolean {
	if (c.sessions === true && req.sessionId === undefined) return false;
	if (c.renderJs !== undefined && c.renderJs !== req.renderJs) return false;
	if (c.premium !== undefined && !c.premium.includes(req.premium)) return false;
	if (c.binary === true && req.binary !== true) return false;
	if (c.method !== undefined && c.method !== req.method) return false;
	// An empty conflict would match everything, which would silently remove a provider from every
	// chain. A conflict has to name something.
	return (
		c.sessions !== undefined ||
		c.renderJs !== undefined ||
		c.premium !== undefined ||
		c.binary !== undefined ||
		c.method !== undefined
	);
}

export type ProviderId = string;

export interface ProviderCapabilities {
	readonly id: ProviderId;
	/**
	 * Which categorical line colour represents this provider, everywhere.
	 *
	 * A SLOT, not a hex: it resolves to `--color-line-N` from the token layer, which has a
	 * value per theme and is contrast-checked on both grounds. A hex here would bypass
	 * `tokens:check` and would be wrong in one of the two variants.
	 *
	 * `design.md` puts this in the registry deliberately — "adding an adapter assigns its
	 * colour once and every surface picks it up": the route diagram, the dashboard charts and
	 * the /providers pages all read the same field. A developer learns "orange is ScrapingBee"
	 * once and it holds across the product.
	 */
	readonly line: 1 | 2 | 3 | 4;
	readonly renderJs: boolean;
	readonly countryCodes: ReadonlySet<string> | 'all';
	readonly premiumTiers: ReadonlySet<PremiumTier>;
	/**
	 * Combinations this provider will not serve, even though each part is offered alone.
	 *
	 * EVERY OTHER FIELD HERE IS INDEPENDENT, and `isCapable` checks them one at a time, so a
	 * provider that sells two things separately but not together could not be described. That is
	 * not hypothetical: ScraperAPI's `session_number` "Can not be combined with
	 * premium/ultra_premium", and we declared sessions and all three tiers — each true alone — so
	 * the router happily sent requests asking for both.
	 *
	 * DATA, NOT A PREDICATE. The obvious fix is a `supports(req)` function on the adapter, and it
	 * is the wrong one here: capabilities are data precisely so `proxlane providers`, the docs
	 * site and the comparison page render from the same source the router filters on. A function
	 * cannot be printed, so a predicate would hide the one thing a caller most needs to know —
	 * that a combination they are about to ask for is unsellable.
	 *
	 * Throwing in `translate()` is also wrong, and looks right: that path returns INVALID_REQUEST
	 * and PAGES A HUMAN. It is the backstop for a capability we declared and cannot honour, not
	 * for a caller asking a provider for something it does not sell.
	 */
	readonly conflicts?: readonly CapabilityConflict[];
	/*
	 * A LIMIT OF THESE FIELDS, recorded where somebody will hit it. Every capability here is
	 * independent, and `chain.ts` checks them one at a time, so a provider that supports two
	 * things separately but not together cannot be described.
	 *
	 * ScraperAPI is the live case: `session_number` "Can not be combined with
	 * premium/ultra_premium", and `premium` and `ultra_premium` exclude each other. We declare
	 * sessions and all three tiers, all true individually, and the chain will happily route a
	 * request asking for both.
	 *
	 * Throwing in `translate()` is NOT the fix. That path is the backstop for a capability we
	 * declared and cannot honour, and it pages a human — right for our bug, wrong for a caller
	 * asking a provider for a combination it does not sell. Needs a `supports(req)` predicate
	 * on the adapter, which is a contract change. Filed in `state.md`.
	 */
	/**
	 * Can THIS ADAPTER hold a session, not can the provider.
	 *
	 * THE DISTINCTION IS THE WHOLE POINT and it was undocumented, so two readers read it two
	 * ways. A research pass against the vendors' docs flagged `sessions: false` on three
	 * providers as a live bug, because all three sell sessions — and every value was correct,
	 * because `translate()` wires one on exactly one of them.
	 *
	 * It has to mean the adapter. `chain.ts` filters the chain on this, so declaring what the
	 * PROVIDER can do would route a session request to an adapter that silently drops the
	 * session id and hands back an unrelated IP. A capability is a promise about behaviour we
	 * ship, and the live canary checks it.
	 *
	 * So `false` here reads "not wired yet", never "impossible". Wiring it is an adapter change
	 * and a capability flip in the same commit.
	 */
	readonly sessions: boolean;
	/** Budget on the LAST hop, e.g. scraperapi 75_000. */
	readonly maxTimeoutMs: number;
	/** Budget on a non-terminal hop, e.g. scraperapi 22_000. */
	readonly fastTimeoutMs: number;
	/**
	 * Can THIS ADAPTER forward a non-GET request, not can the provider. Same rule as `sessions`.
	 *
	 * All four launch providers document POST support. One adapter implements it: the other
	 * three reject `req.method !== 'GET'` in `translate()` and hardcode GET, so `false` is what
	 * is true of them.
	 *
	 * THE CONSEQUENCE IS WORTH KNOWING: a POST through the gateway therefore has a chain of
	 * exactly one provider and cannot fail over at all. That is a real gap, recorded in
	 * `state.md`, and it is a missing implementation rather than a missing capability.
	 */
	readonly post: boolean;
	/**
	 * Can this adapter return a response body byte for byte?
	 *
	 * MEASURED, NOT ASSUMED, and only two of the four launch providers can. Asked each for the
	 * same JPEG on 2026-08-19:
	 *
	 *   scrapingbee  ffd8ff  image/jpeg                  intact
	 *   brightdata   ffd8ff  image/jpeg                  intact from the PROVIDER
	 *   scraperapi   efbfbd  image/jpeg; charset=utf-8   decoded as text, destroyed
	 *   scrapfly     7b2263  application/json            wrapped in an envelope
	 *
	 * `efbfbd` is the UTF-8 replacement character: ScraperAPI decodes bodies as text and hands
	 * back the mojibake, and the `charset` it appends to a binary content-type is the tell.
	 *
	 * IT DESCRIBES THE ADAPTER, NOT THE PROVIDER. Bright Data returns bytes happily, but our
	 * adapter asks for `format: 'json'` and re-encodes the body out of a JSON string, so what
	 * this deployment can deliver today is false. Changing that is an adapter change, and this
	 * flag has to describe what a caller will actually receive.
	 *
	 * Without this the failure is silent: an image request goes to whoever is first in the chain,
	 * comes back 200 with a corrupted body, and nothing anywhere says so.
	 */
	readonly binary: boolean;
	readonly costTable: CostTable;
}

// ---------------------------------------------------------------- wire

// Re-exported, not defined here. The types live in `@proxlane/shared/wire` next to the one
// executor that consumes them, so the live canary in this package can use it without
// importing an app. Adapter authors still get them from `@proxlane/adapters`.
export type { ProviderHttpRequest, ProviderHttpResponse } from '@proxlane/shared/wire';

import type { ProviderHttpRequest, ProviderHttpResponse } from '@proxlane/shared/wire';

/**
 * The provider's own `Retry-After`, in milliseconds, when it sent one.
 *
 * `ParsedResult.retryAfterMs` has existed since the contract landed and the chain already arms
 * cooldowns from it — and NO ADAPTER EVER SET IT. So a provider that capped us and said exactly
 * how long to wait had that answer thrown away, the cooldown fell back to a 30s jittered guess,
 * and the caller got a bare 429 with no hint at all. The field was plumbed end to end with
 * nothing at the source.
 *
 * BOTH FORMS, because RFC 9110 allows either and providers use both: delta-seconds, and an
 * HTTP-date. A date in the past clamps to zero rather than going negative — the header is a
 * hint, and a negative wait is not one.
 */
export function retryAfterMsFrom(
	headers: Readonly<Record<string, string>>,
	now: number = Date.now(),
): number | undefined {
	const raw = headers['retry-after'] ?? headers['Retry-After'];
	if (raw === undefined || raw.trim() === '') return undefined;
	const seconds = Number(raw.trim());
	if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
	const at = Date.parse(raw);
	return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export interface ParsedResult {
	readonly outcome: Outcome;
	readonly body?: Uint8Array;
	readonly contentType?: string;
	/** Resolution order: response header, then `<meta>` sniff, then provider default. */
	readonly charset?: string;
	readonly upstreamStatusCode?: number;
	/**
	 * The TARGET's `Retry-After`, in milliseconds, when the provider exposes it.
	 *
	 * Not our own and not the provider's — the site's own statement of how long to wait, which
	 * is better information than any backoff curve we can invent. The cooldown honours it when
	 * present.
	 *
	 * Measured across the three launch providers, against a target sending `Retry-After: 120`:
	 * ScrapingBee forwards it as `spb-retry-after`, Scrapfly exposes it in the envelope's
	 * `response_headers`, and **ScraperAPI strips it entirely**. So this is absent more often
	 * than it is present, and every consumer must have a fallback.
	 */
	readonly retryAfterMs?: number;
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
