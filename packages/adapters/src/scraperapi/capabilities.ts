import type { CostTable, ProviderCapabilities } from '../contract.js';

// Every number here is from ScraperAPI's own documentation, dated, with the link below.
// A capability that is not true of the provider is a routing bug waiting to happen: the
// router filters the failover chain on these before it sends anything.

const costTable: CostTable = {
	effectiveDate: '2026-08-21',
	sourceUrl: 'https://docs.scraperapi.com/control-and-optimization/supported-parameters',
	/** ScraperAPI sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	/**
	 * Read off their parameter table. The combinations are NAMED VALUES, which is why this is a
	 * matrix and not a formula: `premium` is 10 and `render` is 10, but both together is 25 and
	 * not 100. Their own wording on `ultra_premium`: "Requests using this parameter cost 30 API
	 * credits, or 75 if used in combination with JavaScript rendering."
	 *
	 * `stealth` is our name for their `ultra_premium`. They ship no parameter called stealth.
	 *
	 * NOT MODELLED, deliberately, and recorded here so the next reader does not think we missed
	 * it: ScraperAPI also prices by TARGET DOMAIN — Amazon 5 credits, Google and Bing 25,
	 * LinkedIn 30 — and adds 10 for bot-protected domains. Whether those replace this matrix or
	 * stack on top of it is not published anywhere, and inventing the interaction would put a
	 * confident wrong number where an absent one is honest. `sa-credit-cost` returns the real
	 * figure per request and `parse()` reads it, so the ledger is exact regardless. Recorded in
	 * `integrations.md` section 4. Source for the domain classes:
	 * https://docs.scraperapi.com/getting-started/quick-start/credits-and-requests-costs
	 */
	matrix: {
		none: { plain: 1_000_000, rendered: 10_000_000 },
		residential: { plain: 10_000_000, rendered: 25_000_000 },
		stealth: { plain: 30_000_000, rendered: 75_000_000 },
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
	/**
	 * Sessions and premium proxies are mutually exclusive here, which no independent field could
	 * say. Their parameter table, verbatim: `session_number` "(Can not be combined with
	 * `premium/ultra_premium`)".
	 *
	 * We declared sessions AND all three tiers, each true on its own, so the router sent requests
	 * asking for both and ScraperAPI decided what to drop. Nothing reported it.
	 */
	conflicts: [
		{
			sessions: true,
			premium: ['residential', 'stealth'],
			why: 'session_number "Can not be combined with premium/ultra_premium" — https://docs.scraperapi.com/control-and-optimization/supported-parameters',
		},
	],
	// 70s, not the 75_000 used as an illustrative figure in contract.ts. ScraperAPI's own
	// billing rule is the source: a request cancelled from our side BEFORE 70 seconds is
	// still charged, so 70s is the real boundary of an attempt and the docs beat the example.
	maxTimeoutMs: 70_000,
	fastTimeoutMs: 22_000,
	// Wired: translate() forwards the method and body, and a recorded `post` fixture shows the
	// payload echoed back by the target. This comment previously said the opposite — it still
	// read "declared false because translate() does not build one yet" after the flag was
	// flipped, which is the same stale-claim failure the evidence discipline exists to stop, one
	// commit after adding the feature.
	post: true,
	/**
	 * Decodes bodies as text: the same JPEG came back as UTF-8 mojibake with
	 * `charset=utf-8` appended to `image/jpeg`. Measured 2026-08-19.
	 */
	binary: false,
	costTable,
};
