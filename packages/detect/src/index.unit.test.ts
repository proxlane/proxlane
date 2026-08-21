// The detector. A false positive here is not a wrong label — it is a SOFT_BLOCK, which
// fails over, which spends a second provider's credits fetching a page we already had, on
// every request to that site. So the no-fire half of this file matters more than the fire
// half, and it is the half built from REAL recordings.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detect, RULES, unverifiedRules, verificationFor } from './index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const enc = (s: string) => new TextEncoder().encode(s);

/** Every real page the three providers actually returned. The no-fire corpus. */
function realPages(): { name: string; body: Uint8Array; contentType: string | undefined }[] {
	const out: { name: string; body: Uint8Array; contentType: string | undefined }[] = [];
	for (const id of ['scraperapi', 'scrapingbee', 'scrapfly']) {
		for (const cat of ['success-html', 'success-json', 'render-js', 'target-not-found']) {
			const p = join(ROOT, 'packages/adapters/src', id, 'fixtures', `${cat}.json`);
			try {
				const f = JSON.parse(readFileSync(p, 'utf8')) as {
					kind: string;
					response: { headers: Record<string, string>; bodyBase64: string };
				};
				if (f.kind !== 'exchange') continue;
				out.push({
					name: `${id}/${cat}`,
					body: new Uint8Array(Buffer.from(f.response.bodyBase64, 'base64')),
					contentType: f.response.headers['content-type'],
				});
			} catch {
				// A missing category is not this suite's problem; conformance owns that.
			}
		}
	}
	return out;
}

describe('the no-fire corpus — REAL pages, which must never be called a block', () => {
	const pages = realPages();

	it('has real pages to test against', () => {
		// Non-zero denominator. A detector proven against nothing is proven of nothing, and
		// this is the half of the corpus that genuinely exists.
		expect(pages.length).toBeGreaterThan(6);
	});

	for (const p of realPages()) {
		it(`does not fire on ${p.name}`, () => {
			const v = detect(p.body, p.contentType, 'utf-8');
			expect(v.blocked, `${p.name} was called a block by ${v.ruleId}`).toBe(false);
		});
	}

	it('does not fire on ordinary prose that merely discusses blocking', () => {
		// The obvious naive rules — "captcha", "access denied", "are you a robot" — would all
		// fire on an article about bot detection. Every rule here is anchored to a vendor
		// asset path instead, precisely so this passes.
		const article = `<html><body><h1>How CAPTCHA works</h1>
			<p>Access denied pages are common. Cloudflare, DataDome and PerimeterX all
			challenge suspicious traffic. Are you a robot? Please verify you are human.</p>
			</body></html>`;
		expect(detect(enc(article), 'text/html', 'utf-8').blocked).toBe(false);
	});

	it('does not run on JSON, whatever the body contains', () => {
		// integrations.md's fixture matrix says detection must not run on the JSON case.
		const json = JSON.stringify({ note: 'geo.captcha-delivery.com _Incapsula_Resource' });
		expect(detect(enc(json), 'application/json', 'utf-8').blocked).toBe(false);
	});
});

describe('the fire half — rule unit tests, NOT fixtures', () => {
	// These inputs are synthetic and deliberately minimal: each is the vendor token the rule
	// looks for, nothing more. They are unit tests of a pure function, not recordings, and
	// they live here rather than in any fixtures/ directory precisely so nothing can mistake
	// them for captured traffic. A hand-written FIXTURE would be a fabrication; a hand-written
	// input to a string matcher is just a test.
	const samples: Record<string, string> = {
		'cloudflare-challenge':
			'<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>',
		'cloudflare-blocked': '<div class="cf-error-details">Sorry, you have been blocked</div>',
		datadome: '<script src="https://geo.captcha-delivery.com/captcha/"></script>',
		perimeterx: '<div id="px-captcha"></div>',
		'imperva-incapsula': '<iframe src="/_Incapsula_Resource?SWUDNSAI=31"></iframe>',
		'akamai-bot-manager': '<img src="//errors.edgesuite.net/images/generic.gif">',
	};

	it('covers every registered rule, so a new rule cannot arrive untested', () => {
		expect(Object.keys(samples).sort()).toEqual(RULES.map((r) => r.id).sort());
	});

	for (const [id, html] of Object.entries(samples)) {
		it(`${id} fires on its own signature`, () => {
			const v = detect(enc(`<html><body>${html}</body></html>`), 'text/html', 'utf-8');
			expect(v.blocked).toBe(true);
			expect(v.ruleId).toBe(id);
		});
	}
});

describe('what this detector CANNOT catch, pinned with a real capture', () => {
	// A real response from web-scraping.dev/blocked — Scrapfly's purpose-built scraping test
	// site, which exists to be scraped, so capturing it breaks no terms and names no
	// commercial target. plan.md section 19 bars the obvious alternatives: Amazon and
	// LinkedIn would both produce a genuine challenge page, and committing one would be
	// dated, self-published evidence of automated access against a named site's defences.
	const bespoke = JSON.parse(
		readFileSync(join(ROOT, 'packages/detect/corpus/bespoke-block.json'), 'utf8'),
	) as { status: number; contentType: string; bodyBase64: string };

	it('is a real 200 that plainly says the caller was blocked', () => {
		expect(bespoke.status).toBe(200);
		const html = Buffer.from(bespoke.bodyBase64, 'base64').toString('utf8');
		expect(html).toContain("You've been blocked");
	});

	it('DOES NOT FIRE, and that is the documented limitation', () => {
		// No vendor fingerprint — the server is plain uvicorn, with none of Cloudflare's,
		// DataDome's or Imperva's markup. Every rule here is anchored to a vendor asset path
		// on purpose, so a site that rolls its own block page slips through and we call it OK.
		//
		// The fix is NOT a rule matching "you've been blocked": that is generic prose, and the
		// no-fire test above proves it would flag an article about bot detection. Catching a
		// bespoke block needs a different signal — a baseline for that domain, or a user
		// telling us — and that is not a string match.
		//
		// This assertion is deliberately inverted. The day someone finds a safe signal, it
		// fails, and flipping it is the visible record that the gap closed.
		const v = detect(
			new Uint8Array(Buffer.from(bespoke.bodyBase64, 'base64')),
			bespoke.contentType,
			'utf-8',
		);
		expect(v.blocked, 'a rule now catches bespoke blocks — update this test deliberately').toBe(
			false,
		);
	});
});

describe('the corpus gap is stated, not discovered', () => {
	it('reports every rule that no stored capture has confirmed', () => {
		// THE DAY ARRIVED. This used to assert all six rules were unverified, with a comment
		// saying the day a real capture landed, flipping the flag would be a visible change here.
		// One landed: `cloudflare-challenge` fires on a real Cloudflare interstitial captured from
		// a bot-detection test page, and it is the first rule in this project confirmed against
		// the thing it describes.
		//
		// The count is not asserted, deliberately. Pinning it would make every future capture a
		// test edit, and the number is not the invariant — the DERIVATION is. A rule is off this
		// list only because `verified.ts` names it, and `verified.ts` is generated by running the
		// stored captures through this same `detect()`.
		const unverified = unverifiedRules();
		const verified = RULES.filter((r) => verificationFor(r.id) !== undefined).map((r) => r.id);
		expect([...unverified, ...verified].sort()).toEqual(RULES.map((r) => r.id).sort());
		expect(unverified.length + verified.length).toBe(RULES.length);
		// And the gap is still real, or this file should say something else entirely.
		expect(unverified.length).toBeGreaterThan(0);
	});

	it('cites an artefact for every rule it calls confirmed', () => {
		// A claim with no digest is the boolean this replaced, wearing a table. Each verified rule
		// must name at least one capture by hash, and count at least one.
		for (const r of RULES) {
			const v = verificationFor(r.id);
			if (v === undefined) continue;
			expect(v.captures, `${r.id} is verified by zero captures`).toBeGreaterThan(0);
			expect(v.digests.length, `${r.id} cites no capture digest`).toBeGreaterThan(0);
			// Classes of target, never names — plan.md section 19.
			for (const c of v.classes) expect(c).toMatch(/^[a-z0-9-]+$/);
		}
	});

	it('every rule cites where its signature comes from', () => {
		// A rule sourced from memory is folklore. Each must name a vendor behaviour.
		for (const r of RULES) {
			expect(r.source.length, `${r.id} has no source`).toBeGreaterThan(20);
		}
	});
});

describe("decoding is this layer's job, not the adapter's", () => {
	it('reads a non-UTF-8 page using the declared charset', () => {
		// The contract hands over undecoded bytes so /detect fingerprints the page rather
		// than someone else's mojibake. windows-1252 bytes with a signature in ASCII range.
		const bytes = new Uint8Array([
			...enc('<html><body>'),
			0xa9,
			...enc('<div id="px-captcha"></div></body></html>'),
		]);
		expect(detect(bytes, 'text/html', 'windows-1252').ruleId).toBe('perimeterx');
	});

	it('survives an unknown charset label instead of throwing', () => {
		const v = detect(enc('<html>hello</html>'), 'text/html', 'not-a-charset');
		expect(v.blocked).toBe(false);
	});
});
