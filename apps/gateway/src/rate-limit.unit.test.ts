// The in-process limiter. Its Valkey twin is held to the same behaviour in `valkey.e2e.test.ts`.

import { describe, expect, it } from 'vitest';
import { checkRate, InMemoryRateLimiter, windowStart } from './rate-limit.js';

const MINUTE = 60_000;
/** A window edge, so offsets below read as "how far into the window". */
const T = windowStart(1_800_000_000_000, MINUTE);

describe('a fixed window', () => {
	it('allows the limit and refuses the next, saying how long is left', async () => {
		const l = new InMemoryRateLimiter({ limit: 2, windowMs: MINUTE });
		expect(await l.take('k', T)).toEqual({ ok: true });
		expect(await l.take('k', T + 10)).toEqual({ ok: true });
		expect(await l.take('k', T + 15_000)).toEqual({ ok: false, retryAfterMs: 45_000 });
	});

	it('counts fresh in the next window', async () => {
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE });
		await l.take('k', T);
		expect((await l.take('k', T + 1)).ok).toBe(false);
		expect((await l.take('k', T + MINUTE)).ok).toBe(true);
	});

	it('keeps keys apart', async () => {
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE });
		expect((await l.take('a', T)).ok).toBe(true);
		expect((await l.take('b', T)).ok).toBe(true);
	});
});

describe('peek, for a budget spent by outcomes', () => {
	it('reads the count without adding to it, and reads zero in a new window', async () => {
		const l = new InMemoryRateLimiter({ limit: 5, windowMs: MINUTE });
		await l.take('k', T);
		await l.take('k', T);
		expect(await l.peek('k', T + 5)).toBe(2);
		expect(await l.peek('k', T + 5)).toBe(2);
		expect(await l.peek('other', T)).toBe(0);
		expect(await l.peek('k', T + MINUTE)).toBe(0);
	});
});

describe('bounded memory, in constant time', () => {
	it('drops the whole map when the window rolls over', async () => {
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE });
		for (const k of ['a', 'b', 'c']) await l.take(k, T);
		await l.take('d', T + MINUTE);
		expect(l.size).toBe(1);
	});

	it('never refuses a stranger inside a window, however many there are', async () => {
		// Refusing would let anyone with enough addresses lock everyone else out.
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE });
		for (let i = 0; i < 1000; i++) expect((await l.take(`k${i}`, T)).ok).toBe(true);
		expect(l.size).toBe(1000);
	});

	it('does not reset when the clock steps back a window', async () => {
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE });
		await l.take('k', T + MINUTE);
		expect((await l.take('k', T)).ok).toBe(false);
	});
});

describe('a nonsense limit fails the boot, not every request', () => {
	it('refuses zero, fractions and sub-second windows', () => {
		expect(() => checkRate({ limit: 0, windowMs: MINUTE }, 'x')).toThrow(/at least 1/);
		expect(() => checkRate({ limit: 1.5, windowMs: MINUTE }, 'x')).toThrow(/whole number/);
		expect(() => checkRate({ limit: 1, windowMs: 10 }, 'x')).toThrow(/second/);
	});
});
