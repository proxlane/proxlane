import type { CostTable, ProviderCapabilities } from '../contract.js';

// Bright Data Web Unlocker, via the REST API at api.brightdata.com/request.
//
// The fourth adapter, and the first written against a provider this project does not itself
// pay for — which is the point. Adapters are Apache-2.0 so exactly this can happen.

const costTable: CostTable = {
	effectiveDate: '2026-08-21',
	sourceUrl: 'https://brightdata.com/pricing/web-unlocker',
	/** Web Unlocker bills money per request and issues no credits, so cents is its native unit. */
	unit: 'usd-cents',
	/**
	 * FLAT, AND THAT IS THE INTERESTING PART. $1.50 per 1,000 requests on pay-as-you-go, so 1,500
	 * microcredits each if a credit is a cent — and the same figure whatever you ask for. Their
	 * docs list "Full browser rendering" under what every plan includes, and the `render`
	 * parameter carries a latency warning and no price. It is the only one of the four that does
	 * not surcharge for rendering.
	 *
	 * Do not confuse it with Browser API / Scraping Browser, which is a different product for
	 * INTERACTING with a page and is billed per gigabyte.
	 *
	 * Volume tiers exist (Scale is $499/mo including 383K, then $1.30/1k) and are NOT modelled:
	 * the router would use a rate this account may not be on to decide who gets paid.
	 *
	 * NOT MODELLED, and both are real: "Premium Domains" is a higher per-domain rate whose price
	 * is only visible inside a logged-in account, and enabling custom headers flips them from
	 * charging for successes to charging for "100% of the requests (both successful and failed)",
	 * which makes the effective cost $1.50 divided by the success rate. Filed in `state.md`.
	 */
	matrix: {
		none: { plain: 1_500, rendered: 1_500 },
		// `null`, matching `premiumTiers` below, which holds `none` alone. An Unlocker zone is
		// already residential-grade, but the tier is fixed at zone-configuration time and
		// `proxy_type` is rejected per-request, so the adapter cannot honour a caller asking for
		// one. Pricing a tier we refuse to serve would put the provider back in chains that
		// `premiumTiers` deliberately keeps it out of.
		residential: { plain: null, rendered: null },
		stealth: { plain: null, rendered: null },
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
	 * Raw mode returns the target's original bytes, so a JPEG round-trips exactly — verified
	 * through the adapter on 2026-08-19: ffd8ff. This was false while the adapter asked for
	 * `format: 'json'`, whose `body` is a lossy UTF-8 string with no base64 alternative.
	 */
	binary: true,
	costTable,
};
