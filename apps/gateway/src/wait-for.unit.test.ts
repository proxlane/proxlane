// `wait_for`, at the edge: what it accepts, what it refuses, and what it implies.
//
// The gap it closes is a real one, reported by a caller running proxlane in production: the
// gateway renders, and on a late-hydrating page it returns the shell anyway. They measured
// 936KB with 50 results on one attempt and a 75KB empty shell on the next, from the same
// request. "Rendered" means the renderer ran, not that the content arrived, and nothing in
// the request could express the finish line.

import { describe, expect, it } from 'vitest';
import { ignoredParams } from './app.js';

describe('wait_for is a parameter the gateway knows', () => {
	it('is not reported as ignored', () => {
		// The whole reason this test exists in this file. Before the parameter shipped, the
		// gateway answered `X-Ignored-Params: wait_for` — correctly, and uselessly. A caller
		// reading that header is being told their intent was dropped; the fix is to honour it,
		// and the regression to guard is it silently leaving KNOWN_PARAMS again.
		expect(ignoredParams('?url=https://example.com&wait_for=.results')).toEqual([]);
	});

	it('still reports a neighbouring typo', () => {
		// A guard on the guard: `wait_for` being known must not make `waitfor` known.
		expect(ignoredParams('?url=https://example.com&waitfor=.results')).toEqual(['waitfor']);
		expect(ignoredParams('?url=https://example.com&wait_for_selector=.x')).toEqual([
			'wait_for_selector',
		]);
	});
});
