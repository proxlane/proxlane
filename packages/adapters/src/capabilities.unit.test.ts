// The static capability list, against the registry it must mirror.
//
// TWO LISTS OF PROVIDERS IS THE FAILURE. `REGISTRY` decides what the router can route to;
// `CAPABILITIES` is what the CLI prints and what the site's cost page reads. Let them diverge
// and the site advertises a provider nobody can reach, or hides one that is already serving
// traffic. Both directions are asserted, because only one of them is the obvious one.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Exhaustive over `PremiumTier`; a new tier should break this file until it is priced. */
const TIERS = ['none', 'residential', 'stealth'] as const;

import { CAPABILITIES, capabilitiesFor } from './capabilities.js';
import { cheapestCost, costOf } from './contract.js';
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

	it('claims POST only where translate() actually forwards one', () => {
		// `post` and `sessions` are claims about THIS ADAPTER, not about the provider — a
		// distinction that was undocumented until it got mistaken for four live bugs. The
		// dangerous direction is a `true` nothing implements: `chain.ts` filters on these, so a
		// declared-but-unwired capability routes a request to an adapter that silently drops
		// half of it. This reads the source and holds the claim to it.
		const src = (id: string): string => readFileSync(join(HERE, id, 'index.ts'), 'utf8');
		let checked = 0;
		for (const c of CAPABILITIES) {
			const code = src(c.id);
			// The three that cannot do it all reject non-GET explicitly and hardcode the method,
			// which is a far better tell than looking for the absence of something.
			const refuses = /req\.method !== 'GET'/.test(code);
			expect(
				c.post,
				`${c.id} declares post=${c.post} while translate ${refuses ? 'rejects' : 'forwards'} non-GET`,
			).toBe(!refuses);
			checked += 1;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('claims sessions only where translate() sends one', () => {
		let checked = 0;
		for (const c of CAPABILITIES) {
			const code = readFileSync(join(HERE, c.id, 'index.ts'), 'utf8');
			// It has to read `req.sessionId` to be able to forward it. Declaring the capability
			// without touching the field promises a sticky IP and delivers a fresh one.
			expect(code.includes('req.sessionId'), `${c.id} declares sessions=${c.sessions}`).toBe(
				c.sessions,
			);
			checked += 1;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('prices requests at a plausible scale for their unit', () => {
		// A UNIT-SCALE GUARD, and it exists because one shipped. Bright Data's base was 1,500
		// microcredits against `unit: 'usd-cents'`. The arithmetic: a credit is 1,000,000 micro,
		// a "credit" there is one US cent, and $1.50 per 1,000 requests is 0.15 cents — so
		// 150,000. The 1,500 came from $0.0015 x 1e6, which is micro-DOLLARS. A hundred times
		// too low, in the estimate of the only provider that reports no cost of its own.
		//
		// Nothing could see it: every structural test passed, the ratios between cells were all
		// correct, and a wrong absolute scale is invisible to a comparison of multipliers.
		//
		// THE BAND IS DELIBERATELY WIDE. It is not a claim about what scraping costs; it is the
		// observation that no provider charges less than a hundredth of its own unit per request
		// or more than a thousand of them, so anything outside is an exponent, not a price.
		const FLOOR = 10_000; // 0.01 of one credit / cent
		const CEILING = 1_000_000_000; // 1,000 credits / cents
		let priced = 0;
		for (const c of CAPABILITIES) {
			for (const tier of TIERS) {
				for (const cost of [
					c.costTable.matrix[tier].plain,
					c.costTable.matrix[tier].rendered,
				]) {
					// Zero is a real price — the keyless dev adapter is genuinely free — and null
					// means not sold. Neither has a scale to get wrong.
					if (cost === null || cost === 0) continue;
					expect(
						cost,
						`${c.id} ${tier}: ${cost} looks like a unit-scale slip`,
					).toBeGreaterThanOrEqual(FLOOR);
					expect(cost, `${c.id} ${tier}: ${cost} is implausibly large`).toBeLessThanOrEqual(
						CEILING,
					);
					priced += 1;
				}
			}
		}
		expect(priced, 'no priced cells to check').toBeGreaterThan(0);
	});

	it('never prices rendering below a plain request', () => {
		// Rendering runs a browser. No provider gives that away cheaper than not doing it, so a
		// row where `rendered` undercuts `plain` is a transcription slip, not a bargain. The kind
		// of thing that is obvious once stated and invisible in a wall of six-digit numbers.
		for (const c of CAPABILITIES) {
			for (const tier of TIERS) {
				const { plain, rendered } = c.costTable.matrix[tier];
				if (plain === null || rendered === null) continue;
				expect(rendered, `${c.id} ${tier}: rendered undercuts plain`).toBeGreaterThanOrEqual(
					plain,
				);
			}
		}
	});

	it('sells exactly the tiers it says it sells', () => {
		// TWO FIELDS THAT CAN DISAGREE, so something has to hold them together. `premiumTiers`
		// gates the chain in `chain.ts`; the matrix says what each tier costs. A tier priced but
		// not offered is dead data; a tier offered but priced `null` routes traffic to a
		// combination the provider will not serve.
		for (const c of CAPABILITIES) {
			for (const tier of TIERS) {
				const row = c.costTable.matrix[tier];
				const priced = row.plain !== null || row.rendered !== null;
				expect(
					priced,
					`${c.id}: ${tier} offered=${c.premiumTiers.has(tier)} priced=${priced}`,
				).toBe(c.premiumTiers.has(tier));
			}
		}
	});

	it('prices no rendered request at a provider that cannot render', () => {
		for (const c of CAPABILITIES) {
			if (c.renderJs) continue;
			for (const tier of TIERS) {
				expect(c.costTable.matrix[tier].rendered, `${c.id} ${tier}`).toBeNull();
			}
		}
	});

	it('reads both columns through costOf', () => {
		// The lookup exists once so nothing reimplements `renderJs ? rendered : plain`. Asserted
		// against the cells rather than against a number, and both columns are reached — the
		// first version only ever asked for `plain` and would have passed with `rendered` wired
		// to the wrong field.
		let reached = 0;
		for (const c of CAPABILITIES) {
			for (const tier of TIERS) {
				const row = c.costTable.matrix[tier];
				expect(costOf(c.costTable, { premium: tier, renderJs: false })).toBe(row.plain);
				expect(costOf(c.costTable, { premium: tier, renderJs: true })).toBe(row.rendered);
				reached += 2;
			}
		}
		expect(reached).toBeGreaterThan(0);
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
			// Every cell decided: a number, or `null` for a combination the provider does not
			// sell. `undefined` would mean nobody looked, and the matrix exists to make that
			// impossible to ship.
			for (const tier of ['none', 'residential', 'stealth'] as const) {
				const row = c.costTable.matrix[tier];
				for (const [col, v] of [
					['plain', row.plain],
					['rendered', row.rendered],
				] as const) {
					expect(
						v === null || (typeof v === 'number' && v >= 0),
						`${c.id} ${tier}.${col}`,
					).toBe(true);
				}
			}
			// And it sells SOMETHING, or the provider is in the registry serving nothing.
			expect(cheapestCost(c.costTable), c.id).toBeGreaterThanOrEqual(0);
			expect(c.costTable.sourceUrl, c.id).toMatch(/^https:\/\//);
			expect(c.costTable.effectiveDate, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});
