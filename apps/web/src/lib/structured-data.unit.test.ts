// The identity block agents read instead of the prose.
//
// It lives in its own module for exactly this reason: inline in the route's head config it was
// a `JSON.stringify` of a literal, and a malformed identity block fails silently — a crawler
// ignores it and nothing on the page looks wrong.

import { describe, expect, it } from 'vitest';
import { SITE, softwareApplicationLd } from './structured-data.js';

const DESCRIPTION = 'Routes scraping requests across four providers with automatic failover.';

describe('the homepage JSON-LD', () => {
	it('survives a round trip through JSON, which is how a crawler receives it', () => {
		const parsed = JSON.parse(JSON.stringify(softwareApplicationLd(DESCRIPTION)));
		expect(parsed['@context']).toBe('https://schema.org');
		expect(parsed['@type']).toBe('SoftwareApplication');
	});

	it('carries the four fields schema.org needs to resolve an identity', () => {
		const ld = softwareApplicationLd(DESCRIPTION);
		for (const k of ['name', 'url', 'description', '@type']) {
			expect(ld[k], `${k} is missing`).toBeTruthy();
		}
		expect(ld.description).toBe(DESCRIPTION);
	});

	it('states the price rather than leaving it to be inferred', () => {
		// BYOK and self-host are both free forever and there is no hosted endpoint. An agent
		// asked "what does this cost" should not have to find and parse the pricing table.
		const offers = softwareApplicationLd(DESCRIPTION).offers as Record<string, unknown>;
		expect(offers['@type']).toBe('Offer');
		expect(offers.price).toBe('0');
		expect(offers.priceCurrency).toBeTruthy();
	});

	it('points every URL at the canonical origin', () => {
		const ld = softwareApplicationLd(DESCRIPTION);
		expect(ld.url).toBe(`${SITE}/`);
		expect(ld.softwareHelp).toBe(`${SITE}/docs`);
		// The repository is deliberately NOT on this origin; it is the one external URL here.
		expect(String(ld.codeRepository)).toContain('github.com/proxlane/proxlane');
	});

	it('claims no Organization fields it cannot honestly fill', () => {
		// An Organization block wants contactPoint and address. There is no company here, and
		// inventing a postal address to satisfy a structured-data checker would be a false
		// claim about a real place. Asserted so nobody adds one without deciding to.
		const ld = softwareApplicationLd(DESCRIPTION);
		expect(ld['@type']).not.toBe('Organization');
		expect(ld.address).toBeUndefined();
		expect(ld.contactPoint).toBeUndefined();
	});
});
