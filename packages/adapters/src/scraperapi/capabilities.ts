import type { CostTable, ProviderCapabilities } from '../contract.js';

// Every number here is from ScraperAPI's own documentation, dated, with the link below.
// A capability that is not true of the provider is a routing bug waiting to happen: the
// router filters the failover chain on these before it sends anything.

const costTable: CostTable = {
	effectiveDate: '2026-08-07',
	sourceUrl: 'https://docs.scraperapi.com/control-and-optimization/supported-parameters',
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
	costTable,
};
