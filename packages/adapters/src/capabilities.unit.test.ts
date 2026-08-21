// The static capability list, against the registry it must mirror.
//
// TWO LISTS OF PROVIDERS IS THE FAILURE. `REGISTRY` decides what the router can route to;
// `CAPABILITIES` is what the CLI prints and what the site's cost page reads. Let them diverge
// and the site advertises a provider nobody can reach, or hides one that is already serving
// traffic. Both directions are asserted, because only one of them is the obvious one.

import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilitiesFor } from './capabilities.js';
import { REGISTRY } from './registry.js';

describe('the static list mirrors the registry', () => {
	it('holds exactly the registry ids', () => {
		// Non-zero denominator: a check over two empty sets passes and proves nothing.
		expect(CAPABILITIES.length).toBeGreaterThan(0);
		expect(CAPABILITIES.map((c) => c.id).sort()).toEqual(Object.keys(REGISTRY).sort());
	});

	it('agrees with what each adapter actually reports', async () => {
		// The list could hold the right ids and the wrong objects. Loading the real adapters is
		// the only way to know the static import is the same data the router filters on.
		for (const [id, load] of Object.entries(REGISTRY)) {
			const adapter = await load();
			expect(capabilitiesFor(id), `capabilitiesFor(${id})`).toBe(adapter.capabilities);
		}
	});

	it('is ordered by line, the order the chain and the diagram both use', () => {
		const lines = CAPABILITIES.map((c) => c.line);
		expect([...lines].sort((a, b) => a - b)).toEqual(lines);
		// A line identifies a provider everywhere it appears, so two sharing one is a colour
		// collision in the diagram and an ambiguous reference in every doc.
		expect(new Set(lines).size).toBe(lines.length);
	});

	it('records country lists that are lists, not excerpts', () => {
		// THE BUG THIS EXISTS FOR. ScrapingBee shipped with seven country codes: the six rows of
		// the EXAMPLE table in their docs, plus one from a sample curl. Their real classic list is
		// 42. `chain.ts` filters the chain on this set, so the provider was silently ineligible
		// for thirty-five countries it sells, and nothing anywhere could notice.
		//
		// THE FLOOR IS A HEURISTIC AND THAT IS SAID OUT LOUD. Twenty is not a fact about proxy
		// networks; it is the observation that every provider selling country targeting sells
		// dozens (42, 79, 195 across the four here) and that a single-digit list is what an
		// excerpt looks like. A provider genuinely offering twelve should fail this, and the fix
		// is to lower the constant in a commit that says why — which is the friction this wants.
		const FLOOR = 20;
		for (const c of CAPABILITIES) {
			if (c.countryCodes === 'all') continue;
			expect(
				c.countryCodes.size,
				`${c.id} country list looks like an excerpt`,
			).toBeGreaterThanOrEqual(FLOOR);
			for (const code of c.countryCodes) {
				// Lowercase ISO 3166-1 alpha-2. `chain.ts` lowercases the request before comparing,
				// so an uppercase entry here is a country that can never match.
				expect(code, `${c.id} has a malformed code`).toMatch(/^[a-z]{2}$/);
			}
		}
	});

	it('has at least one finite country list to check', () => {
		// Without this the loop above passes by skipping everything the day someone sets every
		// provider to 'all', which is the exact over-claim the loop is meant to discourage.
		expect(CAPABILITIES.some((c) => c.countryCodes !== 'all')).toBe(true);
	});

	it('declares a cost unit on every provider', () => {
		// REQUIRED by the contract precisely so a third unit cannot arrive unnoticed. The cost
		// page compares multipliers, which are dimensionless, and never compares a base across
		// units — this is what makes that distinction checkable rather than a convention.
		for (const c of CAPABILITIES) {
			expect(c.costTable.unit, c.id).toBeTruthy();
			expect(c.costTable.base, c.id).toBeGreaterThan(0);
			expect(c.costTable.sourceUrl, c.id).toMatch(/^https:\/\//);
			expect(c.costTable.effectiveDate, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});
