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

describe('bounded memory', () => {
	it('sweeps finished windows once it reaches its key ceiling', async () => {
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE }, 3);
		for (const k of ['a', 'b', 'c']) await l.take(k, T);
		await l.take('d', T + MINUTE);
		// a, b and c were in a finished window; only d remains.
		expect(l.size).toBe(1);
	});

	it('grows past the ceiling rather than refusing callers inside one window', async () => {
		// Refusing would let anyone with enough addresses lock everyone else out.
		const l = new InMemoryRateLimiter({ limit: 1, windowMs: MINUTE }, 2);
		for (const k of ['a', 'b', 'c']) expect((await l.take(k, T)).ok).toBe(true);
		expect(l.size).toBe(3);
	});
});

describe('a nonsense limit fails the boot, not every request', () => {
	it('refuses zero, fractions and sub-second windows', () => {
		expect(() => checkRate({ limit: 0, windowMs: MINUTE }, 'x')).toThrow(/at least 1/);
		expect(() => checkRate({ limit: 1.5, windowMs: MINUTE }, 'x')).toThrow(/whole number/);
		expect(() => checkRate({ limit: 1, windowMs: 10 }, 'x')).toThrow(/second/);
	});
});
