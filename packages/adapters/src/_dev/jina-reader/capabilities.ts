import type { CostTable, ProviderCapabilities } from '../../contract.js';

// r.jina.ai, used as a KEYLESS end-to-end subject for the recorder and (later) the
// conformance harness. It is not a supported provider and must never appear in REGISTRY —
// see dev-registry.ts for why, and repo:check for the assertion that keeps it true.
//
// Observed 2026-08-07 against the live service, not read off a docs page.

const costTable: CostTable = {
	effectiveDate: '2026-08-07',
	sourceUrl: 'https://jina.ai/reader/',
	/**
	 * Cents, because the keyless tier charges money-per-request and the amount is zero. Not
	 * `provider-credits`: there is no credit here to be worth anything, so calling it credits
	 * would make a zero that cannot be compared with anything look like one that can.
	 */
	unit: 'usd-cents',
	/**
	 * Genuinely zero on the keyless tier — which is the entire reason this adapter exists. The
	 * service meters by tokens (it returns `x-usage-tokens`) and rate-limits anonymous callers
	 * rather than charging them, so there is no credit to convert.
	 *
	 * `null` on the tiers it does not sell, matching `premiumTiers`, which holds `none` alone.
	 * Zero and "not sold" are different answers and the matrix makes us give one of them: a zero
	 * in the residential row would advertise free residential proxies.
	 *
	 * Rendering is always on and cannot be turned off, so both columns of `none` are the same
	 * number rather than one of them being null — the request is served either way.
	 */
	matrix: {
		none: { plain: 0, rendered: 0 },
		residential: { plain: null, rendered: null },
		stealth: { plain: null, rendered: null },
	},
};

export const capabilities: ProviderCapabilities = {
	id: 'jina-reader',
	line: 3,
	// True, but with a caveat the contract has no field for: it renders JS ALWAYS and offers
	// no way to turn it off. `renderJs: false` therefore cannot be honoured, only ignored.
	// Left as a comment rather than silently modelled, because a capability that lies is
	// worse than one that is coarse. See the note in index.ts translate().
	renderJs: true,
	// A reader endpoint, not a renderer. Nothing to wait for.
	waitForSelector: false,
	// No geotargeting at all. An empty set, not 'all' — the router must filter this out for
	// any request naming a country rather than sending one and hoping.
	countryCodes: new Set<string>(),
	premiumTiers: new Set(['none']),
	sessions: false,
	// Measured, not guessed: cold fetches of a JS-heavy page ran several seconds.
	maxTimeoutMs: 60_000,
	fastTimeoutMs: 25_000,
	post: false,
	/** Returns markdown text by design; there is no byte-preserving mode. */
	binary: false,
	costTable,
};
