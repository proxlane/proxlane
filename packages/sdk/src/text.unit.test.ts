import { describe, expect, it } from 'vitest';
import { htmlToText, titleOf } from './text.js';

describe('htmlToText', () => {
	it('keeps the words, with a blank line between blocks', () => {
		expect(
			htmlToText('<div><h2>Lot 7</h2><p>Oak table</p><p>Sold &pound; no, &#163;40</p></div>'),
		).toBe('Lot 7\n\nOak table\n\nSold &pound; no, £40');
	});

	it('drops scripts, styles, templates, svg and comments, whatever their case', () => {
		const html =
			'<SCRIPT>var a="<p>x</p>"</SCRIPT><style>p{}</style><template><p>t</p></template>' +
			'<svg><text>s</text></svg><!-- c --><p>kept</p>';
		expect(htmlToText(html)).toBe('kept');
	});

	it('does not read script_x as a script', () => {
		expect(htmlToText('<script_x>a</script_x><p>b</p>')).toBe('a\nb');
	});

	it('keeps its place on a page whose lowercase is longer than itself', () => {
		// Turkish İ lowercases to two code units; a search in a lowercased copy would drift.
		expect(htmlToText(`${'İ'.repeat(40)}<script>x</script><p>after</p>`)).toBe(
			`${'İ'.repeat(40)}\nafter`,
		);
	});

	it('ends an empty comment where the spec does', () => {
		expect(htmlToText('<!--><p>after</p>')).toBe('after');
	});

	it('keeps the page when </head> is missing, as minified pages leave it', () => {
		expect(htmlToText('<html><head><title>T</title><body><p>content</p></body>')).toBe(
			'content',
		);
	});

	it('keeps the content of a minimal page whose head never ends', () => {
		expect(htmlToText('<head><title>T</title><script>x</script><p>Hello')).toBe('T\nHello');
	});

	it('keeps a < that does not start a tag', () => {
		expect(htmlToText('<p>3 < 5 is true</p><p>more</p>')).toBe('3 < 5 is true\n\nmore');
	});

	it('stays linear on hostile input', () => {
		for (const html of [
			'<title'.repeat(400_000),
			'<script>'.repeat(200_000),
			'<!--'.repeat(200_000),
			`<p ${'a'.repeat(1_000_000)}`,
		]) {
			const t0 = performance.now();
			htmlToText(html);
			titleOf(html);
			expect(performance.now() - t0).toBeLessThan(1_000);
		}
	});
});

describe('titleOf', () => {
	it('reads the title, decoded and trimmed', () => {
		expect(titleOf('<head><title>  A &amp; B </title></head>')).toBe('A & B');
	});

	it('is undefined without one', () => {
		expect(titleOf('<p>x</p>')).toBeUndefined();
	});
});
