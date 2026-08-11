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

export type {
	CooldownScope,
	GatewayRequest,
	Outcome,
	OutcomePolicy,
	PremiumTier,
} from '@proxlane/shared';
export {
	carriesBody,
	cooldownScope,
	FAILOVER,
	OUTCOMES,
	policyFor,
	shouldFailover,
} from '@proxlane/shared';

import type { GatewayRequest, Outcome, PremiumTier } from '@proxlane/shared';

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
