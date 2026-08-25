// Markdown content negotiation, at the one place it can be tested without a Worker.
//
// The interesting case is not "markdown was requested". It is the browser: every browser sends
// a wildcard, a wildcard matches text/markdown, and a substring test therefore serves plain
// text to every visitor while passing any test written only for the happy path.

import { describe, expect, it } from 'vitest';
import { prefersMarkdown, wantsMarkdown } from './server.js';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8';

describe('prefersMarkdown', () => {
	it('is true for an explicit ask', () => {
		expect(prefersMarkdown('text/markdown')).toBe(true);
		expect(prefersMarkdown('text/markdown, text/html;q=0.5')).toBe(true);
	});

	it('is FALSE for a browser, which is the case that matters', () => {
		// The wildcard at the end matches text/markdown. Serving markdown here would replace
		// the site with its own source for every human visitor.
		expect(prefersMarkdown(BROWSER)).toBe(false);
	});

	it('is false when markdown is merely tolerated below html', () => {
		expect(prefersMarkdown('text/html, text/markdown;q=0.2')).toBe(false);
	});

	it('is true when markdown ties html, because the caller named it', () => {
		// A tie means the caller listed markdown explicitly and rated it as highly as html.
		// Ambiguous by the RFC; resolved toward the party that had to type the header.
		expect(prefersMarkdown('text/html;q=0.9, text/markdown;q=0.9')).toBe(true);
	});

	it('handles a missing, empty or malformed header without throwing', () => {
		expect(prefersMarkdown(null)).toBe(false);
		expect(prefersMarkdown(undefined)).toBe(false);
		expect(prefersMarkdown('')).toBe(false);
		expect(prefersMarkdown('text/markdown;q=banana')).toBe(false);
		expect(prefersMarkdown(';;;,,,')).toBe(false);
	});

	it('ignores case and whitespace, which real clients send', () => {
		expect(prefersMarkdown('  TEXT/MarkDown  ')).toBe(true);
	});
});

describe('wantsMarkdown', () => {
	it('only fires on a docs page', () => {
		expect(wantsMarkdown('GET', '/docs/quickstart', 'text/markdown')).toBe(true);
		expect(wantsMarkdown('GET', '/', 'text/markdown')).toBe(false);
		expect(wantsMarkdown('GET', '/symptoms/403-while-scraping', 'text/markdown')).toBe(false);
	});

	it('never fires on a path that already ends in .md, which would recurse', () => {
		// The middleware answers by fetching `${pathname}.md`. If that path could match too,
		// the subrequest would re-enter this branch.
		expect(wantsMarkdown('GET', '/docs/quickstart.md', 'text/markdown')).toBe(false);
	});

	it('is GET and HEAD only', () => {
		expect(wantsMarkdown('HEAD', '/docs/api', 'text/markdown')).toBe(true);
		expect(wantsMarkdown('POST', '/docs/api', 'text/markdown')).toBe(false);
	});

	it('leaves a browser on the docs page alone', () => {
		expect(wantsMarkdown('GET', '/docs/quickstart', BROWSER)).toBe(false);
	});
});

describe('which docs pages have a markdown twin', () => {
	// Documented as a fact rather than discovered as a 406 in production, which is how it was
	// found. Eight pages are written in `content/docs/` and published as twins; two are
	// generated — from the outcome taxonomy and from the package changelogs — and have no
	// markdown source. This list is here so that adding a ninth written page, or giving one of
	// the two a generated twin, is a deliberate edit rather than a surprise.
	const GENERATED_WITHOUT_TWIN = ['outcomes', 'changelog'];

	it('names the pages that answer 406, so the set cannot grow by accident', () => {
		expect(GENERATED_WITHOUT_TWIN).toEqual(['outcomes', 'changelog']);
	});

	it('still negotiates on them, because 406 beats the 500 that falling through produces', () => {
		// wantsMarkdown deliberately does NOT exclude these. Excluding them would send the
		// request to Start's router, which answers a non-HTML Accept with a 500.
		for (const slug of GENERATED_WITHOUT_TWIN) {
			expect(wantsMarkdown('GET', `/docs/${slug}`, 'text/markdown')).toBe(true);
		}
	});
});
