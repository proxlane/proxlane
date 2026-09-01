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
// THE CORPUS EXISTS NOW, and this paragraph used to say the opposite. `integrations.md` section
// 6 wants every rule to have real fire AND no-fire samples. Both halves are real: the no-fire
// pages recorded from three providers, and block pages captured from live traffic into a private
// store, because `plan.md` section 19 keeps captures of named targets out of this repository.
//
// Five of six rules are confirmed by a capture that fired them, and `verified.ts` records each
// claim with the capture's SHA-256. There is no `verifiedAgainstRealCapture` flag to flip: it was
// a boolean anyone could type, and the website read it.
//
// THE CAPTURES PAID FOR THEMSELVES IMMEDIATELY. Five of the six rules had a defect that only a
// real page could show: one could never match its own vendor's page, one was unreachable behind
// another rule, one fired on ordinary pages, and one keyed on a parameter the vendor rotates.

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
/**
 * A response with nothing in it — and WHY THIS IS NOT A `detect()` RULE.
 *
 * It was one, briefly, and the no-fire corpus refused it within a minute: a real recorded
 * ScrapingBee 404 has an empty body, and `detect()` is called over every stored capture
 * regardless of outcome, so the rule called a genuine target 404 a block.
 *
 * That is the lesson, not an inconvenience. Whether an empty body is a failure DEPENDS ON WHAT
 * THE PROVIDER CLAIMED. On a 404 it is ordinary — the target said not-found and there was nothing
 * to pass on. On a claimed success it is a scrape that returned nothing, and `OK` is
 * `chargeable: true`, so the caller is billed for zero bytes and told it worked. `detect()` has
 * no access to the outcome and must not guess at it; the chain has both.
 *
 * Observed, not imagined: a real caller's Cloudflare-defended target answered 200 with zero bytes
 * from one provider after 37 seconds. `plan.md` section 2 has listed "near-empty content" as a v1
 * heuristic since before the detector existed.
 *
 * CONSERVATIVE ON PURPOSE — no non-whitespace byte at all. A thin page is not covered and must not
 * be: an app shell with an empty root element is the legitimate answer for that URL, and calling
 * it blocked would fail over three more times to fetch the same correct thing. Length-versus-median,
 * the other half of plan.md's list, needs per-domain history and belongs with the scoreboard.
 */
export const EMPTY_RESPONSE = 'empty-response';

export function isContentFree(body: Uint8Array): boolean {
	if (body.byteLength === 0) return true;
	return !/\S/.test(new TextDecoder('utf-8', { fatal: false }).decode(body.subarray(0, 512)));
}

export const RULES: readonly DetectRule[] = [
	{
		id: 'cloudflare-blocked',
		source: 'Cloudflare block pages carry cf-error-details / cf-wrapper markup',
		/**
		 * BEFORE `cloudflare-challenge`, and the order is the fix.
		 *
		 * A real Cloudflare block page — "Sorry, you have been blocked", 403 — carries BOTH
		 * `cf-error-details` and `/cdn-cgi/challenge-platform/`, because the block page loads the
		 * same script. With the challenge rule first, every block was attributed to
		 * `cloudflare-challenge` and this rule was unreachable: dead code that looked verified by
		 * never being wrong.
		 *
		 * The outcome was right either way — both are SOFT_BLOCK — but `X-Detect-Rule` is what a
		 * caller reads to find out WHY, and it said the wrong thing.
		 *
		 * Specific before general: a page that says it blocked you is more than a page that merely
		 * loads the challenge script. Checked against three real captures — two challenge pages
		 * carrying no `cf-error-details` still resolve to `cloudflare-challenge`.
		 *
		 * `__cf_chl_` is kept and is UNOBSERVED: it appears in none of the three captures. Unlike
		 * Akamai's `AkamaiGHost`, which structurally cannot be in a body, this one could be — so
		 * it stays, flagged, rather than being removed on three pages' worth of absence.
		 */
		test: (h) => h.includes('cf-error-details') || h.includes('__cf_chl_'),
	},
	{
		id: 'cloudflare-challenge',
		source: "Cloudflare's interstitial injects /cdn-cgi/challenge-platform/ scripts",
		test: (h) => h.includes('/cdn-cgi/challenge-platform/'),
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
		source: 'Imperva block pages FRAME /_Incapsula_Resource; ordinary pages script it',
		/**
		 * NARROWED, because the old signature fired on ordinary pages.
		 *
		 * It matched `_Incapsula_Resource` alone. That is not a block marker — it is how any
		 * Incapsula-protected site loads Imperva's client script, so every page on such a site
		 * was one this rule called blocked. Measured on Imperva's own 200 marketing page, twice:
		 * fetched directly, and again through a provider from a different network.
		 *
		 * It had never fired in practice for a reason that was luck: on the page measured the tag
		 * sat at byte 263,564 and `SCAN_BYTES` stops at 262,144. A shorter page fires.
		 *
		 * IMPERVA SERVES TWO BLOCK SHAPES AND WE ONLY KNEW ONE. The paragraph that used to sit
		 * here said a block page FRAMES the resource while an ordinary page SCRIPTS it, and that
		 * "holds whatever the query string says". The second half is right; the first is not. A
		 * caller running against a protected auction site captured both forms from the same
		 * endpoint twenty minutes apart on 2026-09-01:
		 *
		 *   212 bytes, no iframe, no incident id — a bare <script src="/_Incapsula_Resource?…">
		 *   863 bytes, the framed form, with incident_id and "Request unsuccessful"
		 *
		 * The first is the dangerous one. It reached them through a provider as an ordinary body
		 * rather than a flagged block, and their pipeline burned twelve hundred provider requests
		 * in a night on pages it thought were fine. That is the exact failure this whole detector
		 * exists to prevent, and the iframe rule could not see it.
		 *
		 * SO WHAT SEPARATES THEM IS THE QUERY, NOT THE TAG. The tokens do not: a served page from
		 * an unrelated protected site carried `SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3` and so
		 * did the block above, the same value on both. What differs is the shape.
		 *
		 *   served page   ?<PARAM>=<hex>&ns=1&cb=<n>        one token, then ns and cb
		 *   bare block    ?<PARAM>=<hex>,<hex>              two tokens, comma-joined, no ns/cb
		 *   framed block  ?<PARAM>=…&incident_id=…          plus "Request unsuccessful"
		 *
		 * The parameter name still rotates — `CWUDNSAI`, `SWUDNSAI`, `SWJIYLWA` all observed — so
		 * neither half of this rule keys on it.
		 *
		 * `Incapsula incident ID` is deliberately NOT an alternative on its own. It is prose, and
		 * an article explaining the error carries it — the generic-match trap the no-fire corpus
		 * exists to catch.
		 *
		 * VERIFIED since 2026-08-31 by a real framed block from live traffic, which is why the
		 * generated table lists it. The bare-script form above is not in the corpus yet: it
		 * arrived as pasted text rather than as recorded bytes, and a hand-written fixture is the
		 * one thing CI cannot tell from a real one.
		 */
		test: (h) =>
			/<iframe[^>]*_Incapsula_Resource/i.test(h) ||
			/_Incapsula_Resource\?[A-Za-z]+=[0-9a-f]{16,},[0-9a-f]{16,}/i.test(h),
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
