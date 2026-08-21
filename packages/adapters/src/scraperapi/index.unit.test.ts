// parse() and translate() against the REAL recorded bytes, nothing mocked.
//
// The fixtures were captured by `pnpm record --adapter=scraperapi` on 2026-08-07 with a
// live trial key. If one of these ever needs hand-editing to pass, the fixture is wrong or
// the provider changed — do not edit it, re-record it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GatewayRequest, Outcome, ProviderHttpResponse } from '../contract.js';
import { ScraperapiAdapter } from './index.js';

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

describe('scraperapi parse, against recorded bytes', () => {
	const cases: ReadonlyArray<[string, Outcome]> = [
		['success-html', 'OK'],
		['success-json', 'OK'],
		['target-not-found', 'TARGET_NOT_FOUND'],
		// sa-statuscode 503: the target failed, and ScraperAPI said so in a header.
		['target-error', 'TARGET_ERROR'],
	];

	for (const [category, expected] of cases) {
		it(`maps ${category} to ${expected}`, () => {
			expect(ScraperapiAdapter.parse(load(category)).outcome).toBe(expected);
		});
	}

	it('hands back the original bytes on a success', () => {
		const res = load('success-html');
		expect(ScraperapiAdapter.parse(res).body).toBe(res.body);
	});

	it('reads the charset from the recorded content-type', () => {
		expect(ScraperapiAdapter.parse(load('success-html')).charset).toBe('utf-8');
	});

	it('reports the real credit cost, which they DO send', () => {
		// This test used to assert the opposite — "ScraperAPI does not report one" — while
		// `sa-credit-cost` sat in the very fixture it loaded. A rendered request therefore
		// billed at 1 credit instead of 10.
		expect(ScraperapiAdapter.parse(load('success-html')).cost.source).toBe('reported');
		expect(ScraperapiAdapter.parse(load('render-js')).cost.microcredits).toBe(10_000_000);
	});
});

describe('the 500 that turned out NOT to mean two different things', () => {
	// The bodies really are byte-identical for a broken target and a slow one — that part was
	// measured correctly. The conclusion drawn from it was not: `sa-statuscode` distinguishes
	// them and is present on every recording. This adapter, integrations.md section 3 and
	// state.md all asserted that nothing did.
	it('has byte-identical BODIES, which is what was actually measured', () => {
		const broken = load('target-error');
		const slow = load('slow-target');
		expect(Buffer.from(slow.body)).toEqual(Buffer.from(broken.body));
	});

	it('but the HEADER tells them apart, and parse uses it', () => {
		expect(ScraperapiAdapter.parse(load('target-error')).upstreamStatusCode).toBe(503);
		expect(ScraperapiAdapter.parse(load('slow-target')).upstreamStatusCode).toBe(504);
	});

	it('treats a target 403 as a block, not as our key being bad', () => {
		// Previously AUTH_FAILED, which marks the customer's key unhealthy and cools their
		// whole ScraperAPI routing because one page has a login wall.
		const res = load('success-html');
		const r = ScraperapiAdapter.parse({
			...res,
			status: 403,
			headers: { ...res.headers, 'sa-statuscode': '403' },
		});
		expect(r.outcome).toBe('HARD_BLOCK');
	});

	it('reads a status with NO sa-statuscode as ScraperAPI itself failing', () => {
		const res = load('success-html');
		const { 'sa-statuscode': _drop, ...headers } = res.headers;
		expect(ScraperapiAdapter.parse({ ...res, status: 401, headers }).outcome).toBe(
			'AUTH_FAILED',
		);
		expect(ScraperapiAdapter.parse({ ...res, status: 429, headers }).outcome).toBe(
			'RATE_LIMITED',
		);
	});

	it('calls a present-but-nonsense sa-statuscode PROVIDER_DRIFT', () => {
		const res = load('success-html');
		for (const bad of ['', 'abc', '99', '600']) {
			const r = ScraperapiAdapter.parse({
				...res,
				headers: { ...res.headers, 'sa-statuscode': bad },
			});
			expect(r.outcome, `header "${bad}"`).toBe('PROVIDER_DRIFT');
		}
	});
});

describe('scraperapi translate', () => {
	// Annotated, not inferred: without this the literal `premium: 'none'` narrows the whole
	// object and every `{...req, premium: 'stealth'}` below fails to compile.
	const req: GatewayRequest = {
		url: 'https://example.test/a?b=c&d=e',
		method: 'GET',
		renderJs: false,
		premium: 'none',
		deadlineMs: 30_000,
	};
	const params = (r: GatewayRequest = req, key = 'K') =>
		new URL(ScraperapiAdapter.translate(r, key).url).searchParams;

	it('keeps the key out of the URL entirely', () => {
		// It travels as a header. The URL reaches fixtures, logs and error messages; a header
		// is one fewer place a live key can be copied out of.
		const w = ScraperapiAdapter.translate(req, 'SECRET');
		expect(w.url).not.toContain('SECRET');
		expect(w.headers['x-sapi-api_key']).toBe('SECRET');
	});

	it('round-trips a target URL whose own query string would otherwise be eaten', () => {
		expect(params().get('url')).toBe('https://example.test/a?b=c&d=e');
	});

	it('sets every parameter explicitly, including the ones matching the default', () => {
		// "Provider defaults never leak" — a provider changing a default must not change our
		// behaviour. Absence here is the bug this asserts against.
		for (const k of [
			'render',
			'premium',
			'ultra_premium',
			'device_type',
			'autoparse',
			'follow_redirect',
			'retry_404',
			'keep_headers',
		]) {
			expect(params().has(k), `${k} is not set explicitly`).toBe(true);
		}
	});

	it('turns retry_404 off, because FAILOVER says a 404 is final', () => {
		// Their default retry would spend money reaching the same answer — ScraperAPI charges
		// for 404s.
		expect(params().get('retry_404')).toBe('false');
	});

	it('maps the premium tiers onto their two separate flags', () => {
		expect([params().get('premium'), params().get('ultra_premium')]).toEqual([
			'false',
			'false',
		]);
		const resi = params({ ...req, premium: 'residential' });
		expect([resi.get('premium'), resi.get('ultra_premium')]).toEqual(['true', 'false']);
		const stealth = params({ ...req, premium: 'stealth' });
		expect([stealth.get('premium'), stealth.get('ultra_premium')]).toEqual(['false', 'true']);
	});

	it('only asks to keep headers when the caller actually sent some', () => {
		expect(params().get('keep_headers')).toBe('false');
		const withHeaders = ScraperapiAdapter.translate({ ...req, headers: { 'x-a': '1' } }, 'K');
		expect(new URL(withHeaders.url).searchParams.get('keep_headers')).toBe('true');
		expect(withHeaders.headers['x-a']).toBe('1');
	});

	it('lowercases the country code and omits it when absent', () => {
		expect(params().has('country_code')).toBe(false);
		expect(params({ ...req, countryCode: 'US' }).get('country_code')).toBe('us');
	});

	it('forwards a POST, method and body, rather than refusing it', () => {
		// IT USED TO THROW. A POST therefore had a chain of exactly one provider — Bright Data,
		// the only adapter that implemented it — and could not fail over at all, on a product
		// whose headline feature is failover. The gateway had carried `method` and `body` on
		// `GatewayRequest` the whole time; only this refused them.
		//
		// Verified live against `httpbin.dev/post`, which echoes what it received: the payload
		// came back through all three providers. The recorded `post` fixture is that exchange.
		const wire = ScraperapiAdapter.translate({ ...req, method: 'POST', body: '{"a":1}' }, 'K');
		expect(wire.method).toBe('POST');
		expect(wire.body).toBe('{"a":1}');
	});

	it('sends no body when there is none', () => {
		// An empty string is not the same as absent: some providers treat a present-but-empty
		// body as a form post and change the content type on the target's behalf.
		expect(ScraperapiAdapter.translate(req, 'K').body).toBeUndefined();
		expect(ScraperapiAdapter.translate(req, 'K').method).toBe('GET');
	});

	it('budgets the attempt at ScraperAPI’s real 70s boundary', () => {
		// Their billing rule makes 70s the real edge of an attempt: a request cancelled from
		// our side before then is still charged.
		expect(ScraperapiAdapter.translate(req, 'K').timeoutMs).toBe(70_000);
	});
});
