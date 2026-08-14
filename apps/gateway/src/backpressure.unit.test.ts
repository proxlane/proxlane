// The limiter WIRED INTO THE APP, which is a different claim from `inflight.unit.test.ts`.
//
// That file proves the counter counts. This one proves the four things that live at the seam
// and that a correct counter cannot give you: the slot is taken after auth and not before,
// `/health` is never shed, the slot comes back when the handler throws, and a shed response
// carries headers a client can act on.
//
// Driven through `app.request()` rather than a socket, so it stays in the unit project: every
// property here is about the handler's control flow, and Hono's own routing is exercised by
// `app.e2e.test.ts` over real TCP.

import { randomBytes } from 'node:crypto';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { HttpTransport } from './transport.js';

const API_KEY = randomBytes(24).toString('hex');
const adapter = await (REGISTRY.scraperapi as () => Promise<Adapter>)();

/**
 * A transport that parks every call until the test lets it go.
 *
 * Holding requests inside the chain is the only way to have several genuinely in flight at
 * once, which is the state the ceiling is about. Nothing here invents a provider response —
 * the parked calls are released and their results discarded; what is asserted is which
 * requests got a slot.
 */
function parkingTransport() {
	let admit!: () => void;
	const gate = new Promise<void>((r) => {
		admit = r;
	});
	let entered = 0;
	const transport: HttpTransport = {
		async execute() {
			entered += 1;
			await gate;
			throw new Error('released');
		},
	};
	return {
		transport,
		admit: () => admit(),
		get entered() {
			return entered;
		},
	};
}

function appWith(transport: HttpTransport, maxInflight?: number) {
	return createApp({
		transport,
		candidates: [{ adapter, key: 'PARKED' }],
		apiKey: API_KEY,
		maxBodyBytes: 10 * 1024 * 1024,
		defaultDeadlineMs: 90_000,
		...(maxInflight === undefined ? {} : { maxInflight }),
	});
}

const scrape = (app: ReturnType<typeof appWith>) =>
	app.request(`/v1?api_key=${API_KEY}&url=https://example.com`);

describe('the in-flight ceiling', () => {
	it('sheds past the ceiling with 429 GATEWAY_BUSY', async () => {
		const park = parkingTransport();
		const app = appWith(park.transport, 2);

		const held = [scrape(app), scrape(app)];
		// Both are inside the transport, so both hold a slot. Awaiting `entered` rather than a
		// timer keeps this deterministic.
		while (park.entered < 2) await new Promise((r) => setImmediate(r));

		const shed = await scrape(app);
		expect(shed.status).toBe(429);
		expect(shed.headers.get('X-Outcome')).toBe('GATEWAY_BUSY');
		// The closed class is the whole reason a new member is safe to add.
		expect(shed.headers.get('X-Outcome-Class')).toBe('gateway');
		expect(shed.headers.get('X-Attempts')).toBe('0');
		expect(Number(shed.headers.get('Retry-After'))).toBeGreaterThan(0);
		// Shed requests are in the p95 population too, or the gate measures only the requests
		// that got a slot.
		expect(shed.headers.get('Server-Timing')).toMatch(/gw;dur=/);

		const body = (await shed.json()) as {
			requestId: string;
			error: { code: string; class: string };
		};
		expect(body.error.code).toBe('GATEWAY_BUSY');
		// The body's class and the header's must agree. They come from different call paths —
		// `errorClassFor` and `outcomeClass` — and a new member is exactly when they diverge.
		expect(body.error.class).toBe(shed.headers.get('X-Outcome-Class'));
		// Every response carries one, including this one — a support thread that starts "it
		// returned 429" is unanswerable without it.
		expect(body.requestId).toBeTruthy();

		park.admit();
		await Promise.all(held);
	});

	it('frees the slot when the handler throws, not just when it succeeds', async () => {
		// THE LEAK THAT WOULD BE SILENT. The parked transport throws on release, so each held
		// request leaves `served()` by the error path. If the release lived on the success path
		// the ceiling would ratchet down to zero and the gateway would answer 429 forever,
		// looking exactly like sustained load.
		const park = parkingTransport();
		const app = appWith(park.transport, 1);

		for (let i = 0; i < 3; i++) {
			const held = scrape(app);
			while (park.entered < i + 1) await new Promise((r) => setImmediate(r));
			park.admit();
			await held;
		}

		// A fourth request must still be admitted. It is only shed if slots leaked.
		const park2 = parkingTransport();
		const after = appWith(park2.transport, 1);
		const held = scrape(after);
		while (park2.entered < 1) await new Promise((r) => setImmediate(r));
		park2.admit();
		expect((await held).status).not.toBe(429);
	});

	it('never sheds /health, however full the gateway is', async () => {
		// An orchestrator restarts a container whose healthcheck fails. Shedding /health under
		// load converts backpressure — the mechanism for surviving load — into an outage.
		const park = parkingTransport();
		const app = appWith(park.transport, 1);

		const held = scrape(app);
		while (park.entered < 1) await new Promise((r) => setImmediate(r));

		expect((await scrape(app)).status).toBe(429);
		const health = await app.request('/health');
		expect(health.status).toBe(200);
		expect(((await health.json()) as { status: string }).status).toBe('ok');

		park.admit();
		await held;
	});

	it('refuses an unauthenticated caller with 401, and does not spend a slot on it', async () => {
		// ORDERING, and it is a denial-of-service question rather than a style one. Shedding
		// before the key check would let anyone who can reach the port fill the ceiling with
		// junk and starve the operator's own traffic.
		const park = parkingTransport();
		const app = appWith(park.transport, 1);

		for (let i = 0; i < 5; i++) {
			const bad = await app.request('/v1?api_key=wrong&url=https://example.com');
			expect(bad.status).toBe(401);
		}

		// The ceiling is 1 and five bad requests came through, so this is only admitted if none
		// of them took a slot.
		const held = scrape(app);
		while (park.entered < 1) await new Promise((r) => setImmediate(r));
		expect(park.entered).toBe(1);

		park.admit();
		await held;
	});

	it('applies no ceiling when maxInflight is omitted', async () => {
		// The default for every other test in this package, and for anyone embedding the app.
		const park = parkingTransport();
		const app = appWith(park.transport);

		const held = [scrape(app), scrape(app), scrape(app), scrape(app)];
		while (park.entered < 4) await new Promise((r) => setImmediate(r));
		expect(park.entered).toBe(4);

		park.admit();
		await Promise.all(held);
	});

	it('refuses to build an app with a nonsensical ceiling', async () => {
		// At `createApp`, so `pnpm dev` with a typo'd PROXLANE_MAX_INFLIGHT dies at boot rather
		// than on the first request it should have shed.
		expect(() => appWith(parkingTransport().transport, 0)).toThrow(RangeError);
		expect(() => appWith(parkingTransport().transport, Number.NaN)).toThrow(RangeError);
	});
});
