// parse() and translate() against the REAL recorded bytes, nothing mocked.
//
// Captured by `pnpm record --adapter=scrapingbee` on 2026-08-07 with a live trial key.
// Do not hand-edit a fixture to make a test pass — re-record it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GatewayRequest, Outcome, ProviderHttpResponse } from '../contract.js';
import { ScrapingbeeAdapter } from './index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function load(category: string): ProviderHttpResponse {
	const f = JSON.parse(readFileSync(join(FIXTURES, `${category}.json`), 'utf8')) as {
		kind: string;
		response: { status: number; headers: Record<string, string>; bodyBase64: string };
	};
	if (f.kind !== 'exchange') throw new Error(`${category} is a ${f.kind}, not an exchange`);
	return {
		status: f.response.status,
		headers: f.response.headers,
		body: new Uint8Array(Buffer.from(f.response.bodyBase64, 'base64')),
	};
}

describe('scrapingbee parse, against recorded bytes', () => {
	const cases: ReadonlyArray<[string, Outcome]> = [
		['success-html', 'OK'],
		['success-json', 'OK'],
		['target-not-found', 'TARGET_NOT_FOUND'],
		// The one ScraperAPI cannot produce. Its single 500 conflates target and provider
		// failure; ScrapingBee states the target's real status in a header.
		['target-error', 'TARGET_ERROR'],
	];
	for (const [category, expected] of cases) {
		it(`maps ${category} to ${expected}`, () => {
			expect(ScrapingbeeAdapter.parse(load(category)).outcome).toBe(expected);
		});
	}

	it('reports the real credit cost rather than estimating it', () => {
		// spb-cost is the provider's own figure, which is what lets the ledger be exact
		// despite CostTable being unable to express their render+premium pricing.
		const r = ScrapingbeeAdapter.parse(load('success-html'));
		expect(r.cost.source).toBe('reported');
		expect(r.cost.microcredits).toBe(1_000_000);
	});
});

describe('telling a target failure from a provider failure', () => {
	const ok = load('success-html');

	it('treats a missing initial-status header as ScrapingBee failing, not the target', () => {
		// Verified live: a bad key returns 401 with the header absent. Without that branch a
		// 401 would be read as "the target returned 401", which is a different outcome and a
		// different cooldown namespace.
		const { 'spb-initial-status-code': _drop, ...headers } = ok.headers;
		const res = { ...ok, status: 401, headers };
		expect(ScrapingbeeAdapter.parse(res).outcome).toBe('AUTH_FAILED');
	});

	it('treats the same 401 WITH the header as the target rejecting us', () => {
		const res = {
			...ok,
			status: 401,
			headers: { ...ok.headers, 'spb-initial-status-code': '401' },
		};
		const r = ScrapingbeeAdapter.parse(res);
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.upstreamStatusCode).toBe(401);
	});

	it('calls a present-but-nonsense header PROVIDER_DRIFT rather than guessing', () => {
		// Number('') is 0 and Number('abc') is NaN. Both would otherwise pass for "a status",
		// and guessing from the bare status is how ScraperAPI's ambiguity gets reintroduced.
		for (const bad of ['', 'abc', '99', '600']) {
			const res = { ...ok, headers: { ...ok.headers, 'spb-initial-status-code': bad } };
			expect(ScrapingbeeAdapter.parse(res).outcome, `header "${bad}"`).toBe('PROVIDER_DRIFT');
		}
	});
});

describe('scrapingbee translate', () => {
	const req: GatewayRequest = {
		url: 'https://example.test/a?b=c&d=e',
		method: 'GET',
		renderJs: false,
		premium: 'none',
		deadlineMs: 30_000,
	};
	const params = (r: GatewayRequest = req, key = 'K') =>
		new URL(ScrapingbeeAdapter.translate(r, key).url).searchParams;

	it('sends render_js explicitly, because their default is TRUE', () => {
		// Omitting it renders every request and bills 5 credits instead of 1 — a 5x silent
		// overspend on plain fetches, and the sharpest instance of a leaking default.
		expect(params().get('render_js')).toBe('false');
		expect(params({ ...req, renderJs: true }).get('render_js')).toBe('true');
	});

	it('forces transparent_status_code on, because their default hides target failures', () => {
		// Default false returns 200 for a target's 404 — the exact dishonesty this product
		// exists to prevent, shipped by default and opt-out.
		expect(params().get('transparent_status_code')).toBe('true');
	});

	it('bounds their timeout to ours rather than accepting their 140s default', () => {
		expect(params().get('timeout')).toBe('70000');
	});

	it('keeps the key out of the URL', () => {
		const w = ScrapingbeeAdapter.translate(req, 'SECRET');
		expect(w.url).not.toContain('SECRET');
		expect(w.headers.authorization).toBe('Bearer SECRET');
	});

	it('sets every parameter explicitly', () => {
		for (const k of [
			'render_js',
			'transparent_status_code',
			'premium_proxy',
			'stealth_proxy',
			'block_resources',
			'block_ads',
			'return_page_source',
			'json_response',
			'device',
			'timeout',
		]) {
			expect(params().has(k), `${k} is not set explicitly`).toBe(true);
		}
	});

	it('maps the premium tiers onto their two separate flags', () => {
		const resi = params({ ...req, premium: 'residential' });
		expect([resi.get('premium_proxy'), resi.get('stealth_proxy')]).toEqual(['true', 'false']);
		const stealth = params({ ...req, premium: 'stealth' });
		expect([stealth.get('premium_proxy'), stealth.get('stealth_proxy')]).toEqual([
			'false',
			'true',
		]);
	});

	it('forwards a POST, method and body, rather than refusing it', () => {
		// IT USED TO THROW. A POST therefore had a chain of exactly one provider — Bright Data,
		// the only adapter that implemented it — and could not fail over at all, on a product
		// whose headline feature is failover. The gateway had carried `method` and `body` on
		// `GatewayRequest` the whole time; only this refused them.
		//
		// Verified live against `httpbin.dev/post`, which echoes what it received: the payload
		// came back through all three providers. The recorded `post` fixture is that exchange.
		const wire = ScrapingbeeAdapter.translate({ ...req, method: 'POST', body: '{"a":1}' }, 'K');
		expect(wire.method).toBe('POST');
		expect(wire.body).toBe('{"a":1}');
	});

	it('sends no body when there is none', () => {
		// An empty string is not the same as absent: some providers treat a present-but-empty
		// body as a form post and change the content type on the target's behalf.
		expect(ScrapingbeeAdapter.translate(req, 'K').body).toBeUndefined();
		expect(ScrapingbeeAdapter.translate(req, 'K').method).toBe('GET');
	});
});
