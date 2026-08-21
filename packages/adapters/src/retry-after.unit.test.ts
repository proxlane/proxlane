// `retryAfterMsFrom`, and the field it finally fills.
//
// `ParsedResult.retryAfterMs` has been in the contract since it landed, and `chain.ts` already
// armed cooldowns from it — and NO ADAPTER EVER SET IT. A provider that capped us and said
// exactly how long to wait had that answer discarded, the cooldown fell back to a 30s jittered
// guess, and the caller received a bare 429. The field was plumbed end to end with nothing at
// the source.

import { describe, expect, it } from 'vitest';
import { retryAfterMsFrom } from './contract.js';

const AT = Date.parse('2026-08-21T12:00:00.000Z');

describe('delta-seconds, the common form', () => {
	it('reads whole seconds', () => {
		expect(retryAfterMsFrom({ 'retry-after': '30' }, AT)).toBe(30_000);
	});

	it('reads zero as zero, not as absent', () => {
		// The distinction matters downstream: absent means "we do not know", zero means "now".
		expect(retryAfterMsFrom({ 'retry-after': '0' }, AT)).toBe(0);
	});

	it('accepts the header under either casing', () => {
		expect(retryAfterMsFrom({ 'Retry-After': '15' }, AT)).toBe(15_000);
	});
});

describe('an HTTP-date, which RFC 9110 equally allows', () => {
	it('converts a future date to a wait', () => {
		expect(retryAfterMsFrom({ 'retry-after': 'Fri, 21 Aug 2026 12:00:30 GMT' }, AT)).toBe(
			30_000,
		);
	});

	it('clamps a past date to zero rather than going negative', () => {
		// A negative wait is not a hint. Providers do send stale dates on a retried request.
		expect(retryAfterMsFrom({ 'retry-after': 'Fri, 21 Aug 2026 11:59:00 GMT' }, AT)).toBe(0);
	});
});

describe('absent or unusable is undefined, never a guess', () => {
	it.each([undefined, '', '   ', 'soon', 'not-a-date'])('%s', (raw) => {
		const headers = raw === undefined ? {} : { 'retry-after': raw };
		expect(retryAfterMsFrom(headers, AT)).toBeUndefined();
	});

	it('has a case that DOES parse, so the suite is not vacuous', () => {
		// Non-zero denominator. If the parser broke entirely, every case above would pass.
		expect(retryAfterMsFrom({ 'retry-after': '1' }, AT)).toBe(1000);
	});
});
