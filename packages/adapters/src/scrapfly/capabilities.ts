import type { CostTable, ProviderCapabilities } from '../contract.js';

const costTable: CostTable = {
	effectiveDate: '2026-08-21',
	sourceUrl: 'https://scrapfly.io/docs/scrape-api/billing',
	/** Scrapfly sells credits; what a credit costs depends on the plan. */
	unit: 'provider-credits',
	/**
	 * SCRAPFLY IS ADDITIVE, and modelling it as a product was the worst of the four errors. Their
	 * billing page: "Additional Features (added to base cost)", with the proxy pools listed as
	 * mutually exclusive bases — datacenter 1, residential 25 — and browser rendering as "+5".
	 * Their own worked example is "25 + 5 = 30 credits".
	 *
	 * The old table gave residential+render as 25 x 5 = 125. Four times what Scrapfly charges,
	 * on precisely the hard requests they are best at, so any cost-aware ordering would have
	 * skipped them for it. The file's previous comment called the multiplicative model "an
	 * approximation" that "matters least here", and that was the wrong call.
	 *
	 * `stealth` is our name for their ASP, and it is FREE ON ITS OWN: "It's totally free on
	 * non-blocked scrape... just keep it enabled, no extra cost is applied on non-protected
	 * traffic." So it costs the datacenter base. It can escalate — ASP "may dynamically upgrade
	 * the proxy pool", taking it to the residential figures — and the docs do not say when, so
	 * the documented price is what goes here. `X-Scrapfly-Api-Cost` carries the real number and
	 * `parse()` reads it.
	 */
	matrix: {
		none: { plain: 1_000_000, rendered: 6_000_000 },
		residential: { plain: 25_000_000, rendered: 30_000_000 },
		stealth: { plain: 1_000_000, rendered: 6_000_000 },
	},
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
	post: true,
	/**
	 * Scrapfly reports `result.format: 'binary'` for a non-text body and base64-encodes the
	 * content, which `parse` already decodes — so bytes round-trip exactly, with the target's
	 * `status_code` still in the envelope. Verified through the adapter on 2026-08-19: a JPEG
	 * comes back `ffd8ff`.
	 *
	 * This said `false` for an hour because the first measurement looked at the WRONG LAYER —
	 * the provider's wire response, which is of course the JSON envelope (`{"c…`) — instead of
	 * what `parse` produces from it. Conformance now asserts this flag against a recorded
	 * fixture through `parse`, so the same mistake fails the build rather than shipping.
	 */
	binary: true,
	costTable,
};
