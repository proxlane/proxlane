// The cooldown semantics, independent of any store.
//
// Every case here is a rule `integrations.md` section 3 states in a sentence. A sentence is
// not enforcement — "exponential with full jitter and a 15-minute cap, half-open expiry" has
// at least four ways to be implemented almost right.

import { describe, expect, it } from 'vitest';
import {
	arm,
	armFor,
	COOLDOWN,
	type CooldownEntry,
	claimProbe,
	cooldownDomain,
	cooldownKey,
	cooldownMs,
	decide,
	parseRetryAfter,
} from './cooldown.js';

/** Deterministic rng that returns exactly what you give it. */
const fixed = (v: number) => () => v;

describe('backoff', () => {
	it('is exponential in the number of consecutive arms', () => {
		// At the top of the jitter range, so the growth is visible rather than sampled.
		const top = (n: number) => cooldownMs(n, fixed(0.999999));
		expect(top(1)).toBeGreaterThan(top(0));
		expect(top(2)).toBeGreaterThan(top(1));
		expect(top(1) / top(0)).toBeCloseTo(2, 1);
	});

	it('never exceeds the 15-minute cap, at any exponent', () => {
		for (const n of [0, 1, 5, 20, 1000]) {
			expect(cooldownMs(n, fixed(0.999999)), `n=${n}`).toBeLessThanOrEqual(COOLDOWN.CAP_MS);
		}
	});

	it('is FULL jitter: the whole range down to zero is reachable', () => {
		// Not equal jitter, not none. Every gateway that hit the same block would otherwise
		// retry at the same instant, and a herd against a site that just blocked us is how a
		// soft block becomes a hard one.
		expect(cooldownMs(3, fixed(0))).toBe(0);
		expect(cooldownMs(3, fixed(0.5))).toBeCloseTo(cooldownMs(3, fixed(0.999999)) / 2, -2);
	});

	it('spreads two gateways hitting the same block', () => {
		const draws = new Set(
			Array.from({ length: 50 }, (_, i) => cooldownMs(4, fixed((i + 0.5) / 50))),
		);
		expect(draws.size, 'jitter collapsed to a constant').toBeGreaterThan(40);
	});
});

describe('the half-open expiry', () => {
	const at = (untilMs: number, over: Partial<CooldownEntry> = {}): CooldownEntry => ({
		untilMs,
		consecutive: 1,
		probeTaken: false,
		...over,
	});

	it('is cooling before expiry', () => {
		expect(decide(at(1000), 500)).toEqual({ kind: 'cooling', untilMs: 1000 });
	});

	it('offers a probe at expiry, not free passage', () => {
		expect(decide(at(1000), 1000).kind).toBe('probe');
	});

	it('lets exactly ONE caller through', () => {
		// The property that only fails under load, and the reason claiming is its own step.
		let entry: CooldownEntry | undefined = at(1000);
		const first = claimProbe(entry, 2000);
		expect(first.claimed).toBe(true);
		entry = first.next;
		const second = claimProbe(entry, 2000);
		expect(second.claimed, 'a second caller took the probe too').toBe(false);
	});

	it('reports cooling once the probe is out, not open', () => {
		expect(decide(at(1000, { probeTaken: true }), 5000).kind).toBe('cooling');
	});

	it('treats no entry at all as open', () => {
		expect(decide(undefined, 0)).toEqual({ kind: 'open' });
		expect(claimProbe(undefined, 0).claimed).toBe(true);
	});
});

describe('arming', () => {
	it('re-arms a FAILED PROBE straight at the cap, not at the next exponent', () => {
		// Section 3 is explicit, and the reason is economic: a probe is the cheapest evidence
		// there is. It just said the provider is still refusing, so backing off gently would
		// spend more money to learn the same thing again.
		const expired: CooldownEntry = { untilMs: 1000, consecutive: 1, probeTaken: true };
		const next = arm(expired, 5000, fixed(0.0001));
		expect(next.untilMs - 5000).toBe(COOLDOWN.CAP_MS);
	});

	it('uses jittered backoff for a first arm, not the cap', () => {
		const next = arm(undefined, 0, fixed(0.5));
		expect(next.untilMs).toBeLessThan(COOLDOWN.CAP_MS);
		expect(next.consecutive).toBe(1);
	});

	it('counts consecutive arms so the exponent climbs', () => {
		let e = arm(undefined, 0, fixed(0.9));
		for (let i = 0; i < 3; i++) e = arm(e, 1, fixed(0.9));
		expect(e.consecutive).toBe(4);
	});

	it('clears probeTaken, so an expiry always offers a fresh probe', () => {
		const e = arm({ untilMs: 0, consecutive: 2, probeTaken: true }, 10, fixed(0.5));
		expect(e.probeTaken).toBe(false);
	});
});

describe('the two namespaces', () => {
	const parts = { provider: 'scraperapi', domain: 'example.com', org: 'acme' };

	it('keys a block by domain and shares it across orgs', () => {
		// A block is a property of the domain — that is the moat. The org must not appear.
		const key = cooldownKey('blk', parts) as string;
		expect(key).toBe('cd:blk:scraperapi:example.com');
		expect(key).not.toContain('acme');
	});

	it('keys an account fact by org, so one org cannot cool a provider for everyone', () => {
		// ScraperAPI's 429 is a plan concurrency cap, not a ban. Under a shared key, org A
		// saturating its own plan would degrade the hosted instance under exactly the load it
		// exists to absorb.
		const key = cooldownKey('acct', parts) as string;
		expect(key).toBe('cd:acct:acme:scraperapi');
		expect(key).not.toContain('example.com');
	});

	it('returns null for outcomes that cool nothing', () => {
		expect(cooldownKey('none', parts)).toBeNull();
	});
});

describe('the domain of a cooldown', () => {
	it('is the lowercased hostname', () => {
		expect(cooldownDomain('https://Example.COM/a/b?c=d')).toBe('example.com');
	});

	it('separates subdomains, which is the documented limitation', () => {
		// Not a bug being hidden. The alternative — "last two labels" — is silently wrong for
		// every .co.uk target, cooling the whole TLD as if it were one site. Doing it right
		// needs the Public Suffix List.
		expect(cooldownDomain('https://www.example.com/')).not.toBe(
			cooldownDomain('https://example.com/'),
		);
	});

	it('never throws inside a routing decision', () => {
		expect(cooldownDomain('not a url')).toBe('invalid');
	});
});

describe("the target's own Retry-After", () => {
	// Measured across the three launch providers against a target sending `Retry-After: 120`:
	// ScrapingBee forwards it as `spb-retry-after`, Scrapfly exposes it in the envelope's
	// `response_headers`, and ScraperAPI strips it entirely. So it is absent more often than
	// present, and every path has to work without it.

	it('reads delta-seconds', () => {
		expect(parseRetryAfter('120', 0)).toBe(120_000);
	});

	it('reads the HTTP-date form, which is equally legal and appears in the wild', () => {
		// Parsed as a number this yields NaN, which would become a zero-length cooldown — i.e.
		// no cooldown at all, on the outcome whose entire purpose is to back off.
		const now = Date.parse('2026-08-11T12:00:00Z');
		expect(parseRetryAfter('Tue, 11 Aug 2026 12:02:00 GMT', now)).toBe(120_000);
	});

	it('refuses anything it cannot read, so the caller falls back to the backoff', () => {
		// '-5' is the sharp one: Date.parse reads it as a valid 1901 timestamp, so without a
		// guard a negative delta-seconds became a ~31-year cooldown arrived at by nonsense.
		for (const bad of [undefined, '', '   ', 'soon', '-5', '+5', '0', 'NaN', '12x', '1e3']) {
			expect(parseRetryAfter(bad, 0), JSON.stringify(bad)).toBeUndefined();
		}
	});

	it('refuses a date already in the past', () => {
		const now = Date.parse('2026-08-11T12:00:00Z');
		expect(parseRetryAfter('Tue, 11 Aug 2026 11:00:00 GMT', now)).toBeUndefined();
	});

	it('arms for what the target asked, not for a jittered guess', () => {
		// A first arm draws uniformly from [0, 30s), averaging 15s. A site asking for 120s
		// would be hit eight times too early.
		const e = armFor(undefined, 1000, 120_000);
		expect(e.untilMs - 1000).toBe(120_000);
		expect(e.probeTaken).toBe(false);
	});

	it('still clamps to the cap, however long the target asks', () => {
		// A site asking for a week is not a reason to hold a provider out for a week; the
		// half-open probe is what discovers it has relaxed.
		const e = armFor(undefined, 0, 7 * 24 * 60 * 60 * 1000);
		expect(e.untilMs).toBe(COOLDOWN.CAP_MS);
	});

	it('still escalates on repeat', () => {
		let e = armFor(undefined, 0, 1000);
		e = armFor(e, 0, 1000);
		expect(e.consecutive).toBe(2);
	});
});
