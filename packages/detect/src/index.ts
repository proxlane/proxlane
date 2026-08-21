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

import { VERIFIED, type VerifiedRule } from './verified.js';

export interface DetectRule {
	readonly id: string;
	/** Where the signature is documented or publicly observable. Not folklore. */
	readonly source: string;
	readonly test: (html: string) => boolean;
}

// NO `verifiedAgainstRealCapture` FIELD ANY MORE, and its absence is the point.
//
// It was a boolean on every rule, false on all six, and the website read it to print "no real
// capture yet" next to each one. The most load-bearing honesty claim in the product was a value
// anybody could change to `true` in one keystroke with no capture behind it.
//
// It is derived from `verified.ts` now: a rule counts as confirmed only because a stored capture,
// run through this exact `detect()`, fired that exact rule — and the generated table records the
// capture's SHA-256, so the claim points at an artefact instead of at a memory.

/**
 * Vendor signatures. Each is a token the vendor's own challenge markup emits, chosen because
 * it does not plausibly occur in ordinary page content.
 */
export const RULES: readonly DetectRule[] = [
	{
		id: 'cloudflare-challenge',
		source: "Cloudflare's interstitial injects /cdn-cgi/challenge-platform/ scripts",
		test: (h) => h.includes('/cdn-cgi/challenge-platform/'),
	},
	{
		id: 'cloudflare-blocked',
		source: 'Cloudflare 1020/error pages carry cf-error-details or cf-wrapper markup',
		test: (h) => h.includes('cf-error-details') || h.includes('__cf_chl_'),
	},
	{
		id: 'datadome',
		source: 'DataDome serves its captcha from geo.captcha-delivery.com',
		test: (h) => h.includes('geo.captcha-delivery.com') || h.includes('dd_cookie_test'),
	},
	{
		id: 'perimeterx',
		source: 'PerimeterX block pages reference _pxhd / px-captcha',
		test: (h) => h.includes('px-captcha') || h.includes('_pxhd'),
	},
	{
		id: 'imperva-incapsula',
		source: 'Imperva injects /_Incapsula_Resource on its block page',
		/**
		 * KNOWN OVER-BROAD, and measured rather than suspected.
		 *
		 * Imperva's own site serves `<script src="/_Incapsula_Resource?SWJIYLWA=…">` on an
		 * ordinary 200 marketing page. The token is not exclusive to a block page: it is how an
		 * Incapsula-protected site loads Imperva's client script at all, so any such site whose
		 * page carries that tag is one this rule calls a block.
		 *
		 * The cost of that is not theoretical. A false positive here becomes SOFT_BLOCK, which
		 * fails over, spends a second provider's credits, and hands the caller 502 for a page
		 * that was fine.
		 *
		 * It has not fired in practice for a reason that is luck rather than design: on the page
		 * measured, the tag sits at byte 263,564 and `SCAN_BYTES` stops at 262,144, so it is
		 * 1,420 bytes past the window. The same page, shorter, fires. A no-fire capture of it is
		 * in the private corpus.
		 *
		 * NOT NARROWED HERE, deliberately. A tighter signature needs a real Imperva BLOCK page to
		 * check it against, and nobody has one — guessing at the query parameter that distinguishes
		 * the two would be exactly the folklore `source` exists to keep out. `unverifiedRules()`
		 * still lists this rule, which is the honest state.
		 */
		test: (h) => h.includes('_Incapsula_Resource'),
	},
	{
		id: 'akamai-bot-manager',
		source:
			'Akamai reference-id deny pages cite errors.edgesuite.net, with the dots HTML-encoded',
		/**
		 * ENTITY-TOLERANT, because Akamai encodes the dots and the literal never matched.
		 *
		 * A real deny page, captured: the body is 371 bytes and reads
		 * `https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;12171002&#46;…`. Every dot
		 * is `&#46;`, so `includes('errors.edgesuite.net')` could not fire on the one page this
		 * rule exists for. It had never been run against one.
		 *
		 * `AkamaiGHost` is dropped from the body test: it identifies the server in the `Server`
		 * HEADER and appears nowhere in the body, and `detect()` only sees the body. A token that
		 * cannot be present is not a signature.
		 *
		 * Not loosened to a bare `edgesuite`: that is an Akamai CDN host a normal page can load
		 * assets from, which is exactly the over-broad shape that makes `imperva-incapsula`
		 * unsafe. The full host, in either encoding, is the narrow form.
		 */
		test: (h) => /errors(?:&#46;|\.)edgesuite(?:&#46;|\.)net/i.test(h),
	},
];

export interface DetectVerdict {
	readonly blocked: boolean;
	/** The rule that fired. Surfaced as X-Detect-Rule and stored per attempt. */
	readonly ruleId?: string;
}

/**
 * How much of a body to look at. Every known interstitial is small; a real page is not.
 *
 * Exported because a caller that shows a verdict has to be able to say what the verdict was
 * formed from. A paste longer than this is scanned in part, and a tool that did not say so
 * would report "not blocked" about bytes it never read.
 */
export const SCAN_BYTES = 256 * 1024;

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

/**
 * Rules no stored capture has ever confirmed.
 *
 * Reported, never silently tolerated — and no longer self-reported. This reads the generated
 * table, so a rule leaves this list by someone capturing a real page and running
 * `pnpm corpus:verify --write`, not by editing a boolean.
 */
export function unverifiedRules(): readonly string[] {
	return RULES.filter((r) => VERIFIED[r.id] === undefined).map((r) => r.id);
}

/** What confirms a rule, for anything that wants to show its provenance. */
export function verificationFor(id: string): VerifiedRule | undefined {
	return VERIFIED[id];
}
