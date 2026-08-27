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
});
