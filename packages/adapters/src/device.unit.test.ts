// Every adapter that can name a device pins one.
//
// WHY THIS IS NOT IN EACH ADAPTER'S OWN TEST. It was. `scrapfly/index.unit.test.ts` has a test
// literally called "sets every parameter explicitly", and it passed for the whole life of the
// adapter while `os` leaked — because the list it iterates is hand-typed, so it asserts that the
// parameters somebody remembered are set, which is not the rule. The rule is about the ones
// nobody remembered.
//
// A per-adapter test cannot catch this by construction: the omission is invisible from inside
// the adapter that made it. It is only visible across adapters, as a disagreement — two pin the
// device, one does not, and the same GatewayRequest therefore fetches a different page
// depending on which provider served it. On a product whose claim is that failover is
// invisible, that is the defect, not the untidy parameter list.
//
// So the table below is the check. Provider knowledge cannot be derived — only Scrapfly's docs
// say the parameter is called `os` — but the *completeness* of the table can be, and is: every
// registered adapter must appear, so a fifth one fails this file until somebody decides which
// case it is rather than inheriting a default by silence.

import { describe, expect, it } from 'vitest';
import type { GatewayRequest } from './contract.js';
import { REGISTRY } from './registry.js';

/**
 * The device parameter each provider exposes, or `null` for "this API has none".
 *
 * `null` is a decision, not a gap. Bright Data's Web Unlocker takes no device field and its API
 * rejects invented ones outright — `error_code: validation` — so acceptance is proof a
 * parameter exists and rejection is proof it does not. That is a stronger check than their
 * docs.
 */
const DEVICE_PARAM: Record<string, string | null> = {
	scraperapi: 'device_type',
	scrapingbee: 'device',
	scrapfly: 'os',
	brightdata: null,
};

const req: GatewayRequest = {
	url: 'https://example.test/a',
	method: 'GET',
	renderJs: false,
	premium: 'none',
	deadlineMs: 30_000,
};

/**
 * Query parameters for a GET adapter; a POST adapter's body is not searched here.
 *
 * `REGISTRY` holds lazy loaders rather than adapters, which is what makes registering one the
 * single act that enrols it in conformance. Awaited here for the same reason.
 */
async function sentParams(id: string): Promise<URLSearchParams | undefined> {
	const load = REGISTRY[id];
	if (load === undefined) return undefined;
	const out = (await load()).translate(req, 'K');
	if (out.method !== 'GET') return undefined;
	return new URL(out.url).searchParams;
}

describe('the device dimension is pinned wherever it exists', () => {
	const ids = Object.keys(REGISTRY);

	// Non-zero denominator. A registry that failed to load would make every case below vacuous.
	it('has adapters to check', () => {
		expect(ids.length).toBeGreaterThan(0);
	});

	// The half that cannot be hand-waved: the table must cover the registry, not the other way
	// round. Without this, adding an adapter and forgetting the row passes silently, which is
	// precisely the failure mode this file exists to end.
	it('names every registered adapter, so a new one cannot inherit a default by silence', () => {
		for (const id of ids) {
			expect(
				Object.hasOwn(DEVICE_PARAM, id),
				`${id} has no row in DEVICE_PARAM — decide whether its API has a device parameter ` +
					'and pin it, or record `null` because it has none',
			).toBe(true);
		}
	});

	for (const id of ids) {
		const param = DEVICE_PARAM[id];
		if (param === undefined || param === null) continue;
		it(`${id} sends ${param} rather than letting the provider choose`, async () => {
			const p = await sentParams(id);
			expect(p, `${id} is not a GET adapter; extend this test before adding one`).toBeDefined();
			const value = p?.get(param);
			expect(value, `${id} leaves ${param} to the provider's default`).not.toBeNull();
			expect(value).not.toBe('');
		});
	}
});
