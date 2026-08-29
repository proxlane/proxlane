// `wait_for`, across every adapter: the name each provider uses, and who must not be sent it.
//
// Contract-level rather than four separate unit tests, because the property that matters is a
// cross-adapter one — every adapter that DECLARES `waitForSelector` must actually put the
// selector on the wire, and every adapter that does not declare it must not. A per-adapter
// test cannot state that, and the pair drifting apart is the failure: a capability is a
// promise the router believes, and it filters the chain on this one.

import { describe, expect, it } from 'vitest';
import { type Adapter, type GatewayRequest, REGISTRY } from './index.js';

const SELECTOR = '[data-testid="results"] .row';

const base: GatewayRequest = {
	url: 'https://example.com/listings',
	method: 'GET',
	renderJs: true,
	premium: 'none',
	deadlineMs: 30_000,
};

/**
 * Did the selector reach the wire, in the query string or in the body?
 *
 * PARSED VALUES, not a substring of the raw url. `URLSearchParams` encodes a space as `+`,
 * which `decodeURIComponent` does not undo — so a naive text match fails on any selector
 * containing a descendant combinator, and would have reported all three working adapters
 * broken.
 */
function sentSelector(a: Adapter, req: GatewayRequest): boolean {
	const w = a.translate(req, 'zone:K');
	for (const [, v] of new URL(w.url).searchParams) if (v === SELECTOR) return true;
	return (w.body ?? '').includes(JSON.stringify(SELECTOR).slice(1, -1));
}

const ids = Object.keys(REGISTRY);

describe('the selector reaches the wire exactly when the adapter claims it can', () => {
	it('has adapters to check', () => {
		expect(ids.length).toBeGreaterThan(0);
	});

	it.each(ids)('%s', async (id) => {
		const a: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
		const withWait = sentSelector(a, { ...base, waitFor: SELECTOR });
		const without = sentSelector(a, base);

		// Never sent unasked, whatever the capability says. An adapter that always sends a wait
		// condition would change the cost and the latency of every rendered request.
		expect(without, `${id}: sent a wait condition nobody asked for`).toBe(false);

		if (a.capabilities.waitForSelector) {
			expect(withWait, `${id}: declares waitForSelector and did not send the selector`).toBe(
				true,
			);
		} else {
			// Bright Data is here on purpose: `x-unblock-expect` is accepted and not demonstrably
			// enforced, so it declares false and `isCapable` keeps it out of the chain. Sending it
			// anyway would be the worst outcome — a caller charged for a page that did not wait.
			expect(withWait, `${id}: does not declare waitForSelector but sent one`).toBe(false);
		}
	});

	it('at least one adapter declares it, or this proves nothing', async () => {
		const declared = await Promise.all(
			ids.map(async (id) => {
				const a: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
				return a.capabilities.waitForSelector;
			}),
		);
		expect(declared.some(Boolean)).toBe(true);
		// And at least one does not, or the `isCapable` filter has nothing to filter and the
		// capability is decoration.
		expect(declared.some((d) => !d)).toBe(true);
	});
});
