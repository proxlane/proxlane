import type { CostTable, ProviderCapabilities } from '../contract.js';

const costTable: CostTable = {
	// Re-read 2026-08-31 and unchanged: datacenter 1, residential 25, render_js +5. The billing
	// page shows the arithmetic we encode — "1 + 5 = 6" and "25 + 5 = 30".
	//
	// THE STEALTH COLUMN IS THE CEILING, NOT THE FLOOR, AND SCRAPFLY'S OWN TWO PAGES DISAGREE
	// ABOUT IT. We map `premium: 'stealth'` to `asp=true`. The billing page — the sourceUrl
	// above, and the authoritative one — lists no credit cost for ASP at all, saying only that
	// it "may dynamically upgrade the proxy pool to bypass anti-bot protection, which can affect
	// the final cost". The marketing pricing page says "5 credits + JS rendering or ASP mode",
	// which is a floor of 1 + 5 = 6. The sample response ON THAT SAME PAGE reports
	// `"asp_cost": 30`, which is 25 + 5 — the escalated case, and the number here.
	//
	// So a single figure cannot be right: the price is a range whose top depends on what the
	// target's defences do. We publish the top. Under-quoting a caller who then gets billed five
	// times the estimate is the worse error, and `cost_budget` exists precisely because ASP can
	// run away. It costs Scrapfly nothing in the comparison — at 25/30 they are still the
	// cheapest stealth tier of the four, and the floor would only widen that.
	//
	// It also matters less than it looks: Scrapfly returns its real charge on every response, so
	// this table is the estimate of last resort rather than what a caller is normally shown.
	effectiveDate: '2026-08-31',
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
	 * `stealth` is our name for their ASP, and the ASP FLAG is free on its own: "It's totally
	 * free on non-blocked scrape... no extra cost is applied on non-protected traffic."
	 *
	 * THAT REASONING PRICED THE FLAG AND IGNORED THE POOL. `translate()` sends
	 * `proxy_pool=public_residential_pool` for every tier except `none` — stealth included — so
	 * a stealth request is a residential request with ASP on, and it costs the residential
	 * figures. Priced at the datacenter base it read 1x on `/scraping-api-comparison`, a public
	 * page, against a real 25x. The free thing and the expensive thing are two different
	 * parameters, and the comment reasoned about only one of them.
	 *
	 * It can still escalate above this — ASP "may dynamically upgrade the proxy pool" and the
	 * docs do not say when — so `X-Scrapfly-Api-Cost` carries the real number and `parse()`
	 * reads it. This is the floor, and now it is the right floor.
	 */
	matrix: {
		none: { plain: 1_000_000, rendered: 6_000_000 },
		residential: { plain: 25_000_000, rendered: 30_000_000 },
		stealth: { plain: 25_000_000, rendered: 30_000_000 },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'scrapfly',
	line: 3,
	renderJs: true,
	// `wait_for_selector=<selector>`. Verified live 2026-08-29: echoed back in the API's own
	// parsed `config`, where a bogus parameter does not appear.
	waitForSelector: true,
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
