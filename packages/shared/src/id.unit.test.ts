// uuidv7 is the primary key of a weekly-partitioned append-only table and the token a user
// pastes into a support thread. Both properties break quietly rather than loudly, so the
// bit-level layout and the ordering guarantees are asserted rather than assumed.

import { describe, expect, it } from 'vitest';
import {
	createIdGenerator,
	isValidRequestId,
	requestIdFrom,
	uuidv7,
	uuidv7Time,
} from './id.js';

/** RFC 9562: version nibble 7, variant bits 0b10 (hex 8, 9, a or b). */
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the encoding is a real UUIDv7', () => {
	it('carries the version and variant bits', () => {
		for (let i = 0; i < 500; i++) expect(uuidv7()).toMatch(V7);
	});

	it('embeds the millisecond it was given, readable back out', () => {
		// Its own generator: the shared one carries monotonic state from earlier tests, which
		// would correct this timestamp forward and quietly assert the guard instead.
		const t = Date.UTC(2026, 7, 12, 9, 30, 0);
		expect(uuidv7Time(createIdGenerator()(t))).toBe(t);
	});

	it('survives a timestamp past 2^32 ms, which 32-bit maths would truncate', () => {
		// 2038 and beyond. Writing the 48-bit field with `>>` silently wraps here.
		const t = Date.UTC(2064, 0, 1);
		expect(uuidv7Time(createIdGenerator()(t))).toBe(t);
	});
});

describe('ordering, which the partition and index layout depend on', () => {
	it('sorts lexicographically in the order it was generated', () => {
		const next = createIdGenerator();
		const base = Date.UTC(2026, 7, 12);
		const ids = [0, 1, 2, 5, 900, 100_000].map((d) => next(base + d));
		expect([...ids].sort()).toEqual(ids);
	});

	it('is strictly increasing inside a single millisecond', () => {
		const next = createIdGenerator();
		const t = Date.UTC(2026, 7, 12);
		const ids = Array.from({ length: 2000 }, () => next(t));
		expect([...ids].sort()).toEqual(ids);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('does not go backwards when the clock does', () => {
		// NTP steps and resumed laptops both do this. An id that regresses would break the
		// time-ordering the whole scheme exists for.
		const next = createIdGenerator();
		const t = Date.UTC(2026, 7, 12);
		const before = next(t);
		const during = next(t - 5_000);
		const after = next(t - 60_000);
		expect(during > before).toBe(true);
		expect(after > during).toBe(true);
	});

	it('rolls into the next millisecond rather than repeating when the counter fills', () => {
		// 4096 counter values; asking for more must stay unique and ordered, not wrap.
		const next = createIdGenerator();
		const t = Date.UTC(2026, 7, 12);
		const ids = Array.from({ length: 5000 }, () => next(t));
		expect(new Set(ids).size).toBe(5000);
		expect([...ids].sort()).toEqual(ids);
	});
});

describe('uniqueness', () => {
	it('produces no collisions across a large draw', () => {
		const ids = new Set(Array.from({ length: 20_000 }, () => uuidv7()));
		expect(ids.size).toBe(20_000);
	});
});

describe('a caller-supplied request id is untrusted input', () => {
	it.each([
		['a plain uuid', '0192f3a1-6b7c-7def-8123-456789abcdef'],
		['a trace id', 'trace_abc-123.4'],
		['one character', 'x'],
		['64 characters', 'a'.repeat(64)],
	])('accepts %s', (_label, value) => {
		expect(isValidRequestId(value)).toBe(true);
		expect(requestIdFrom(value)).toBe(value);
	});

	it.each([
		['a newline, which would split headers', 'abc\r\nX-Admin: 1'],
		['a bare CR', 'abc\rdef'],
		['a space', 'abc def'],
		['65 characters', 'a'.repeat(65)],
		['empty', ''],
		['a colon', 'abc:def'],
		['unicode', 'abc‮def'],
	])('rejects %s and substitutes its own', (_label, value) => {
		expect(isValidRequestId(value)).toBe(false);
		const got = requestIdFrom(value);
		expect(got).not.toBe(value);
		expect(got).toMatch(V7);
	});

	it('generates one when the caller sends nothing', () => {
		expect(requestIdFrom(undefined)).toMatch(V7);
		expect(requestIdFrom(null)).toMatch(V7);
	});

	it('never returns a value that could break a header, whatever the input', () => {
		// The property that actually matters, stated once over the whole surface rather than
		// per case: everything returned is printable ASCII, so no control character can reach a
		// response header. Checked by code point rather than by a regex, because a regex
		// containing those characters is itself what `noControlCharactersInRegex` forbids.
		for (const bad of ['\n', '\r', '\r\n\r\n', ' ', '\t', 'ok\nbad']) {
			const got = requestIdFrom(bad);
			expect(got.length).toBeGreaterThan(0);
			const codes = [...got].map((ch) => ch.codePointAt(0) ?? 0);
			expect(Math.min(...codes), `control char in ${JSON.stringify(got)}`).toBeGreaterThan(
				0x20,
			);
			expect(Math.max(...codes)).toBeLessThan(0x7f);
		}
	});
});
