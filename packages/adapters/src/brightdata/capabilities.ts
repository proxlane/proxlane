import type { CostTable, ProviderCapabilities } from '../contract.js';

// Bright Data Web Unlocker, via the REST API at api.brightdata.com/request.
//
// The fourth adapter, and the first written against a provider this project does not itself
// pay for — which is the point. Adapters are Apache-2.0 so exactly this can happen.

const costTable: CostTable = {
	effectiveDate: '2026-08-16',
	sourceUrl: 'https://brightdata.com/pricing/web-unlocker',
	/** Bright Data Web Unlocker bills money per request and issues no credits, so cents is its native unit rather than a conversion. */
	unit: 'usd-cents',
	/**
	 * $1.50 per 1,000 requests on pay-as-you-go, so 1,500 microcredits each if a credit is a
	 * cent. Volume tiers exist ($1.30/1k on Scale) and are NOT modelled: the router would use
	 * a rate this account may not be on to decide who gets paid, and a wrong number here is a
	 * wrong routing decision billed to a real customer.
	 */
	base: 1_500,
	multipliers: {
		/**
		 * NO RENDER MULTIPLIER, and that is a real difference from the other three.
		 *
		 * The Unlocker decides for itself whether a page needs JavaScript and does not charge
		 * differently for it. Where ScraperAPI is 10x for `render=true`, this is 1x — so on a
		 * JS-heavy target it can be the cheapest option in the chain even though its base rate
		 * is the highest.
		 */
		renderJs: 1,
		/**
		 * Nor a premium multiplier. Unblocking IS the product: there is no cheaper non-premium
		 * tier to fall back to, so every tier this adapter accepts costs the same.
		 */
		premium: { none: 1, residential: 1, stealth: 1 },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'brightdata',
	// The fourth line. The token layer defines three, so this reuses slot 1 until
	// `--color-line-4` exists; `tokens:check` owns that decision, not this file.
	line: 4,
	/**
	 * The Unlocker renders JavaScript and solves captchas as part of unblocking, rather than
	 * as an option. There is no parameter to turn it on because there is no version with it
	 * off, so `render=true` and `render=false` produce the same request — see `translate`.
	 */
	renderJs: true,
	countryCodes: 'all',
	/**
	 * ONE TIER, because the tier is a property of the zone rather than of the request.
	 *
	 * `proxy_type` is rejected by the API with `error_code: validation`, so there is no way to
	 * ask for residential on one call and datacenter on the next — the zone was configured
	 * once and every request through it gets that. Declaring three tiers and varying none of
	 * them would be a lie the conformance suite correctly refuses to accept.
	 *
	 * The cost of honesty here is real and worth naming: a caller who explicitly asks for
	 * `residential` will be routed away from this provider even though an Unlocker zone is
	 * already residential-grade. That is a routing inefficiency. The alternative is a
	 * capability claim the adapter cannot honour, which is worse.
	 */
	premiumTiers: new Set(['none']),
	/**
	 * No sessions. The REST API takes one URL per call with no session handle, so a
	 * multi-step cookie flow cannot be held together across requests. Declaring otherwise
	 * would have the router hand it exactly the work it cannot do.
	 */
	sessions: false,
	/**
	 * Generous, deliberately. Unblocking includes captcha solving and retries inside the
	 * provider, so a request that a plain fetch would fail in two seconds can legitimately
	 * take thirty. bidprowl's hand-rolled client allows 120 s; this is the terminal-hop
	 * budget and the chain shortens it on earlier hops.
	 */
	maxTimeoutMs: 90_000,
	fastTimeoutMs: 35_000,
	post: true,
	/**
	 * An ADAPTER limitation, not a provider one: Bright Data returns bytes intact,
	 * but `translate` asks for `format: 'json'` so the body comes back as a JSON string.
	 * Flip this the day the adapter learns to ask for raw when the caller wants bytes.
	 */
	binary: false,
	costTable,
};
