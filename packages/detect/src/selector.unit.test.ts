// `elementPresent`: whether a page holds the element a caller waited for.
//
// Three answers, and each has a test group below. A wrong `false` is the expensive one: it fails
// over a page that was fine and bills a second provider for it. So the traps a real rendered page
// sets (a `>` inside a quoted attribute, a class name inside a script, a comment) are pinned, and
// the adversarial inputs are timed, because this runs on every `wait_for` request.

import { describe, expect, it } from 'vitest';
import { elementPresent, elementPresentIn, parseSimpleSelector } from './selector.js';

const page = `<!doctype html><html><body>
<div id="main" class="listing  wide" data-loaded="true" title="a > b">
  <p class='item'>one</p><p class=item>two</p>
  <input type="text" disabled>
</div>
<!-- <section id="commented"></section> -->
<script>var t = '<div class="in-script"></div>';</script>
<style>.x::before { content: "<span id=in-style>"; }</style>
</body></html>`;

describe('present', () => {
	it.each([
		['#main'],
		['.listing'],
		['.listing.wide'],
		['div.listing#main'],
		['[data-loaded]'],
		['[data-loaded="true"]'],
		["[data-loaded='true']"],
		['[data-loaded=true]'],
		['p.item'],
		['input[disabled]'],
		['DIV#main'],
		['*#main'],
		['#nope, #main'],
	])('%s', (selector) => {
		expect(elementPresent(page, selector)).toBe(true);
	});

	it('reads attributes after a quoted value that contains ">"', () => {
		// `title="a > b"` comes before nothing here, so put the class after it.
		expect(elementPresent('<div title="a > b" class="after"></div>', '.after')).toBe(true);
	});

	it('finds the late element in the rendered canary page', () => {
		expect(
			elementPresent('<body><p id="placeholder">x</p><p id="late">ok</p></body>', '#late'),
		).toBe(true);
	});
});

describe('absent', () => {
	it.each([
		['#late'],
		['.missing'],
		['span.listing'],
		['[data-loaded="false"]'],
		['#main#other'],
		['.listing.narrow'],
		['#nope, .also-nope'],
	])('%s', (selector) => {
		expect(elementPresent(page, selector)).toBe(false);
	});

	it('does not count an element inside a comment, a script or a style block', () => {
		expect(elementPresent(page, '#commented')).toBe(false);
		expect(elementPresent(page, '.in-script')).toBe(false);
		expect(elementPresent(page, '#in-style')).toBe(false);
	});

	it('does not count the placeholder page the canary serves before its content arrives', () => {
		expect(elementPresent('<body><p id="placeholder">not yet</p></body>', '#late')).toBe(false);
	});

	it('matches a class as a whole token, never a substring', () => {
		expect(elementPresent('<div class="listings"></div>', '.listing')).toBe(false);
	});
});

describe('beyond what it judges, so it claims nothing', () => {
	it.each([
		['.results > li'],
		['div p'],
		['a + b'],
		['a ~ b'],
		['li:nth-child(2)'],
		['a:not(.x)'],
		['[href^="https"]'],
		['[class*=x]'],
		[''],
		['a,'],
		['#1bad'],
	])('%j', (selector) => {
		expect(parseSimpleSelector(selector)).toBeUndefined();
		expect(elementPresent(page, selector)).toBeUndefined();
	});
});

describe('adversarial pages stay linear', () => {
	const within = (ms: number, f: () => unknown) => {
		const t0 = performance.now();
		f();
		expect(performance.now() - t0).toBeLessThan(ms);
	};

	it('an unclosed script, repeated', () => {
		const html = '<script>'.repeat(200_000);
		within(1_000, () => expect(elementPresent(html, '#x')).toBe(false));
	});

	it('an unclosed comment, repeated', () => {
		within(1_000, () => expect(elementPresent('<!--'.repeat(200_000), '#x')).toBe(false));
	});

	it('a tag with a huge run of attributes and no end', () => {
		within(1_000, () =>
			expect(elementPresent(`<div ${'a '.repeat(500_000)}`, '#x')).toBe(false),
		);
	});

	it('an unterminated quote', () => {
		within(1_000, () =>
			expect(elementPresent(`<div title="${'x'.repeat(1_000_000)}`, '#x')).toBe(false),
		);
	});

	it('a page of ten thousand ordinary elements', () => {
		const html = '<div class="row"><span>x</span></div>'.repeat(10_000);
		within(1_000, () => expect(elementPresent(html, '#x')).toBe(false));
	});
});

describe('bytes', () => {
	it("decodes by the page's charset", () => {
		const latin1 = new Uint8Array(Buffer.from('<p id="café">x</p>', 'latin1'));
		expect(elementPresentIn(latin1, 'iso-8859-1', '#late')).toBe(false);
		expect(elementPresentIn(latin1, 'iso-8859-1', 'p')).toBe(true);
	});

	it('falls back to UTF-8 for a charset label it does not know', () => {
		const bytes = new TextEncoder().encode('<p id="late">x</p>');
		expect(elementPresentIn(bytes, 'not-a-charset', '#late')).toBe(true);
	});
});
