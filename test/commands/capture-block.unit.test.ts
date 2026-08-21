// `pnpm capture-block`, and mostly the one decision inside it.
//
// The tool exists because `/detect` ships six rules with `verifiedAgainstRealCapture: false` on
// all six, and there was no way to turn a real block page into a corpus entry even when somebody
// had one — `record.ts` names `--from-exchange` in a comment and the flag never existed.
//
// WHAT IS ACTUALLY WORTH PINNING is not the file writing. It is `destinationFor`, which is
// `plan.md` section 19 expressed as code: a capture of a named commercial target must never land
// in this repository. That rule used to live in a reviewer's memory, and a reviewer who forgets
// it publishes dated evidence of automated access against somebody's property. A pure function
// can be held to it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

import { buildCapture, destinationFor, registrableHost } from '../../scripts/capture-block.ts';

const PRIVATE = '/tmp/proxlane-corpus';

describe('section 19 decides where a capture lands, and the caller cannot argue', () => {
	it('sends a named commercial target to the private corpus, never here', () => {
		const d = destinationFor('https://www.example-shop.com/product/1', PRIVATE);
		expect(d.kind).toBe('private');
		if (d.kind === 'private') expect(d.dir).toBe(PRIVATE);
	});

	it('REFUSES a named target when there is nowhere private to put it', () => {
		// The important direction. Falling back to the public corpus "just this once" is exactly
		// the failure section 19 describes, and an absent env var must not be read as consent.
		for (const nowhere of [undefined, '', '   ']) {
			const d = destinationFor('https://www.example-shop.com/x', nowhere);
			expect(d.kind, `privateDir=${JSON.stringify(nowhere)}`).toBe('refused');
		}
	});

	it('allows a purpose-built scraping sandbox into the public corpus', () => {
		// These publish themselves as sandboxes, so a stored response names nobody's commercial
		// property. `web-scraping.dev` is already the source of the one real capture in the repo.
		for (const url of [
			'https://web-scraping.dev/blocked',
			'https://httpbin.dev/html',
			'https://books.toscrape.com/',
			'https://quotes.toscrape.com/js/',
		]) {
			const d = destinationFor(url, PRIVATE);
			expect(d.kind, url).toBe('public');
		}
	});

	it('matches a subdomain of a sandbox but not a lookalike', () => {
		// `web-scraping.dev.evil.com` must not pass as the sandbox, and a bare suffix test would
		// let it. Equally `api.httpbin.dev` is genuinely the same site.
		expect(registrableHost('https://api.httpbin.dev/x')).toBe('httpbin.dev');
		expect(registrableHost('https://web-scraping.dev.evil.com/x')).toBeUndefined();
		expect(registrableHost('https://notweb-scraping.dev/x')).toBeUndefined();
	});

	it('refuses a target it cannot parse rather than guessing', () => {
		expect(registrableHost('not a url')).toBeUndefined();
		expect(destinationFor('not a url', undefined).kind).toBe('refused');
	});
});

describe('two captures never share a filename', () => {
	// IT HAPPENED. The name was `rule-class-date`, and two ordinary pages from the same vendor
	// site captured on the same day produced the same one — the second silently overwrote the
	// first, losing a capture deliberately taken from a different network.
	//
	// `buildCapture` does not name files, so this asserts the property the name is derived from:
	// two different bodies must differ somewhere a digest can see.
	it('gives different bodies different content', () => {
		const a = buildCapture(
			{ url: 'https://x.test/', status: 200, body: '<html>one</html>' },
			{ rule: 'none', targetClass: 'sandbox', now: '2026-08-21T00:00:00.000Z' },
			[],
		);
		const b = buildCapture(
			{ url: 'https://x.test/', status: 200, body: '<html>two</html>' },
			{ rule: 'none', targetClass: 'sandbox', now: '2026-08-21T00:00:00.000Z' },
			[],
		);
		// Same rule, same class, same day — everything the old filename used.
		expect(a.rule).toBe(b.rule);
		expect(a.targetClass).toBe(b.targetClass);
		expect(a.capturedAt.slice(0, 10)).toBe(b.capturedAt.slice(0, 10));
		// And the only thing that distinguishes them is the body, which the name now includes.
		expect(a.bodyBase64).not.toBe(b.bodyBase64);
	});

	it('names files by content, so a re-capture of the same bytes is a no-op', () => {
		const src = readFileSync(join(HERE, '..', '..', 'scripts', 'capture-block.ts'), 'utf8');
		expect(src).toMatch(/createHash\('sha256'\)[\s\S]{0,80}bodyBase64/);
		expect(src).toContain('${digest}.json');
	});
});

describe('a capture carries no name and no secret', () => {
	const ex = {
		url: 'https://www.example-shop.com/p/1',
		status: 200,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'x-sapi-api_key': 'sk-live-abcdefghijklmnop',
			'set-cookie': 'sess=abc',
		},
		body: '<html>blocked, key sk-live-abcdefghijklmnop</html>',
	};
	const cap = buildCapture(
		ex,
		{ rule: 'datadome', targetClass: 'ecommerce', now: '2026-08-21T00:00:00.000Z' },
		['sk-live-abcdefghijklmnop'],
	);

	it('stores a CLASS of target and never the host', () => {
		// Section 19: "Public pages, scoreboards and comparisons report classes of target, never
		// names." Dropped even in the private half, so a corpus that later becomes publishable
		// does not need re-sanitising by somebody who has forgotten why.
		const json = JSON.stringify(cap);
		expect(cap.targetClass).toBe('ecommerce');
		expect(json).not.toContain('example-shop');
		expect(json).not.toContain(ex.url);
	});

	it('redacts a key from the headers and from the body', () => {
		const json = JSON.stringify(cap);
		expect(json).not.toContain('sk-live-abcdefghijklmnop');
		expect(cap.headers['x-sapi-api_key']).toBe('REDACTED');
		expect(cap.headers['set-cookie']).toBe('REDACTED');
		// And the body really is the sanitised one, not an empty string that trivially passes.
		const body = Buffer.from(cap.bodyBase64, 'base64').toString('utf8');
		expect(body).toContain('blocked');
		expect(body).not.toContain('sk-live-abcdefghijklmnop');
	});

	it('records where it came from, so the two halves stay distinguishable', () => {
		expect(cap.source).toBe('live-traffic');
		const sandbox = buildCapture(
			{ ...ex, url: 'https://web-scraping.dev/blocked' },
			{ rule: 'none', targetClass: 'sandbox', now: '2026-08-21T00:00:00.000Z' },
			[],
		);
		expect(sandbox.source).toBe('purpose-built');
	});

	it('keeps bytes as bytes when given them', () => {
		// A charset the text form would mangle is exactly the case a block page arrives in.
		const bytes = Buffer.from('<html>ÿþ blocked</html>', 'latin1').toString('base64');
		const c = buildCapture(
			{ url: 'https://web-scraping.dev/x', status: 200, bodyBase64: bytes },
			{ rule: 'none', targetClass: 'sandbox', now: '2026-08-21T00:00:00.000Z' },
			[],
		);
		expect(c.bodyBase64).toBe(bytes);
	});
});
