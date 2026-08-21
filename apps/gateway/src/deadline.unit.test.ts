// The per-request deadline clamp, which nothing could observe.
//
// `app.e2e.test.ts` had a test named "cannot ask for MORE than the server budgeted" whose only
// assertion was `expect(r.status).toBe(200)` — true with the clamp and true without it. The
// effective deadline reaches no response header, so there was nothing end to end could see, and
// the check that mattered most about it could not fail.
//
// The clamp bounds how long one request holds an in-flight slot, and `maxInflight` is sized on
// the assumption that it holds, so removing it makes the memory arithmetic in operations.md
// section 1 false.

import { describe, expect, it } from 'vitest';
import { requestedDeadline } from './app.js';
import { MIN_USEFUL_ATTEMPT_MS } from './budget.js';

const BUDGET = 90_000;

describe('a caller may ask for less time than the operator budgeted', () => {
	it('honours a smaller ask', () => {
		expect(requestedDeadline('10000', BUDGET)).toBe(10_000);
	});

	it('falls back to the server budget when nothing was asked', () => {
		expect(requestedDeadline(undefined, BUDGET)).toBe(BUDGET);
		expect(requestedDeadline('', BUDGET)).toBe(BUDGET);
	});
});

describe('a caller may never ask for more', () => {
	// THE ASSERTION THE E2E TEST WAS NAMED FOR AND DID NOT MAKE.
	it('clamps an ask above the budget down to the budget', () => {
		expect(requestedDeadline('99999999', BUDGET)).toBe(BUDGET);
	});

	it('clamps even one millisecond over', () => {
		// The off-by-one direction, so `<=` cannot pass for `<`.
		expect(requestedDeadline(String(BUDGET + 1), BUDGET)).toBe(BUDGET);
		expect(requestedDeadline(String(BUDGET), BUDGET)).toBe(BUDGET);
	});

	it('never returns more than the budget for any input', () => {
		// Quantified, so a clamp that handles the obvious case and leaks on another cannot pass.
		for (const raw of [
			'8000',
			'90000',
			'90001',
			'120000',
			'99999999',
			String(Number.MAX_SAFE_INTEGER),
		]) {
			const got = requestedDeadline(raw, BUDGET);
			if (got === 'invalid') continue;
			expect(got, `timeout=${raw}`).toBeLessThanOrEqual(BUDGET);
		}
	});
});

describe('an unusable ask is a 400, not a 504 for a request that never tried', () => {
	it.each(['0', '-5', 'abc', '1.5', '7999', 'Infinity', 'NaN', ' '])('rejects %s', (raw) => {
		expect(requestedDeadline(raw, BUDGET)).toBe('invalid');
	});

	it('has a real floor to test against', () => {
		// The first version of this file imported the constant from `@proxlane/shared`, where it
		// does not live, so it was `undefined` — and `String(undefined)` is rejected exactly
		// like a real bad value, which would have made the boundary case below pass for the
		// wrong reason.
		expect(Number.isInteger(MIN_USEFUL_ATTEMPT_MS)).toBe(true);
		expect(MIN_USEFUL_ATTEMPT_MS).toBeGreaterThan(0);
	});

	it('accepts exactly the floor', () => {
		// The boundary in the other direction. Without this, `<= floor` would pass as `< floor`.
		expect(requestedDeadline(String(MIN_USEFUL_ATTEMPT_MS), BUDGET)).toBe(
			MIN_USEFUL_ATTEMPT_MS,
		);
		expect(requestedDeadline(String(MIN_USEFUL_ATTEMPT_MS - 1), BUDGET)).toBe('invalid');
	});
});
