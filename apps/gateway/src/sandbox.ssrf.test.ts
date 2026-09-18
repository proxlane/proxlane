// The sandbox key against the edge guard, through the ROUTE. `pnpm test:ssrf`.
//
// `packages/shared/src/edge-guard.ssrf.test.ts` exercises the function sixty-odd ways and
// never the route, which is how the first sandbox shipped answering a simulated 200 for a
// metadata address: the guard lived inside `runChain`, the sandbox replaced `runChain`, and
// every existing SSRF test still passed. This is the test that would have gone red.

import { randomBytes } from 'node:crypto';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { guardTargetUrl } from '@proxlane/shared';
import type { HttpTransport } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const API_KEY = randomBytes(24).toString('hex');
const SANDBOX_KEY = randomBytes(24).toString('hex');
const adapter = await (REGISTRY.scraperapi as () => Promise<Adapter>)();

/** A transport that records that it was reached. In this file it must never be. */
const reached: string[] = [];
const transport: HttpTransport = {
	async execute(req) {
		reached.push(req.url);
		throw new Error('the sandbox reached the transport');
	},
};

const app = createApp({
	transport,
	candidates: [{ adapter, key: 'PARKED' }],
	apiKey: API_KEY,
	sandboxKey: SANDBOX_KEY,
	maxBodyBytes: 10 * 1024 * 1024,
	defaultDeadlineMs: 90_000,
});

const sandbox = (url: string) =>
	app.request(`/v1?url=${encodeURIComponent(url)}`, {
		headers: { Authorization: `Bearer ${SANDBOX_KEY}`, 'X-Proxlane-Simulate': 'OK' },
	});

describe('the sandbox does not bypass the edge guard', () => {
	it.each([
		'http://169.254.169.254/latest/meta-data/',
		'http://localhost:8787/health',
		'http://127.0.0.1/',
		'http://[::1]/',
		'file:///etc/passwd',
	])("%s gets the guard's own verdict through the sandbox key too", async (url) => {
		// PARITY WITH LIVE is the property, not one fixed outcome: the guard answers
		// TARGET_FORBIDDEN for a private address and BAD_REQUEST for a scheme it will not
		// fetch, and the sandbox must say whichever the live chain would.
		const live = guardTargetUrl(url);
		expect(live.allowed).toBe(false);
		const r = await sandbox(url);
		expect(r.headers.get('x-outcome')).toBe(live.allowed ? 'OK' : live.outcome);
		expect(r.status).toBe(r.headers.get('x-outcome') === 'TARGET_FORBIDDEN' ? 403 : 400);
		expect(r.headers.get('x-proxlane-simulated')).toBe('OK');
		expect(reached).toHaveLength(0);
	});

	it('answers a public target, still without touching the transport', async () => {
		const r = await sandbox('https://example.com/');
		expect(r.status).toBe(200);
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(reached).toHaveLength(0);
	});
});
