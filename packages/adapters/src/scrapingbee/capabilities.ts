import type { CostTable, ProviderCapabilities } from '../contract.js';

const costTable: CostTable = {
	effectiveDate: '2026-08-21',
	sourceUrl: 'https://www.scrapingbee.com/documentation/',
	/** ScrapingBee sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	/**
	 * Their published table, transcribed cell for cell. It is a two-dimensional lookup and always
	 * was — "Each request with this parameter will count as 25 API credits with Javascript
	 * enabled. If used without JavaScript rendering it will cost 10 credits."
	 *
	 * The old table said premium was 10 flat, and its own comment already knew: "the combination
	 * cannot be expressed and the estimate for renderJs+residential is 2x too high". It was the
	 * contract that could not express it, so this is that fix rather than a correction to a
	 * careless number.
	 *
	 * WORTH KNOWING: `render_js` DEFAULTS TO TRUE at ScrapingBee, so the rendered column is what
	 * a naive caller actually pays. The floor for them is 5, not 1.
	 *
	 * `stealth.plain` is `null` because they do not sell it — the row exists in their table
	 * reading "(coming soon)". That is a different fact from us not having looked, and the type
	 * makes us say which.
	 */
	matrix: {
		none: { plain: 1_000_000, rendered: 5_000_000 },
		residential: { plain: 10_000_000, rendered: 25_000_000 },
		stealth: { plain: null, rendered: 75_000_000 },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'scrapingbee',
	line: 2,
	renderJs: true,
	// `wait_for=<selector>`. Verified live 2026-08-29: 200 with content, and this API rejects
	// an unknown parameter with 400 "Unknown field", so acceptance proves the name.
	waitForSelector: true,
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
	post: true,
	/**
	 * Passes the body through byte for byte — `parse` returns `res.body` untouched.
	 * Verified against a JPEG on 2026-08-19: intact, `image/jpeg`, no charset.
	 */
	binary: true,
	costTable,
};
