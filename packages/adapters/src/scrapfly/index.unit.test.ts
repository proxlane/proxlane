// parse() and translate() against the REAL recorded bytes, nothing mocked.
//
// Captured by `pnpm record --adapter=scrapfly` on 2026-08-07 with a live trial key.
// Do not hand-edit a fixture to make a test pass — re-record it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthWeight } from '@proxlane/shared';
import { describe, expect, it } from 'vitest';
import type {
	GatewayRequest,
	Outcome,
	PremiumTier,
	ProviderHttpResponse,
} from '../contract.js';
import { cooldownScope, costOf, policyFor, shouldFailover } from '../contract.js';
import { ScrapflyAdapter } from './index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function raw(category: string) {
	return JSON.parse(readFileSync(join(FIXTURES, `${category}.json`), 'utf8')) as {
		kind: string;
		response?: { status: number; headers: Record<string, string>; bodyBase64: string };
	};
}
function load(category: string): ProviderHttpResponse {
	const f = raw(category);
	if (f.kind !== 'exchange' || !f.response) throw new Error(`${category} is not an exchange`);
	return {
		status: f.response.status,
		headers: f.response.headers,
		body: new Uint8Array(Buffer.from(f.response.bodyBase64, 'base64')),
	};
}

describe('scrapfly parse, against recorded bytes', () => {
	const cases: ReadonlyArray<[string, Outcome]> = [
		['success-html', 'OK'],
		['success-json', 'OK'],
		['target-not-found', 'TARGET_NOT_FOUND'],
		['target-error', 'TARGET_ERROR'],
	];
	for (const [category, expected] of cases) {
		it(`maps ${category} to ${expected}`, () => {
			expect(ScrapflyAdapter.parse(load(category)).outcome).toBe(expected);
		});
	}

	it('reads the target status out of the envelope, not off the transport', () => {
		// A target 404 arrives as HTTP 200. Reading the transport status alone records every
		// dead target as a success — the failure this product exists to prevent.
		const res = load('target-not-found');
		expect(res.status).toBe(200);
		expect(ScrapflyAdapter.parse(res).upstreamStatusCode).toBe(404);
	});

	it('reports the real cost rather than estimating it', () => {
		const r = ScrapflyAdapter.parse(load('success-html'));
		expect(r.cost.source).toBe('reported');
		expect(r.cost.microcredits).toBe(1_000_000);
	});

	it('returns the page, not the envelope that wrapped it', () => {
		const body = ScrapflyAdapter.parse(load('success-html')).body;
		const text = new TextDecoder().decode(body);
		expect(text).toContain('Herman Melville');
		expect(text).not.toContain('"result"');
	});
});

describe('a null target status is not drift', () => {
	// This shipped as a bug and the recorder caught it. On ERR::SCRAPE::NETWORK_ERROR there
	// is no target response, so result.status_code is null. Requiring a number made every
	// such response PROVIDER_DRIFT — which PAGES SOMEONE — for an ordinary error.
	it('maps the recorded network error to TARGET_ERROR, never PROVIDER_DRIFT', () => {
		const r = ScrapflyAdapter.parse(load('slow-target'));
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.upstreamStatusCode).toBeUndefined();
	});

	it('calls an exhausted quota an ACCOUNT fact, never a provider one', () => {
		// The shape Scrapfly really sends on an empty plan, taken from a live 429 on 2026-08-29:
		// HTTP 429, `ERR::SCRAPE::QUOTA_LIMIT_REACHED`, and a null `status_code` because it never
		// reached the target.
		//
		// Unmapped, that fell through to PROVIDER_ERROR — which section 3 puts in the failure
		// term of GLOBAL health, `hs:{provider}`. One org running out of credits would then drive
		// the statistic down for every org, and demotion removes a provider from every chain for
		// hours. Exactly the contamination already documented for AUTH_FAILED.
		const env = {
			result: {
				status_code: null,
				format: 'text',
				content: '',
				error: { code: 'ERR::SCRAPE::QUOTA_LIMIT_REACHED', http_code: 429 },
			},
		};
		const res: ProviderHttpResponse = {
			status: 429,
			headers: {},
			body: new TextEncoder().encode(JSON.stringify(env)),
		};
		const out = ScrapflyAdapter.parse(res);
		expect(out.outcome).toBe('RATE_LIMITED');
		// The half that matters. `acct` keeps it to the org whose quota it is; `blk` would cool a
		// domain nobody blocked, and a provider-scoped outcome would cool the provider for
		// strangers.
		expect(policyFor(out.outcome).cooldown).toBe('acct');
		// And the one that names the bug: PROVIDER_ERROR is in HEALTH_FAILURE, the global
		// statistic. An account fact must weigh nothing there, or one org's empty wallet demotes
		// the provider for strangers.
		expect(healthWeight(out.outcome)).toBe('ignore');
		expect(healthWeight('PROVIDER_ERROR')).toBe('failure');
	});

	it('falls back to PROVIDER_ERROR when the code is unrecognised and there is no status', () => {
		const env = {
			result: {
				status_code: null,
				format: 'text',
				content: '',
				error: { code: 'ERR::NEW::CODE' },
			},
		};
		const res: ProviderHttpResponse = {
			status: 422,
			headers: {},
			body: new TextEncoder().encode(JSON.stringify(env)),
		};
		expect(ScrapflyAdapter.parse(res).outcome).toBe('PROVIDER_ERROR');
	});
});

describe('a body the provider stored out of band', () => {
	// THE VALUES BELOW ARE A REAL CAPTURE, not an invention. Taken 2026-08-27 from a live
	// Scrapfly call against a 9 MB script on a public package CDN — the pointer, the
	// content-type and the seven-credit charge are that response verbatim.
	//
	// It is a unit test rather than a fixture BECAUSE IT COULD NOT BE RECORDED: the account hit
	// 0/1000 credits during the recording run itself, and the free tier does not reset until
	// 2026-09-07. `conformance/deferred-fixtures.json` carries that debt with a date, and
	// conformance goes red if the fixture is still missing once recording is possible again.
	// Building the envelope inline is the same thing the account-error and drift cases above do,
	// for the same reason: some shapes cannot be summoned on demand.
	const OFFLOADED = 'https://api.scrapfly.io/scrape/large_object/01M119CYCRD4B71MN8RTGDBBEY';

	function offloaded(format: 'clob' | 'blob'): ProviderHttpResponse {
		return {
			status: 200,
			headers: {},
			body: new TextEncoder().encode(
				JSON.stringify({
					result: {
						status_code: 200,
						format,
						content: OFFLOADED,
						content_type: 'text/javascript; charset=utf-8',
					},
					context: { cost: { total: 7 } },
				}),
			),
		};
	}

	it('does not hand back the pointer as though it were the page', () => {
		// The bug, stated as the thing that must never happen again. Before this, `clob` fell to
		// the text path and the caller received these 70 characters with HTTP 200, X-Outcome: OK
		// and the target's own content-type. Any caller writes that to disk as the page.
		const r = ScrapflyAdapter.parse(offloaded('clob'));
		expect(r.outcome).toBe('PROVIDER_BODY_OFFLOADED');
		expect(r.body).toBeUndefined();
	});

	it('does not base64-decode the pointer into silent garbage', () => {
		// `blob` was the worse half: the binary path ran Buffer.from(url, 'base64'), which does
		// not throw on a URL — it lenient-decodes it into meaningless bytes. A caller gets a
		// corrupt file rather than an obviously wrong one.
		const r = ScrapflyAdapter.parse(offloaded('blob'));
		expect(r.outcome).toBe('PROVIDER_BODY_OFFLOADED');
		expect(r.body).toBeUndefined();
	});

	it('still reports what the attempt cost, because we were charged for it', () => {
		// Seven credits, spent, body or no body. Cost is reported and never routed on, and an
		// attempt that failed still shows up in X-Cost-Estimate — the same honesty the chain
		// applies to every other failed hop.
		expect(ScrapflyAdapter.parse(offloaded('clob')).cost).toEqual({
			microcredits: 7_000_000,
			source: 'reported',
		});
	});

	it('keeps the upstream status, so the caller can see the target was fine', () => {
		// The target answered 200. The provider is what could not deliver it. Losing that
		// distinction is how a provider problem gets logged as a target problem.
		expect(ScrapflyAdapter.parse(offloaded('clob')).upstreamStatusCode).toBe(200);
	});

	it('fails over, and does not arm a cooldown against a healthy provider', () => {
		// The policy IS the fix: another provider inlines a body this size, so failover is the
		// repair rather than a hopeful retry. And Scrapfly is working — sidelining it for hours
		// over one large page would degrade every small request it handles perfectly well.
		expect(shouldFailover('PROVIDER_BODY_OFFLOADED')).toBe(true);
		expect(cooldownScope('PROVIDER_BODY_OFFLOADED')).toBe('none');
	});
});

describe('telling a target failure from an account failure', () => {
	it('uses the ABSENCE of result, not the status, for an account error', () => {
		// Verified live: a bad key returns HTTP 401 with {error_id, http_code, message, reason}
		// and no `result`. A target 403 and an out-of-credits 403 are the same number and very
		// different facts, so the discriminator has to be structural.
		const res: ProviderHttpResponse = {
			status: 401,
			headers: {},
			body: new TextEncoder().encode(JSON.stringify({ http_code: 401, message: 'bad key' })),
		};
		expect(ScrapflyAdapter.parse(res).outcome).toBe('AUTH_FAILED');
	});

	it('calls a malformed result drift rather than guessing past it', () => {
		const res: ProviderHttpResponse = {
			status: 200,
			headers: {},
			body: new TextEncoder().encode(JSON.stringify({ result: { nonsense: true } })),
		};
		expect(ScrapflyAdapter.parse(res).outcome).toBe('PROVIDER_DRIFT');
	});

	it('calls a non-JSON body drift, since they document JSON on every path', () => {
		const res: ProviderHttpResponse = {
			status: 200,
			headers: {},
			body: new TextEncoder().encode('<html>gateway error</html>'),
		};
		expect(ScrapflyAdapter.parse(res).outcome).toBe('PROVIDER_DRIFT');
	});
});

describe('the deadline fixture', () => {
	it('is a deadline, with no status and no body to reach for', () => {
		const f = raw('deadline') as { kind: string; transportError?: string };
		expect(f.kind).toBe('deadline');
		expect(f.transportError).toBe('aborted-by-deadline');
	});
});

describe('scrapfly translate', () => {
	const req: GatewayRequest = {
		url: 'https://example.test/a?b=c',
		method: 'GET',
		renderJs: false,
		premium: 'none',
		deadlineMs: 30_000,
	};
	const params = (r: GatewayRequest = req, key = 'K') =>
		new URL(ScrapflyAdapter.translate(r, key).url).searchParams;

	it('turns their internal retry OFF', () => {
		// retry DEFAULTS TO TRUE. FAILOVER defines retry centrally, exactly once, so a
		// provider retrying underneath us spends budget we never authorised and reports a
		// latency containing attempts we cannot see.
		expect(params().get('retry')).toBe('false');
	});

	it('bounds their timeout below their own socket ceiling', () => {
		// Measured: they hang and drop the socket at ~60s. Ours must fire first or the outcome
		// is an opaque transport error instead of an attributable one.
		expect(params().get('timeout')).toBe('50000');
		expect(ScrapflyAdapter.translate(req, 'K').timeoutMs).toBe(50_000);
	});

	it('asks for the raw page, not one of their rewrites', () => {
		// clean_html/markdown/text are transformations; a gateway that silently rewrites the
		// page is not a proxy.
		expect(params().get('format')).toBe('raw');
	});

	it('sets every parameter explicitly', () => {
		for (const k of ['render_js', 'asp', 'proxy_pool', 'retry', 'cache', 'timeout', 'format']) {
			expect(params().has(k), `${k} is not set explicitly`).toBe(true);
		}
	});

	it('maps stealth to asp and residential to the residential pool', () => {
		expect(params({ ...req, premium: 'stealth' }).get('asp')).toBe('true');
		expect(params({ ...req, premium: 'residential' }).get('proxy_pool')).toBe(
			'public_residential_pool',
		);
		expect(params().get('proxy_pool')).toBe('public_datacenter_pool');
	});

	it('carries the key in the query string, which is why redaction matters here', () => {
		// Scrapfly documents no header form, so unlike the other two the URL itself holds a
		// live credential.
		expect(params(req, 'SECRET').get('key')).toBe('SECRET');
	});

	it('forwards a POST, method and body, rather than refusing it', () => {
		// IT USED TO THROW. A POST therefore had a chain of exactly one provider — Bright Data,
		// the only adapter that implemented it — and could not fail over at all, on a product
		// whose headline feature is failover. The gateway had carried `method` and `body` on
		// `GatewayRequest` the whole time; only this refused them.
		//
		// Verified live against `httpbin.dev/post`, which echoes what it received: the payload
		// came back through all three providers. The recorded `post` fixture is that exchange.
		const wire = ScrapflyAdapter.translate({ ...req, method: 'POST', body: '{"a":1}' }, 'K');
		expect(wire.method).toBe('POST');
		expect(wire.body).toBe('{"a":1}');
	});

	it('sends no body when there is none', () => {
		// An empty string is not the same as absent: some providers treat a present-but-empty
		// body as a form post and change the content type on the target's behalf.
		expect(ScrapflyAdapter.translate(req, 'K').body).toBeUndefined();
		expect(ScrapflyAdapter.translate(req, 'K').method).toBe('GET');
	});
});

describe('the cost table prices what translate() actually sends', () => {
	// THE CELL THAT WAS WRONG, AND THE SHAPE OF WHY. `stealth` was priced at the datacenter base
	// on the reasoning that Scrapfly's ASP flag is "totally free on non-blocked scrape". True of
	// the flag, and beside the point: `translate()` sends `proxy_pool=public_residential_pool`
	// for every tier except `none`, so a stealth request IS a residential request and costs the
	// residential figures. The free thing and the expensive thing are two different parameters,
	// and the comment reasoned about only one of them. It published 1x against a real 25x on
	// `/scraping-api-comparison`.
	//
	// Conformance cannot catch this — stealth and residential differ in `asp`, so their wire
	// forms are not identical and its pair check skips them. Which parameter drives the price is
	// provider knowledge, so the check belongs here, reading this adapter's own output.
	const poolFor = (premium: PremiumTier): string => {
		const wire = ScrapflyAdapter.translate(
			{
				url: 'https://example.com/',
				renderJs: false,
				premium,
				method: 'GET',
				deadlineMs: 30_000,
			},
			'K',
		);
		return new URL(wire.url).searchParams.get('proxy_pool') ?? '';
	};

	it('sends the residential pool for more than one tier', () => {
		// Non-zero denominator. If translate() ever stopped sharing a pool across tiers, the
		// assertion below would be vacuous rather than satisfied.
		const pools = (['none', 'residential', 'stealth'] as PremiumTier[]).map(poolFor);
		expect(new Set(pools).size, 'every tier sends a distinct pool').toBeLessThan(pools.length);
	});

	it('charges the residential price for every tier that uses the residential pool', () => {
		const residentialPool = poolFor('residential');
		expect(residentialPool).toContain('residential');
		const floor = costOf(ScrapflyAdapter.capabilities.costTable, {
			premium: 'residential',
			renderJs: false,
		});
		expect(floor).not.toBeNull();

		for (const premium of ['none', 'residential', 'stealth'] as PremiumTier[]) {
			if (poolFor(premium) !== residentialPool) continue;
			const cost = costOf(ScrapflyAdapter.capabilities.costTable, { premium, renderJs: false });
			expect(cost, `${premium} sends the residential pool but is priced below it`).toBe(floor);
		}
	});
});
