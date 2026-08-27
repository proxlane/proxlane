// `X-Ignored-Params` — the gateway naming what it threw away.
//
// This exists because of a real failure, not a hypothetical one. A caller sent `js_render=true`
// (ScrapingBee's spelling) and `js=true` (Scrapfly's), got HTTP 200 both times, and spent a day
// concluding the gateway could not render. Measured 2026-08-27 against `/canary/js`:
// `render=true` returned the JS-only marker at five credits, `js_render=true` returned the
// unrendered document at one. Every signal a caller has said success.
//
// The taxonomy has a name for that shape — a 200 that is not the thing you asked for — and the
// whole product is built on refusing to serve one silently.

import { describe, expect, it } from 'vitest';
import { ignoredParams } from './app.js';

describe('ignoredParams', () => {
	it('names the other providers’ spellings of render', () => {
		// The exact two that cost a day.
		expect(ignoredParams('?url=https://example.com&js_render=true')).toEqual(['js_render']);
		expect(ignoredParams('?url=https://example.com&js=true')).toEqual(['js']);
	});

	it('says nothing when every parameter is one we read', () => {
		// Absent, not empty. A header on every response is noise, and noise is how a real signal
		// stops being read.
		expect(
			ignoredParams(
				'?api_key=k&url=https://example.com&render=true&premium=residential' +
					'&country_code=us&provider=scrapfly&binary=true&timeout=30000',
			),
		).toEqual([]);
	});

	it('reports a repeated unknown key once', () => {
		// `?js=1&js=2` is one mistake, not two.
		expect(ignoredParams('?js=1&js=2')).toEqual(['js']);
	});

	it('sorts, so the header is stable across query orderings', () => {
		// Two callers making the same mistake should be able to grep the same string.
		expect(ignoredParams('?zebra=1&alpha=2')).toEqual(['alpha', 'zebra']);
		expect(ignoredParams('?alpha=2&zebra=1')).toEqual(['alpha', 'zebra']);
	});

	it('reports an unknown parameter that carries no value', () => {
		// `wait_for` is ScrapingBee's and Scrapfly's, and a caller who types it bare still meant
		// something by it. Nothing was assigned, so nothing looks wrong — which is the point.
		expect(ignoredParams('?url=https://example.com&wait_for')).toEqual(['wait_for']);
	});

	it('is empty for a query string with no parameters at all', () => {
		expect(ignoredParams('')).toEqual([]);
		expect(ignoredParams('?')).toEqual([]);
	});

	// -------------------------------------------------------- the header must not become the bug

	it('does not emit a name carrying CR or LF, and counts it instead', () => {
		// THE REGRESSION THIS FILTER EXISTS FOR. URLSearchParams percent-decodes, so this key is
		// literally `a\r\nX-Foo: bar`, and `Headers.set` throws a TypeError on it — an unhandled
		// throw in the middleware, which is a 500 on a request that would otherwise have been
		// served. Measured 2026-08-27: 500 with the raw name, 200 with it filtered.
		expect(ignoredParams('?a%0d%0aX-Foo:%20bar=1')).toEqual(['+1']);
	});

	it('still names the safe parameters alongside an unreportable one', () => {
		// The dangerous name must not take the useful one down with it.
		expect(ignoredParams('?js_render=true&a%0d%0aevil=1')).toEqual(['js_render', '+1']);
	});

	it('caps the list and says how many it did not name', () => {
		// A junk query must not produce a header of unbounded length, and the count must stay true
		// — a header that silently under-reports is the exact failure this change removes.
		const qs = Array.from({ length: 25 }, (_, i) => `p${String(i).padStart(2, '0')}=1`).join(
			'&',
		);
		const out = ignoredParams(`?${qs}`);
		expect(out).toHaveLength(11);
		expect(out[0]).toBe('p00');
		expect(out[9]).toBe('p09');
		expect(out[10]).toBe('+15');
	});

	it('produces a value Headers accepts, for every case above', () => {
		// The property that actually matters, asserted directly rather than inferred. If this ever
		// throws, the middleware 500s.
		for (const qs of [
			'?a%0d%0aX-Foo:%20bar=1',
			'?js_render=true&a%0d%0aevil=1',
			`?${Array.from({ length: 25 }, (_, i) => `p${i}=1`).join('&')}`,
			'?\u00e9t\u00e9=1',
			`?${'x'.repeat(200)}=1`,
		]) {
			const v = ignoredParams(qs).join(',');
			expect(() => new Headers({ 'X-Ignored-Params': v })).not.toThrow();
		}
	});

	it('counts a name that is merely too long, rather than printing it', () => {
		expect(ignoredParams(`?${'x'.repeat(200)}=1`)).toEqual(['+1']);
	});
});
