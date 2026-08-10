// /detect — the honest-success layer. A 200 that is not the page you asked for.
//
// This produces the last outcome nothing else could: SOFT_BLOCK. An adapter cannot, because
// `parse` is pure and has not run a detector; the provider cannot, because as far as it is
// concerned the fetch succeeded. Only a look at the bytes can tell.
//
// TWO THINGS THIS FILE IS ARRANGED AROUND.
//
// A FALSE POSITIVE COSTS MONEY. SOFT_BLOCK fails over, so a rule that fires on a real page
// spends a second provider's credits to fetch something we already had, and does it on every
// request to that site. Every rule here is therefore anchored to a vendor-specific string
// that has no reason to appear in ordinary content — never "captcha", never "access denied",
// never a length heuristic.
//
// THE CORPUS IS HALF-BUILT AND SAYS SO. `integrations.md` section 6 wants every rule to have
// real fire AND no-fire samples. The no-fire half is real: the pages recorded from three
// providers. The fire half cannot be manufactured — you cannot summon a Cloudflare challenge
// on demand, and fabricating one would make this whole layer decorative, the same reason
// `pnpm record` ships no block fixture. So each rule carries `verifiedAgainstRealCapture`,
// it is `false` for all of them today, and a test asserts that the count of unverified rules
// is stated rather than discovered. Flip a flag when a real capture arrives.

// WHAT THIS CANNOT CATCH, stated because the gap is structural rather than a missing rule.
//
// A site that rolls its OWN block page — no Cloudflare, no DataDome, just a 200 saying "you
// have been blocked" — has no fingerprint to match, and we call it OK. There is a real
// capture of exactly that in corpus/bespoke-block.json with a test pinning the miss.
//
// The tempting fix is a rule on the words. It is wrong: the no-fire test proves such a rule
// would flag an article about bot detection, and a false positive here fails over and spends
// a second provider's credits on every request to that site. Catching a bespoke block needs
// a different signal entirely — a per-domain baseline, or a user telling us — and that is
// not a string match.

export interface DetectRule {
	readonly id: string;
	/** Where the signature is documented or publicly observable. Not folklore. */
	readonly source: string;
	readonly test: (html: string) => boolean;
	/**
	 * Has this rule ever been run against a REAL captured block page?
	 *
	 * False everywhere today, and that is the honest state rather than an oversight. A rule
	 * written from a vendor's public markup is a hypothesis until a real capture confirms it.
	 */
	readonly verifiedAgainstRealCapture: boolean;
}

/**
 * Vendor signatures. Each is a token the vendor's own challenge markup emits, chosen because
 * it does not plausibly occur in ordinary page content.
 */
export const RULES: readonly DetectRule[] = [
	{
		id: 'cloudflare-challenge',
		source: "Cloudflare's interstitial injects /cdn-cgi/challenge-platform/ scripts",
		test: (h) => h.includes('/cdn-cgi/challenge-platform/'),
		verifiedAgainstRealCapture: false,
	},
	{
		id: 'cloudflare-blocked',
		source: 'Cloudflare 1020/error pages carry cf-error-details or cf-wrapper markup',
		test: (h) => h.includes('cf-error-details') || h.includes('__cf_chl_'),
		verifiedAgainstRealCapture: false,
	},
	{
		id: 'datadome',
		source: 'DataDome serves its captcha from geo.captcha-delivery.com',
		test: (h) => h.includes('geo.captcha-delivery.com') || h.includes('dd_cookie_test'),
		verifiedAgainstRealCapture: false,
	},
	{
		id: 'perimeterx',
		source: 'PerimeterX block pages reference _pxhd / px-captcha',
		test: (h) => h.includes('px-captcha') || h.includes('_pxhd'),
		verifiedAgainstRealCapture: false,
	},
	{
		id: 'imperva-incapsula',
		source: 'Imperva injects /_Incapsula_Resource on its block page',
		test: (h) => h.includes('_Incapsula_Resource'),
		verifiedAgainstRealCapture: false,
	},
	{
		id: 'akamai-bot-manager',
		source: 'Akamai reference-id error pages include an errors.edgesuite.net asset',
		test: (h) => h.includes('errors.edgesuite.net') || h.includes('AkamaiGHost'),
		verifiedAgainstRealCapture: false,
	},
];

export interface DetectVerdict {
	readonly blocked: boolean;
	/** The rule that fired. Surfaced as X-Detect-Rule and stored per attempt. */
	readonly ruleId?: string;
}

/** How much of a body to look at. Every known interstitial is small; a real page is not. */
const SCAN_BYTES = 256 * 1024;

/**
 * Does this response look like a challenge rather than the page?
 *
 * Takes BYTES and a charset, and decodes for itself — the contract is explicit that `parse`
 * hands over undecoded bytes so this layer fingerprints the page rather than someone else's
 * mojibake.
 */
export function detect(
	body: Uint8Array,
	contentType: string | undefined,
	charset: string | undefined,
): DetectVerdict {
	// HTML only. A JSON or binary body is not a challenge page, and running text rules over
	// an API response is how a false positive gets invented — `integrations.md`'s own fixture
	// matrix notes that detection must not run on the JSON case.
	if (contentType !== undefined && !/html|xml|text\/plain/i.test(contentType)) {
		return { blocked: false };
	}

	let html: string;
	try {
		// `fatal: false` on purpose: a mis-declared charset should degrade to replacement
		// characters, not throw and take the request down.
		html = new TextDecoder(charset ?? 'utf-8', { fatal: false }).decode(
			body.subarray(0, SCAN_BYTES),
		);
	} catch {
		// An unknown charset label is not a block; it is a page we cannot read.
		html = new TextDecoder('utf-8', { fatal: false }).decode(body.subarray(0, SCAN_BYTES));
	}

	for (const rule of RULES) {
		if (rule.test(html)) return { blocked: true, ruleId: rule.id };
	}
	return { blocked: false };
}

/** Rules with no real capture behind them yet. Reported, never silently tolerated. */
export function unverifiedRules(): readonly string[] {
	return RULES.filter((r) => !r.verifiedAgainstRealCapture).map((r) => r.id);
}
