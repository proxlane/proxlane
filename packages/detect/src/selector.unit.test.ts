// `elementPresent`: whether a page holds the element a caller waited for.
//
// Three answers, and each has a test group below. A wrong `false` is the expensive one: it fails
// over a page that was fine and bills a second provider for it. So the traps a real rendered page
// sets (a `>` inside a quoted attribute, a class name inside a script, a comment) are pinned, and
// the adversarial inputs are timed, because this runs on every `wait_for` request.

import { describe, expect, it } from 'vitest';
import {
	elementPresent,
	elementPresentIn,
	MAX_SELECTOR_SCAN_BYTES,
	parseSimpleSelector,
} from './selector.js';

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

describe('what the first review found (#387)', () => {
	it('keeps its place on a page whose lowercase is longer than itself', () => {
		// `İ` lowercases to two code units. Positions found in a lowercased copy drifted one per
		// `İ`, so a script stayed in and markup after it was skipped: a wrong answer both ways.
		const html = `${'<p>İstanbul</p>'.repeat(50)}<script>var x = '<i id="late">';</script><p id="late">ok</p>`;
		expect(elementPresent(html, '#late')).toBe(true);
		expect(
			elementPresent(`${'İ'.repeat(50)}<script>'<b class="fake">'</script>`, '.fake'),
		).toBe(false);
	});

	it('does not read a custom element as the raw-text element its name starts with', () => {
		// `<script-loader>` is a web component, not a script: `\b` matched it and everything
		// after it was dropped as script text.
		const html = '<script-loader src="x"></script-loader><p id="late">ok</p>';
		expect(elementPresent(html, '#late')).toBe(true);
		expect(elementPresent('<template-card></template-card><p class="x">', '.x')).toBe(true);
	});

	it('ends an empty comment where the spec does', () => {
		expect(elementPresent('<!--><p id="late">ok</p><!-- x -->', '#late')).toBe(true);
		expect(elementPresent('<!---><p id="late">ok</p><!-- x -->', '#late')).toBe(true);
	});

	it('does not count the fallback markup in a noscript, or text in a title or textarea', () => {
		expect(elementPresent('<noscript><div class="results"></div></noscript>', '.results')).toBe(
			false,
		);
		expect(elementPresent('<title><b id="late"></b></title>', '#late')).toBe(false);
		expect(elementPresent('<textarea><b id="late"></b></textarea>', '#late')).toBe(false);
		// And still sees what follows them.
		expect(elementPresent('<noscript>x</noscript><div class="results">', '.results')).toBe(
			true,
		);
	});

	it('decodes the entities an attribute value is likely to carry', () => {
		expect(
			elementPresent('<p id="caf&eacute;"></p><p data-q="a&amp;b"></p>', '[data-q="a&b"]'),
		).toBe(true);
		expect(elementPresent('<p id="&#x6C;ate"></p>', '#late')).toBe(true);
	});

	it('reports a page above the scan cap as unverified, never as missing', () => {
		const big = `${' '.repeat(MAX_SELECTOR_SCAN_BYTES)}<p id="late">`;
		expect(elementPresent(big, '#late')).toBeUndefined();
		expect(elementPresentIn(new TextEncoder().encode(big), 'utf-8', '#late')).toBeUndefined();
	});

	it('scans a page at the cap made of nothing but tags inside the hot-path budget', () => {
		// The worst shapes a target can send: the most tags per byte, and one tag with the most
		// distinct attribute names, which used to become a million-entry Map.
		const tags = '<a>'.repeat(Math.floor(MAX_SELECTOR_SCAN_BYTES / 3));
		const names = `<div ${Array.from({ length: 200_000 }, (_, k) => `a${k}`).join(' ')}>`.slice(
			0,
			MAX_SELECTOR_SCAN_BYTES,
		);
		for (const html of [tags, names]) {
			elementPresent(html, '#x'); // warm
			const t0 = performance.now();
			expect(elementPresent(html, '#x')).toBe(false);
			expect(performance.now() - t0).toBeLessThan(250);
		}
	});
});

describe('what the second review found (#387)', () => {
	it('reads a whole tag name, so script_x is not a script', () => {
		expect(elementPresent('<script_x></script_x><p id="late">ok</p>', '#late')).toBe(true);
		expect(elementPresent('<title.x></title.x><p id="late">ok</p>', '#late')).toBe(true);
		expect(elementPresent('<my_el id="late"></my_el>', 'my_el')).toBe(true);
	});

	it('treats title and style inside SVG as elements, and raw text again after it', () => {
		const svg = '<svg><title>t</title><style>s</style></svg><p id="late">ok</p>';
		expect(elementPresent(svg, '#late')).toBe(true);
		expect(elementPresent('<svg><title><b class="x"></b></title></svg>', '.x')).toBe(true);
		expect(elementPresent('<svg></svg><title><b class="x"></b></title>', '.x')).toBe(false);
		// A self-closing svg opens nothing.
		expect(elementPresent('<svg/><title><b class="x"></b></title>', '.x')).toBe(false);
	});

	it('splits a class list on ASCII whitespace only', () => {
		expect(elementPresent('<p class="a\u00a0b"></p>', '.a')).toBe(false);
		expect(elementPresent('<p class="a\tb"></p>', '.b')).toBe(true);
	});
});
