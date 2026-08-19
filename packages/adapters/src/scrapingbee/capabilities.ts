import type { CostTable, ProviderCapabilities } from '../contract.js';

const costTable: CostTable = {
	effectiveDate: '2026-08-07',
	sourceUrl: 'https://www.scrapingbee.com/documentation/',
	/** ScrapingBee sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	// 1 credit for a plain fetch.
	base: 1_000_000,
	multipliers: {
		renderJs: 5,
		premium: { none: 1, residential: 10, stealth: 75 },
	},
	// KNOWN GAP, and a limit of CostTable rather than of this adapter. ScrapingBee's pricing
	// is not multiplicative: render is 5, premium is 10, and the two TOGETHER are 25 — not
	// 50. CostTable models cost as base × independent multipliers, so the combination cannot
	// be expressed and the estimate for renderJs+residential is 2x too high.
	//
	// It matters less here than it would elsewhere, because ScrapingBee REPORTS the real
	// figure per request in `spb-cost` and parse() reads it, so the ledger is exact and only
	// the pre-flight routing estimate is affected. ScraperAPI has the same shape of problem
	// with no reported number to fall back on.
};

export const capabilities: ProviderCapabilities = {
	id: 'scrapingbee',
	line: 2,
	renderJs: true,
	// Only the documented set. Premium proxies reach many more countries, but
	// ProviderCapabilities has ONE country set and no way to say "these on the standard
	// pool, those on premium" — so the honest choice is the set that is true on every tier.
	// Under-routing is safe; claiming a country we cannot serve is not.
	countryCodes: new Set(['de', 'us', 'gb', 'br', 'in', 'mx', 'ru']),
	premiumTiers: new Set(['none', 'residential', 'stealth']),
	// ScrapingBee does offer sessions. Declared false because translate() does not wire
	// session_id yet, and under-routing beats advertising a parameter we never send.
	sessions: false,
	maxTimeoutMs: 70_000,
	fastTimeoutMs: 22_000,
	post: false,
	costTable,
};
