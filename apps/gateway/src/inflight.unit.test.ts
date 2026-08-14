import { describe, expect, it } from 'vitest';
import { InflightLimiter, retryAfterSeconds } from './inflight.js';

describe('InflightLimiter', () => {
	it('admits up to the ceiling and sheds past it', () => {
		const l = new InflightLimiter(3);
		expect([l.tryAcquire(), l.tryAcquire(), l.tryAcquire()]).toEqual([true, true, true]);
		expect(l.tryAcquire()).toBe(false);
		expect(l.inFlight).toBe(3);
	});

	it('does not queue: a shed request is refused now, not later', async () => {
		// THE PROPERTY operations.md section 1 asks for. A semaphore would return a promise
		// here and resolve when a slot freed; this must answer synchronously and negatively,
		// because a queued scrape burns its own deadline waiting and the queue is memory the
		// ceiling exists to bound.
		const l = new InflightLimiter(1);
		l.tryAcquire();
		const answer = l.tryAcquire();
		expect(answer).toBe(false);
		// And it is a plain boolean, not a thenable that a caller might await.
		expect(typeof answer).toBe('boolean');
	});

	it('frees a slot on release', () => {
		const l = new InflightLimiter(1);
		expect(l.tryAcquire()).toBe(true);
		expect(l.tryAcquire()).toBe(false);
		l.release();
		expect(l.inFlight).toBe(0);
		expect(l.tryAcquire()).toBe(true);
	});

	it('never goes negative on an unpaired release', () => {
		// A double release would otherwise let the count drift below zero and admit more than
		// the ceiling — a limiter that stops limiting, with no symptom but memory.
		const l = new InflightLimiter(2);
		l.tryAcquire();
		l.release();
		l.release();
		l.release();
		expect(l.inFlight).toBe(0);
		expect([l.tryAcquire(), l.tryAcquire()]).toEqual([true, true]);
		expect(l.tryAcquire()).toBe(false);
	});

	it('counts what it shed, so a wrong ceiling is visible', () => {
		const l = new InflightLimiter(1);
		l.tryAcquire();
		l.tryAcquire();
		l.tryAcquire();
		expect(l.shed).toBe(2);
		expect(l.max).toBe(1);
	});

	it('refuses a ceiling that is not a positive integer', () => {
		// Boot-time and loud. `Number(env(...))` turns an empty or misspelled value into 0 or
		// NaN, and a ceiling of 0 accepts nothing while NaN >= NaN is false, so the comparison
		// admits everything. Both are silent in production.
		for (const bad of [0, -1, 1.5, Number.NaN]) {
			expect(() => new InflightLimiter(bad), String(bad)).toThrow(RangeError);
		}
	});

	it('survives a full cycle of acquire and release at the ceiling', () => {
		const l = new InflightLimiter(4);
		for (let i = 0; i < 1000; i++) {
			expect(l.tryAcquire()).toBe(true);
			l.release();
		}
		expect(l.inFlight).toBe(0);
		expect(l.shed).toBe(0);
	});
});

describe('retryAfterSeconds', () => {
	it('is a whole number of seconds, which is all RFC 9110 allows', () => {
		expect(Number.isInteger(retryAfterSeconds())).toBe(true);
		expect(retryAfterSeconds()).toBeGreaterThan(0);
	});
});
