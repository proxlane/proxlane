import type { CostTable, ProviderCapabilities } from '../contract.js';

const costTable: CostTable = {
	effectiveDate: '2026-08-07',
	sourceUrl: 'https://scrapfly.io/docs/scrape-api/getting-started',
	/** Scrapfly sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	// 1 credit on the datacenter pool, confirmed live: the success probe reported
	// `PROXY_DATACENTER_NETWORK, amount 1`.
	base: 1_000_000,
	multipliers: {
		renderJs: 5,
		premium: { none: 1, residential: 25, stealth: 25 },
	},
	// As with the other two, the multiplicative model is an approximation. It matters least
	// here: Scrapfly reports `context.cost.total` per request and parse() uses it, so the
	// ledger is exact and only the pre-flight routing estimate leans on these numbers.
};

export const capabilities: ProviderCapabilities = {
	id: 'scrapfly',
	line: 3,
	renderJs: true,
	countryCodes: 'all',
	// `asp` is their anti-scraping-protection bypass, which is what 'stealth' means here.
	// Residential is a proxy_pool choice.
	premiumTiers: new Set(['none', 'residential', 'stealth']),
	// They support sessions; translate() does not wire one yet, and under-routing is safe.
	sessions: false,
	// 50s, DELIBERATELY BELOW the other two adapters' 70s, and measured rather than chosen.
	//
	// Scrapfly does not time out cleanly. Against a target that is too slow for it, the
	// request hangs and then the SOCKET IS CLOSED at ~60s — observed at 60126ms and 60503ms
	// on separate runs, surfacing as an opaque `fetch failed / other side closed` rather
	// than their structured envelope. A budget above that ceiling guarantees we lose the
	// attributable answer every time: no status, no error code, nothing to map.
	//
	// Setting ours below theirs means OUR deadline fires first, which is a clean
	// PROVIDER_TIMEOUT we can attribute, cool down and count. `/delay/10` completes in
	// ~12.5s, `/delay/20` does not complete at all, so the usable band is genuinely narrow.
	maxTimeoutMs: 50_000,
	fastTimeoutMs: 20_000,
	post: false,
	costTable,
};
