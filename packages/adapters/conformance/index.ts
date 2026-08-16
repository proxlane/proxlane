// The shared conformance suite: one set of invariants, run against every registered
// adapter. `pnpm conformance [--adapter=<id>]`.
//
// What this is FOR: making "a new adapter is correct" a mechanical question. A contributor
// implements the interface, records fixtures, and runs this. What it deliberately is NOT is
// proof that the adapter works — that needs real provider keys, and GitHub Actions does not
// expose secrets to fork PRs, so the live canary cannot run on a community PR. This suite
// checks the properties that CAN be checked from recorded bytes and declared capabilities.
//
// Every check states what it examined. A check that examined zero things exits 1 and says
// so, because a vacuous pass is the same lie as a stub that exits 0.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type Adapter,
	carriesBody,
	type GatewayRequest,
	OUTCOMES,
	type Outcome,
	type ParsedResult,
	type PremiumTier,
	REGISTRY,
} from '../src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Failure {
	readonly adapter: string;
	readonly check: string;
	readonly detail: string;
}

/**
 * Outcomes an adapter must NEVER return, and why each one belongs to somebody else.
 *
 * This is the check that keeps the layering honest. An adapter that reaches for
 * PROVIDER_TIMEOUT is measuring a clock it does not have; one that reaches for SOFT_BLOCK
 * is claiming a detector ran that cannot have run, because `parse` is pure and `/detect`
 * happens outside it.
 */
const FORBIDDEN: ReadonlyMap<Outcome, string> = new Map([
	['SOFT_BLOCK', 'assigned by the gateway after /detect runs; a pure parse cannot know'],
	['PROVIDER_TIMEOUT', 'the transport owns the clock; parse never sees a response'],
	['TARGET_FORBIDDEN', 'our edge rejected the target; no provider was involved'],
	['NO_PROVIDER_AVAILABLE', 'the router decides this before an adapter is chosen'],
	['RESPONSE_TOO_LARGE', 'the transport enforces the body cap'],
	['BUDGET_EXCEEDED', 'the router owns the global deadline and cost budget'],
]);

/** The outcome each fixture category must produce, for every adapter that has it. */
const EXPECTED: Readonly<Record<string, Outcome | 'provider-dependent'>> = {
	'success-html': 'OK',
	'success-json': 'OK',
	'render-js': 'OK',
	'target-not-found': 'TARGET_NOT_FOUND',
	'target-error': 'TARGET_ERROR',
	'target-rate-limited': 'TARGET_RATE_LIMITED',
	// Honoured if one is ever captured; see REQUIRED below for why it cannot be required.
	'provider-error': 'PROVIDER_ERROR',
	// Measured across three providers: 422, 500 and a plain 200. There is no single right
	// answer, so asserting one would be a permanent false failure.
	'slow-target': 'provider-dependent',
};

/**
 * Categories every adapter must have recorded.
 *
 * The zero-fixture guard below is not enough on its own: an adapter shipping only
 * `success-html` satisfies it and is then never checked for the thing that matters most,
 * which is whether it can tell a TARGET failure from its OWN. Get that wrong and one popular
 * dead site pushes a healthy provider toward demotion for every org — the cross-org
 * contamination the two cooldown namespaces exist to prevent, arriving through outcome
 * attribution instead.
 *
 * `provider-error` is deliberately NOT here. It needs a provider 5xx, which cannot be
 * summoned on demand — the same structural gap `/detect` has with block pages, and
 * hand-writing one would be the fabricated fixture CLAUDE.md forbids. The consequence is
 * stated rather than hidden: the failure term of the health statistic
 * (`packages/shared/src/health.ts`) rests on review, not on this suite.
 */
const REQUIRED = [
	'success-html',
	'target-not-found',
	'target-error',
	// Recordable, unlike a block page, so it is required rather than merely honoured. A target
	// 429 is the one target fact that arms a shared cooldown, so an adapter mapping it wrong
	// either backs off when it should not or does not when it should.
	'target-rate-limited',
] as const;

interface ExchangeFixture {
	kind: 'exchange';
	category: string;
	response: { status: number; headers: Record<string, string>; bodyBase64: string };
}
interface DeadlineFixture {
	kind: 'deadline';
	category: string;
}
type Fixture = ExchangeFixture | DeadlineFixture;

function fixturesFor(id: string): { category: string; fixture: Fixture }[] {
	const dir = join(ROOT, 'packages/adapters/src', id, 'fixtures');
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => ({
			category: f.replace(/\.json$/, ''),
			fixture: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture,
		}));
}

/** Every combination the router can legally ask for, so no parameter escapes unset. */
function requestMatrix(a: Adapter): GatewayRequest[] {
	const tiers = [...a.capabilities.premiumTiers] as PremiumTier[];
	const out: GatewayRequest[] = [];
	for (const premium of tiers) {
		for (const renderJs of a.capabilities.renderJs ? [false, true] : [false]) {
			out.push({
				url: 'https://example.test/a?b=c',
				method: 'GET',
				renderJs,
				premium,
				deadlineMs: 30_000,
			});
		}
	}
	return out;
}

export async function conformOne(id: string): Promise<{ failures: Failure[]; checks: number }> {
	const failures: Failure[] = [];
	let checks = 0;
	const fail = (check: string, detail: string) => failures.push({ adapter: id, check, detail });

	const adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
	const caps = adapter.capabilities;

	// ---------------------------------------------------------------- capabilities
	if (caps.id !== id)
		fail('capabilities', `registered as "${id}" but declares id "${caps.id}"`);
	if (caps.premiumTiers.size === 0)
		fail('capabilities', 'declares no premium tier, not even none');
	if (caps.fastTimeoutMs > caps.maxTimeoutMs)
		fail(
			'capabilities',
			`fastTimeoutMs ${caps.fastTimeoutMs} exceeds maxTimeoutMs ${caps.maxTimeoutMs}`,
		);
	if (caps.costTable.sourceUrl.startsWith('TODO'))
		fail('capabilities', 'cost table has no source link');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(caps.costTable.effectiveDate))
		fail(
			'capabilities',
			`cost table effectiveDate "${caps.costTable.effectiveDate}" is not an ISO date`,
		);
	checks += 5;

	// ---------------------------------------------------------------- translate
	const matrix = requestMatrix(adapter);
	if (matrix.length === 0) fail('translate', 'request matrix is empty — nothing was exercised');
	const seen = new Set<string>();
	for (const req of matrix) {
		const wire = adapter.translate(req, 'CONFORMANCE_KEY');
		checks++;

		// Purity: same input, same output. A clock or a counter inside translate would break
		// every replay test downstream, and it would do so intermittently.
		const again = adapter.translate(req, 'CONFORMANCE_KEY');
		if (JSON.stringify(wire) !== JSON.stringify(again))
			fail('translate', 'not pure: two identical calls produced different requests');

		if (!wire.url.startsWith('https://'))
			fail('translate', `built a non-https url: ${wire.url.slice(0, 40)}`);
		if (wire.timeoutMs <= 0) fail('translate', 'timeoutMs must be positive');
		if (wire.timeoutMs > caps.maxTimeoutMs)
			fail('translate', `timeoutMs ${wire.timeoutMs} exceeds its own maxTimeoutMs`);

		// The target url must survive intact, query string and all. Losing it is the bug that
		// silently scrapes the wrong page.
		//
		// THE BODY COUNTS TOO. This looked in the url and nowhere else, which held only because
		// all three launch providers happen to take their parameters as a query string. A
		// provider whose API is POST-with-a-JSON-body — Bright Data's Web Unlocker is one —
		// carries the target url in `wire.body`, so this failed it for doing nothing wrong.
		//
		// That was not a Bright Data problem. It was this suite encoding "parameters live in
		// the url" as if it were part of the contract, when the contract says no such thing.
		const url = new URL(wire.url);
		const body = wire.body ?? '';
		const carried = [...url.searchParams.values()].some((v) => v.includes(req.url));
		const inPath = wire.url.includes(encodeURIComponent(req.url)) || wire.url.includes(req.url);
		const inBody =
			body.includes(req.url) || body.includes(JSON.stringify(req.url).slice(1, -1));
		if (!carried && !inPath && !inBody)
			fail('translate', 'the target url is not present in the request');

		// The body is part of a request's identity for the same reason. Without it every POST
		// adapter looks like it builds one identical request for every input, and the
		// defaults-never-leak check below reports capabilities as ignored when they are not.
		seen.add(JSON.stringify({ u: wire.url, h: wire.headers, b: body }));
	}

	// ------------------------------------------------- provider defaults never leak
	//
	// PER DIMENSION, not in aggregate. The first version of this check only asked whether
	// ALL variants collapsed to one request, which a hardcoded `render=false` sails straight
	// past: the premium variants still differ, so the set has more than one member and the
	// check passes while renderJs is being ignored. Verified by hardcoding it and watching
	// the suite stay green.
	//
	// Each dimension the adapter CLAIMS to support must visibly change what goes on the
	// wire. If it does not, the provider's own default is deciding our behaviour.
	const base: GatewayRequest = {
		url: 'https://example.test/a?b=c',
		method: 'GET',
		renderJs: false,
		premium: 'none',
		deadlineMs: 30_000,
	};
	const wireOf = (r: GatewayRequest) => JSON.stringify(adapter.translate(r, 'CONFORMANCE_KEY'));

	if (caps.renderJs) {
		checks++;
		if (wireOf(base) === wireOf({ ...base, renderJs: true }))
			fail('translate', 'declares renderJs but toggling it does not change the request');
	}
	for (const tier of caps.premiumTiers) {
		if (tier === 'none') continue;
		checks++;
		if (wireOf(base) === wireOf({ ...base, premium: tier }))
			fail(
				'translate',
				`declares the "${tier}" tier but selecting it does not change the request`,
			);
	}
	if (caps.countryCodes === 'all' || caps.countryCodes.size > 0) {
		const cc = caps.countryCodes === 'all' ? 'de' : [...caps.countryCodes][0];
		checks++;
		if (cc !== undefined && wireOf(base) === wireOf({ ...base, countryCode: cc }))
			fail(
				'translate',
				`declares country support but setting countryCode=${cc} changes nothing`,
			);
	}
	if (caps.sessions) {
		checks++;
		if (wireOf(base) === wireOf({ ...base, sessionId: 'conformance-session' }))
			fail('translate', 'declares sessions but setting sessionId does not change the request');
	}
	if (caps.post) {
		checks++;
		try {
			adapter.translate({ ...base, method: 'POST', body: 'x=1' }, 'CONFORMANCE_KEY');
		} catch {
			fail('translate', 'declares post support but translate() throws on POST');
		}
	} else {
		checks++;
		// The inverse matters too: an adapter that declares post:false must REFUSE, not
		// quietly issue a GET and return a page for a request nobody made.
		let refused = false;
		try {
			adapter.translate({ ...base, method: 'POST', body: 'x=1' }, 'CONFORMANCE_KEY');
		} catch {
			refused = true;
		}
		if (!refused) fail('translate', 'declares post:false but translate() accepted a POST');
	}

	// ---------------------------------------------------------------- parse, on real bytes
	const fixtures = fixturesFor(id);
	if (fixtures.length === 0) {
		fail('fixtures', `no recorded fixtures — run \`pnpm record --adapter=${id}\``);
	}
	const present = new Set(fixtures.map((f) => f.category));
	for (const need of REQUIRED) {
		if (!present.has(need)) {
			fail(
				'fixtures',
				`no \`${need}\` fixture. Required: an adapter that cannot be checked for ` +
					'target-versus-provider attribution can demote a healthy provider for every org',
			);
		}
	}
	for (const { category, fixture } of fixtures) {
		if (fixture.kind !== 'exchange') continue;
		const res = {
			status: fixture.response.status,
			headers: fixture.response.headers,
			body: new Uint8Array(Buffer.from(fixture.response.bodyBase64, 'base64')),
		};
		let result: ParsedResult;
		try {
			result = adapter.parse(res);
		} catch (err) {
			fail('parse', `${category}: threw ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		checks++;

		const again = adapter.parse(res);
		if (again.outcome !== result.outcome)
			fail('parse', `${category}: not pure — two calls disagreed`);

		if (!(OUTCOMES as readonly string[]).includes(result.outcome))
			fail('parse', `${category}: "${result.outcome}" is not in the taxonomy`);

		const why = FORBIDDEN.get(result.outcome);
		if (why !== undefined) fail('parse', `${category}: returned ${result.outcome} — ${why}`);

		const expected = EXPECTED[category];
		if (
			expected !== undefined &&
			expected !== 'provider-dependent' &&
			result.outcome !== expected
		)
			fail('parse', `${category}: expected ${expected}, got ${result.outcome}`);

		// The body rule is the contract's, not the adapter's. This is the check that would
		// have caught ScraperAPI returning bytes for TARGET_ERROR while the others did not.
		const hasBody = result.body !== undefined;
		if (carriesBody(result.outcome) && !hasBody && result.outcome === 'OK')
			fail('parse', `${category}: ${result.outcome} must carry the body`);
		if (!carriesBody(result.outcome) && hasBody)
			fail('parse', `${category}: ${result.outcome} must NOT carry a body, per carriesBody()`);

		// Never a float for money, and never a negative.
		if (!Number.isInteger(result.cost.microcredits) || result.cost.microcredits < 0)
			fail('parse', `${category}: cost.microcredits must be a non-negative integer`);

		if (result.upstreamStatusCode !== undefined) {
			const u = result.upstreamStatusCode;
			if (!Number.isInteger(u) || u < 100 || u > 599)
				fail('parse', `${category}: upstreamStatusCode ${u} is not an HTTP status`);
		}
	}

	return { failures, checks };
}

export async function conform(
	only?: string,
): Promise<{ failures: Failure[]; checks: number; adapters: string[] }> {
	const ids = Object.keys(REGISTRY).sort();
	const targets = only === undefined ? ids : ids.filter((i) => i === only.replace(/-/g, '_'));
	const results = await Promise.all(targets.map((id) => conformOne(id)));
	return {
		failures: results.flatMap((r) => r.failures),
		checks: results.reduce((n, r) => n + r.checks, 0),
		adapters: targets,
	};
}
