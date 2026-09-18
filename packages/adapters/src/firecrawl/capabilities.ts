import type { CostTable, ProviderCapabilities } from '../contract.js';

// Capabilities are DATA, not code: the router, the docs site and the /providers pages all
// render from this. Every field must be true of the ADAPTER, and the live canary checks the
// ones it can.

const costTable: CostTable = {
	// Read 2026-09-18. "Scrape: 1 / page", and the only surcharges the page names are for the
	// JSON, question and highlight formats, none of which this adapter requests.
	effectiveDate: '2026-09-18',
	sourceUrl: 'https://www.firecrawl.dev/pricing',
	unit: 'provider-credits',
	/**
	 * RENDERING IS NOT A MULTIPLIER HERE, which makes Firecrawl unlike three of the four launch
	 * providers. One credit per page whatever the engine did.
	 *
	 * `stealth` would map to their `proxy: "enhanced"` mode, and it is NOT OFFERED, because it
	 * is not priced: the pricing page prices scraping per page and says nothing about enhanced
	 * proxies, and the proxies page prices nothing at all. A tier offered at `null` routes
	 * traffic to a cost the router cannot report, so `premiumTiers` below leaves it out until a
	 * number exists somewhere they wrote. `translate()` still knows the mapping, so offering it
	 * is a one-line flip once it does.
	 *
	 * `residential` is `null` because they do not sell it as a tier.
	 */
	matrix: {
		none: { plain: 1_000_000, rendered: 1_000_000 },
		residential: { plain: null, rendered: null },
		stealth: { plain: null, rendered: null },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'firecrawl',
	// Slot 5, added with this adapter: `line` was `1 | 2 | 3 | 4` and all four were taken.
	line: 5,
	/**
	 * Firecrawl's scrape runs the page through its own browser engine: the docs promise
	 * "js-rendered sites" and every `actions` step assumes a live DOM. The canary's honesty
	 * check against `/canary/js` is what makes this a fact rather than a reading, on the first
	 * scheduled run with a key.
	 */
	renderJs: true,
	/**
	 * FALSE UNTIL WATCHED. Their `wait` action documents `milliseconds`, and the API reference
	 * also lists `selector` on it, but nothing here has seen a selector wait hold a page yet.
	 * The rule in `contract.ts` is measured, not read: a wait that silently does not happen is
	 * worse than none. Flip it in the same commit as the live check that shows it working.
	 */
	waitForSelector: false,
	/**
	 * The 26 countries their proxies page lists for basic proxies, read 2026-09-18. Enhanced
	 * proxies serve only US and NL, and the contract has one country set rather than one per
	 * tier, so the basic list is the honest one: it holds on every tier we can ask for.
	 * `stealth` plus a country outside US/NL is a combination the router cannot yet refuse; it
	 * is the same tier-keyed-country gap `state.md` already carries for ScraperAPI and
	 * ScrapingBee.
	 *
	 * Source: https://docs.firecrawl.dev/features/proxies
	 */
	countryCodes: new Set([
		'ae',
		'at',
		'au',
		'be',
		'br',
		'ca',
		'ch',
		'cn',
		'de',
		'dk',
		'eg',
		'es',
		'fr',
		'gb',
		'gr',
		'il',
		'in',
		'it',
		'jp',
		'mx',
		'nl',
		'pl',
		'qa',
		'se',
		'tr',
		'us',
	]),
	// `basic` only, until `enhanced` has a published price. See the cost table.
	premiumTiers: new Set(['none']),
	sessions: false,
	// Their `timeout` accepts 1 000 to 300 000 ms and defaults to 60 000. Bounded to ours.
	maxTimeoutMs: 90_000,
	fastTimeoutMs: 30_000,
	// The scrape endpoint fetches the target with GET and takes no method or body for it.
	post: false,
	/**
	 * `formats: ["rawBase64"]` is "the original HTTP response body", base64, and `parse()`
	 * decodes it back to the wire bytes. That is the one output on any launch provider that
	 * matches the fixture contract exactly: pre-charset, byte for byte. Used for every
	 * non-rendered request, so a JPEG round-trips.
	 */
	binary: true,
	costTable,
};
