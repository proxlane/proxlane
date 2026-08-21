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
	/**
	 * The classic-proxy list, in full. 42 codes, counted from the source twice.
	 *
	 * THE RULE HERE WAS ALREADY RIGHT AND THE LIST WAS NOT. `ProviderCapabilities` has one
	 * country set and no way to say "these on the classic pool, those on premium", so the only
	 * honest choice is the set that holds on every tier — under-routing is safe, claiming a
	 * country we cannot serve is not. That reasoning stands. What was recorded under it was
	 * seven codes: the six rows of the EXAMPLE table in ScrapingBee's docs, plus `de` from a
	 * sample curl. An illustration, captured as if it were the list.
	 *
	 * It cost real routing. `chain.ts` filters the chain on this set, so ScrapingBee was
	 * silently ineligible for thirty-five countries it sells, on every request that named one.
	 *
	 * `ru` LEAVES, and that is the same rule applied properly: it is on the premium list and
	 * not the classic one, so it was never true on every tier. Asking classic for an
	 * unsupported country is worse than an error — "if the requested country is not supported,
	 * the country_code will default to us" — so it returns a plausible page from the wrong
	 * country and nothing anywhere reports a problem.
	 *
	 * Premium reaches 243 codes, including defunct entries like `su` and `yu`. Serving those
	 * needs a tier-keyed country set, which is a contract change and not this one.
	 *
	 * Source: https://www.scrapingbee.com/documentation/country_codes_classic/ read 2026-08-21.
	 */
	countryCodes: new Set([
		'ar',
		'at',
		'au',
		'be',
		'br',
		'ca',
		'ch',
		'cl',
		'cn',
		'co',
		'de',
		'dk',
		'ee',
		'es',
		'fi',
		'fr',
		'gb',
		'gr',
		'hr',
		'hu',
		'id',
		'ie',
		'il',
		'in',
		'it',
		'jp',
		'kr',
		'lt',
		'lv',
		'mx',
		'nl',
		'no',
		'nz',
		'pl',
		'pt',
		'ro',
		'sa',
		'se',
		'sg',
		'si',
		'th',
		'us',
	]),
	premiumTiers: new Set(['none', 'residential', 'stealth']),
	// ScrapingBee does offer sessions. Declared false because translate() does not wire
	// session_id yet, and under-routing beats advertising a parameter we never send.
	sessions: false,
	maxTimeoutMs: 70_000,
	fastTimeoutMs: 22_000,
	post: false,
	/**
	 * Passes the body through byte for byte — `parse` returns `res.body` untouched.
	 * Verified against a JPEG on 2026-08-19: intact, `image/jpeg`, no charset.
	 */
	binary: true,
	costTable,
};
