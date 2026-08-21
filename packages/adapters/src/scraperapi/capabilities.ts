import type { CostTable, ProviderCapabilities } from '../contract.js';

// Every number here is from ScraperAPI's own documentation, dated, with the link below.
// A capability that is not true of the provider is a routing bug waiting to happen: the
// router filters the failover chain on these before it sends anything.

const costTable: CostTable = {
	effectiveDate: '2026-08-07',
	sourceUrl: 'https://docs.scraperapi.com/control-and-optimization/supported-parameters',
	/** ScraperAPI sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	// 1 credit for a plain request.
	base: 1_000_000,
	multipliers: {
		// render=true is 10 credits, premium=true is 10, ultra_premium=true is 30.
		//
		// Documented INDIVIDUALLY. ScraperAPI does not publish the cost of render+premium
		// together, and multiplying the two (100x) is a guess. The router would use that guess
		// to pick the cheapest provider, so a wrong number here is a wrong routing decision
		// billed to a real customer. Recorded as a known gap rather than invented — the live
		// canary reports actual credit spend, and these get corrected from observation.
		renderJs: 10,
		premium: { none: 1, residential: 10, stealth: 30 },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'scraperapi',
	line: 1,
	renderJs: true,
	/**
	 * `all`, and it is known to over-claim. Left that way ON PURPOSE, with the reason recorded
	 * because the alternative looks more correct and is worse.
	 *
	 * ScraperAPI gates geotargeting BY PLAN: "Hobby and Startup plans support only US and EU
	 * regional-based geotargeting (individual country codes are not supported)". Business and
	 * above get the individual codes, and a further premium set on top of those.
	 *
	 * Launch is BYOK, so the plan belongs to the caller and we cannot see it. Applying
	 * scrapingbee's rule — the set true on every tier — would give `{us, eu}` and drop
	 * ScraperAPI out of the chain for every other country, including for the Business
	 * customers who are paying for exactly that. Naming the Business set instead breaks the
	 * Hobby ones. There is no flat set that is right, which is the actual finding.
	 *
	 * Whether an unsupported code errors or is silently ignored is NOT documented, and that
	 * decides which way to fail: an error is a wasted attempt, silently ignoring it returns US
	 * data labelled as German. Filed in `state.md`; do not guess it into this file.
	 *
	 * Source: https://docs.scraperapi.com/control-and-optimization/geotargeting/standard-geo
	 * read 2026-08-21.
	 */
	countryCodes: 'all',
	premiumTiers: new Set(['none', 'residential', 'stealth']),
	sessions: true,
	// 70s, not the 75_000 used as an illustrative figure in contract.ts. ScraperAPI's own
	// billing rule is the source: a request cancelled from our side BEFORE 70 seconds is
	// still charged, so 70s is the real boundary of an attempt and the docs beat the example.
	maxTimeoutMs: 70_000,
	fastTimeoutMs: 22_000,
	// ScraperAPI does support POST. Declared false because translate() does not build one
	// yet, and the honest direction is to under-route rather than to advertise a path that
	// throws. Flip this in the same commit that implements it.
	post: false,
	/**
	 * Decodes bodies as text: the same JPEG came back as UTF-8 mojibake with
	 * `charset=utf-8` appended to `image/jpeg`. Measured 2026-08-19.
	 */
	binary: false,
	costTable,
};
