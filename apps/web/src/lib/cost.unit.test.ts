// The cost comparison, against the capability registry it reads.
//
// WHAT THESE DELIBERATELY DO NOT ASSERT is that ScraperAPI's render multiplier is 10. That is a
// price, prices change, and the page derives it — a test pinning it would fail on the day a
// vendor moved a number and the site was already correct. Structure is what can be wrong here:
// the composition law, the capability filter, the ordering, and the one design rule that makes
// the page honest, which is that bases in different units are never ranked against each other.

import { CAPABILITIES, costOf } from '@proxlane/adapters';
import { describe, expect, it } from 'vitest';
import {
	COUNTRIES,
	compareCost,
	type ProviderCost,
	shapeIsInteresting,
	TIERS,
	times,
} from './cost.js';

const shape = (o: Partial<Parameters<typeof compareCost>[0]> = {}) =>
	compareCost({ renderJs: false, premium: 'none', country: 'anywhere', ...o });

const by = (rows: readonly ProviderCost[], id: string): ProviderCost =>
	rows.find((r) => r.id === id) as ProviderCost;

describe('it reads every shipped provider', () => {
	it('returns one row per adapter, and there are adapters', () => {
		// Non-zero denominator. Every ordering and filtering claim below is vacuous over an
		// empty registry.
		expect(CAPABILITIES.length).toBeGreaterThan(0);
		expect(
			shape()
				.map((r) => r.id)
				.sort(),
		).toEqual(CAPABILITIES.map((c) => c.id).sort());
	});

	it('carries the provenance of every number it shows', () => {
		// A cost with no date and no source is a number somebody typed. The page prints both
		// next to each provider precisely so a reader can go and check.
		for (const r of shape()) {
			expect(r.sourceUrl, r.id).toMatch(/^https:\/\//);
			expect(r.effectiveDate, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});

describe('the multiplier composes, and it composes from the registry', () => {
	it('is one real price over another, per provider', () => {
		// NOT A FORMULA ANY MORE, and that is the point. It used to multiply declared
		// multipliers together, which is how Scrapfly's rendering read 5x against their own
		// arithmetic of 1 + 5 = 6. A factor is now a ratio of two cells the vendor published,
		// checked against each provider's own matrix rather than against a literal — so it
		// survives a price change and still catches a wrong denominator.
		for (const tier of TIERS) {
			for (const renderJs of [true, false]) {
				const rows = shape({ premium: tier, renderJs });
				for (const c of CAPABILITIES) {
					const cost = costOf(c.costTable, { premium: tier, renderJs });
					const floor = costOf(c.costTable, { premium: 'none', renderJs: false });
					if (cost === null || floor === null || floor === 0) continue;
					expect(by(rows, c.id).multiplier, `${c.id} ${tier} render=${renderJs}`).toBe(
						cost / floor,
					);
				}
			}
		}
	});

	it('treats an absent surcharge as one, not as an error', () => {
		// A provider that does not charge extra for rendering multiplies by one. That is Bright
		// Data's entire pitch, and a formula that defaulted to zero or threw would erase it.
		for (const r of shape({ renderJs: true, premium: 'none' })) {
			expect(r.multiplier, r.id).toBeGreaterThan(0);
		}
	});

	it('the plain shape costs everyone their base and nothing more', () => {
		for (const r of shape()) expect(r.multiplier, r.id).toBe(1);
		expect(shapeIsInteresting(shape())).toBe(false);
	});

	it('and the loaded shape does not', () => {
		// Or the page has nothing to say. If every provider ever charged the same for everything
		// there would be no comparison to draw and this file should be deleted, not weakened.
		expect(shapeIsInteresting(shape({ renderJs: true, premium: 'stealth' }))).toBe(true);
	});
});

describe('a provider that cannot serve the shape is absent, not cheap', () => {
	it('is marked incapable when it does not sell the country', () => {
		// Derived, never named: find a provider with a finite country list and ask for one it
		// does not sell. Hardcoding "scrapingbee has no jp" would rot the day they add it.
		const limited = CAPABILITIES.find((c) => c.countryCodes !== 'all');
		expect(limited, 'no provider has a finite country list to test with').toBeDefined();
		if (limited === undefined || limited.countryCodes === 'all') return;

		const missing = COUNTRIES.map((c) => c.code)
			.filter((c) => c !== 'anywhere')
			.find((code) => !(limited.countryCodes as ReadonlySet<string>).has(code));
		// If this fails, the picker has stopped offering anywhere the providers disagree, and
		// the page's "cannot serve" state is unreachable in the UI as well as untested here.
		expect(missing, 'the country picker no longer shows any provider differing').toBeDefined();

		const row = by(shape({ country: missing as string }), limited.id);
		expect(row.capable).toBe(false);
		expect(row.reason).toContain('country');

		// And the positive case, or the test passes for a provider that is never capable.
		const present = [...(limited.countryCodes as ReadonlySet<string>)][0] as string;
		expect(by(shape({ country: present }), limited.id).capable).toBe(true);
	});

	it('is capable everywhere when it sells everywhere', () => {
		const global = CAPABILITIES.filter((c) => c.countryCodes === 'all');
		expect(global.length).toBeGreaterThan(0);
		for (const c of global) {
			expect(by(shape({ country: 'jp' }), c.id).capable, c.id).toBe(true);
		}
	});

	it('sorts every incapable provider below every capable one', () => {
		// A provider that cannot serve you must never appear at the top because its multiplier
		// happens to be low. It is not a cheap option, it is not an option.
		const limited = CAPABILITIES.find((c) => c.countryCodes !== 'all');
		if (limited === undefined || limited.countryCodes === 'all') return;
		const missing = COUNTRIES.map((c) => c.code)
			.filter((c) => c !== 'anywhere')
			.find((code) => !(limited.countryCodes as ReadonlySet<string>).has(code));
		if (missing === undefined) return;

		const rows = shape({ country: missing, renderJs: true, premium: 'stealth' });
		const lastCapable = rows.findLastIndex((r) => r.capable);
		const firstIncapable = rows.findIndex((r) => !r.capable);
		expect(firstIncapable).toBeGreaterThan(-1);
		expect(firstIncapable).toBeGreaterThan(lastCapable);
	});

	it('orders capable providers by multiplier, ascending', () => {
		const capable = shape({ renderJs: true, premium: 'stealth' }).filter((r) => r.capable);
		const m = capable.map((r) => r.multiplier);
		expect(m.length).toBeGreaterThan(1);
		expect([...m].sort((a, b) => a - b)).toEqual(m);
	});
});

describe('it never ranks a price against a different currency', () => {
	// THE DESIGN RULE. Three providers bill in credits whose cash value depends on your plan;
	// one bills in cents. `contract.ts` makes `unit` required because "that is exactly how the
	// first two got mixed". Ranking bases across that boundary would be a chart of nonsense
	// presented with total confidence, which is the worst kind of wrong for a cost page.
	it('ships more than one unit, so the boundary is real and not hypothetical', () => {
		const units = new Set(shape().map((r) => r.unit));
		expect(units.size).toBeGreaterThan(1);
	});

	it('states a unit beside every base', () => {
		for (const r of shape()) {
			expect(r.unit, r.id).toBeTruthy();
			expect(r.floor, r.id).toBeGreaterThan(0);
		}
	});

	it('exposes no combined figure for anything to rank', () => {
		// The guard that actually holds. Add `total: base * multiplier` and a page will sort on
		// it within the week; there is nothing to sort on if it does not exist.
		const keys = Object.keys(shape()[0] as ProviderCost);
		for (const banned of ['total', 'absolute', 'price', 'usd', 'cents', 'perThousand']) {
			expect(
				keys.some((k) => k.toLowerCase().includes(banned.toLowerCase())),
				banned,
			).toBe(false);
		}
		// And it does expose the two it is allowed to, or the loop above is checking nothing.
		expect(keys).toContain('multiplier');
		expect(keys).toContain('unit');
	});
});

describe('formatting', () => {
	it('never writes 1.0x', () => {
		expect(times(1)).toBe('1x');
		expect(times(10)).toBe('10x');
		expect(times(2.5)).toBe('2.5x');
	});
});
