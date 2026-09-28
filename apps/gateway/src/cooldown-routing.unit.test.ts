// Cooldowns as the router consumes them.
//
// The semantics are proved in `packages/shared/src/cooldown.unit.test.ts`. This is the part
// where a correct state machine still produces wrong routing: which provider was skipped,
// whether the deadline was divided among providers that were never going to be tried, and
// what the caller is told when everything is cooling.

import type { Adapter, Outcome, ProviderCapabilities } from '@proxlane/adapters';
import { COOLDOWN, cooldownKey, forcedProbeKey } from '@proxlane/shared';
import type { HttpTransport } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';

function caps(id: string): ProviderCapabilities {
	return {
		line: 1,
		id,
		renderJs: true,
		waitForSelector: true,
		post: true,
		binary: false,
		sessions: true,
		targetStatus: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none', 'residential', 'stealth']),
		fastTimeoutMs: 22_000,
		maxTimeoutMs: 75_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			unit: 'provider-credits',
			matrix: {
				none: { plain: 1, rendered: 1 },
				residential: { plain: 1, rendered: 1 },
				stealth: { plain: 1, rendered: 1 },
			},
		},
	};
}

function adapterFor(id: string, outcome: Outcome): Adapter {
	return {
		capabilities: caps(id),
		translate: () => ({
			url: `https://${id}.test/`,
			method: 'GET',
			headers: {},
			timeoutMs: 1000,
		}),
		parse: () => ({
			outcome,
			cost: { microcredits: 0, source: 'estimated' },
			...(outcome === 'OK'
				? { body: new TextEncoder().encode('<html>ok</html>'), contentType: 'text/html' }
				: {}),
		}),
	} as Adapter;
}

const transport: HttpTransport = {
	execute: () =>
		Promise.resolve({
			kind: 'response' as const,
			latencyMs: 5,
			response: { status: 200, headers: {}, body: new Uint8Array() },
		}),
};

const URL_A = 'https://target.example/page';
const DOMAIN = 'target.example';
const REQ = {
	url: URL_A,
	method: 'GET' as const,
	renderJs: false,
	premium: 'none' as const,
	deadlineMs: 90_000,
};

const blkKey = (provider: string, domain = DOMAIN, premium = 'none') =>
	cooldownKey('blk', { provider, domain, org: 'self', premium }) as string;

function chain(
	cooldowns: CooldownStore | undefined,
	specs: [string, Outcome][],
	over: Partial<Parameters<typeof runChain>[1]> = {},
) {
	return runChain(REQ, {
		transport,
		candidates: specs.map(([id, o]) => ({ adapter: adapterFor(id, o), key: 'k' })),
		maxBodyBytes: 1024 * 1024,
		...(cooldowns === undefined ? {} : { cooldowns }),
		...over,
	});
}

describe('a cooled provider is skipped', () => {
	it('goes to the next provider instead', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		const r = await chain(cd, [
			['a', 'OK'],
			['b', 'OK'],
		]);
		expect(r.provider).toBe('b');
		expect(r.attempts.map((x) => x.provider)).not.toContain('a');
	});

	it('does not reserve deadline for providers it will never try', async () => {
		// hopBudget divides the remaining deadline by the hops still to come. Skipping inside
		// the loop rather than before it would hand every real attempt less budget than it
		// should have — silently, showing up only as more timeouts, on a gateway whose entire
		// promise is failover.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		cd.arm(blkKey('b'), Date.now());
		const r = await chain(cd, [
			['a', 'OK'],
			['b', 'OK'],
			['c', 'OK'],
		]);
		const only = r.attempts[0];
		expect(r.attempts).toHaveLength(1);
		expect(only?.provider).toBe('c');
		// Sole attemptable hop, so it is the terminal one and gets maxTimeoutMs, not the 22s
		// fast budget it would get if two dead hops were still counted behind it.
		expect(only?.budgetMs).toBeGreaterThan(22_000);
	});

	it('cools only the domain that was blocked', async () => {
		// A block is a property of the domain. Cooling a provider globally on one blocked site
		// would take it out for every other site the moment one target got strict.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		const other = await runChain(
			{ ...REQ, url: 'https://elsewhere.example/x' },
			{
				transport,
				candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
				maxBodyBytes: 1024,
				cooldowns: cd,
			},
		);
		expect(other.provider).toBe('a');
	});
});

describe('when everything is cooling', () => {
	// THE PREMISE HERE WAS REVERSED, deliberately, and the old reasoning is worth keeping
	// because it was right at the time: "a demoted provider is a guess about a trend, while a
	// cooldown is a fact — each of these refused THIS domain minutes ago, so forcing one buys a
	// probable second refusal at full price."
	//
	// That holds at a flat fifteen-minute cap. It stops holding once a settled pair backs off
	// to six hours, because "minutes ago" becomes "this morning" and refusing for the length of
	// the backoff takes the domain off the air for the working day. So: one forced attempt,
	// rate-limited per DOMAIN, and everyone else still gets the honest refusal.
	it('forces ONE attempt rather than taking the domain off the air', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		cd.arm(blkKey('b'), Date.now());
		const r = await chain(cd, [
			['a', 'OK'],
			['b', 'OK'],
		]);
		expect(r.outcome).toBe('OK');
		// ONE attempt, and it REACHED a provider. Asserting the outcome alone would have passed
		// while the chain was empty and the request failed anyway — which is exactly what the
		// first version of this did, with the forced slot already claimed and armed.
		expect(r.attempts).toHaveLength(1);
		expect(r.provider).toBeDefined();
	});

	it('says WHY that provider was used, rather than reporting it as healthy', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		const r = await chain(cd, [['a', 'OK']]);
		// `healthy` would be a true fact that explains nothing: this provider refused the domain
		// an hour ago and is being tried anyway.
		expect(r.providerHealth).toBe('cooling-forced');
	});

	it('lets exactly one request through — the rest still get the refusal', async () => {
		// THE HERD. A hundred concurrent requests at an all-cooling domain must not all force.
		// The claim is the same atomic single-slot primitive the half-open probe uses.
		// The forced probe must still be BLOCKED, which is the realistic case and the only one
		// where the herd matters. A forced probe that succeeds clears the cooldown outright —
		// the block lifted, so every later request is served normally and there is no herd to
		// prevent. Asserting against an `OK` adapter tested the happy path by accident.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		const first = await chain(cd, [['a', 'HARD_BLOCK']]);
		const second = await chain(cd, [['a', 'HARD_BLOCK']]);
		expect(first.attempts).toHaveLength(1);
		expect(second.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(second.attempts).toHaveLength(0);
		expect(second.reason).toContain(DOMAIN);
	});

	it('keeps the forced slot flat even after many forced cycles', async () => {
		// THE FLOOR MUST NOT BACK ITSELF OFF. If the forced key were armed with the ordinary
		// growing `arm`, it would climb towards MAX_CAP_MS exactly like a provider key — so a
		// domain that stayed fully blocked would get its forced probe once every six hours
		// instead of four times an hour, quietly undoing the floor in the one case it exists
		// for. `armFor` ignores `consecutive` and clamps.
		//
		// Asserted THROUGH THE CHAIN, not on the helper. A unit test of `armFor` passes whether
		// or not the chain calls it, which is exactly what happened: reverting this line left
		// every other test green.
		const cd = new InMemoryCooldownStore(() => 0.9);
		const fkey = forcedProbeKey(DOMAIN);
		// Drive the forced key to a high `consecutive` while leaving it EXPIRED, so the next
		// claim succeeds and the chain re-arms it. Built through the public API rather than by
		// reaching into the store.
		for (let i = 0; i < 30; i++) cd.arm(fkey, Date.now() - 10_000_000);
		expect(cd.peek(fkey)?.consecutive).toBeGreaterThan(COOLDOWN.GROW_AFTER);

		cd.arm(blkKey('a'), Date.now());
		const before = Date.now();
		await chain(cd, [['a', 'HARD_BLOCK']]);

		// A few seconds of slack for wall-clock drift between `before` and the chain's own
		// `now()` — the regression this catches is six HOURS against fifteen minutes, so the
		// tolerance is four orders of magnitude below the signal.
		const held = (cd.peek(fkey)?.untilMs ?? 0) - before;
		expect(held).toBeLessThanOrEqual(COOLDOWN.CAP_MS + 5_000);
		expect(held).toBeGreaterThan(COOLDOWN.CAP_MS - 5_000);
		// And the failure this guards against is specifically the grown one.
		expect(held).toBeLessThan(COOLDOWN.MAX_CAP_MS);
	});

	it('holds the forced slot for the full window, not a jittered first-arm draw', async () => {
		// A FRESH forced key. `arm` on one that has never been seen draws uniformly from
		// [0, BASE_MS) — about 27 seconds here — where `armFor` gives the flat CAP_MS. Using
		// plain `arm` would therefore free the slot in half a minute and let a fully-blocked
		// domain be re-forced ~100x a day, which is the cost this whole change is about.
		//
		// The earlier version of this test seeded a high `consecutive` and an expired entry, so
		// both paths took the probe branch and returned CAP_MS — it passed with `armFor` swapped
		// for `arm`, i.e. it was decoration for exactly the line it claimed to guard.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		const before = Date.now();
		await chain(cd, [['a', 'HARD_BLOCK']]);
		const held = (cd.peek(forcedProbeKey(DOMAIN))?.untilMs ?? 0) - before;
		expect(held).toBeGreaterThan(COOLDOWN.BASE_MS);
		expect(held).toBeLessThanOrEqual(COOLDOWN.CAP_MS + 5_000);
	});

	it('never advertises a wait longer than the cap, even at a grown backoff', async () => {
		// The provider may be six hours from opening, but a forced probe is available within
		// CAP_MS, so telling the caller to wait six hours would be a worse lie than the one this
		// replaced. `armFor` keeps the forced slot flat, which is what makes this true.
		const cd = new InMemoryCooldownStore(() => 0.999999);
		const key = blkKey('a');
		for (let i = 0; i < 12; i++) cd.arm(key, Date.now());
		const first = await chain(cd, [['a', 'HARD_BLOCK']]);
		expect(first.attempts).toHaveLength(1);
		const second = await chain(cd, [['a', 'HARD_BLOCK']]);
		expect(second.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(second.retryAfterMs).toBeGreaterThan(0);
		expect(second.retryAfterMs).toBeLessThanOrEqual(COOLDOWN.CAP_MS);
	});
});

describe('outcomes arm the right namespace', () => {
	it('cools the domain on a block', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain(cd, [['a', 'HARD_BLOCK']]);
		expect(cd.peek(blkKey('a'))).toBeDefined();
	});

	it('cools the account, NOT the domain, on a rate limit', async () => {
		// The whole reason there are two namespaces. ScraperAPI's 429 is a plan concurrency
		// cap; keying it by domain would let one busy org cool a provider for everyone.
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain(cd, [['a', 'RATE_LIMITED']]);
		expect(cd.peek(blkKey('a'))).toBeUndefined();
		expect(
			cd.peek(
				cooldownKey('acct', {
					provider: 'a',
					domain: DOMAIN,
					org: 'self',
					premium: 'none',
				}) as string,
			),
		).toBeDefined();
	});

	it('cools nothing on a plain target 404', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain(cd, [['a', 'TARGET_NOT_FOUND']]);
		expect(cd.size).toBe(0);
	});

	it('clears the cooldown when a provider succeeds', async () => {
		// What makes a successful probe END a cooldown rather than merely pause it.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now() - COOLDOWN.CAP_MS * 2);
		await chain(cd, [['a', 'OK']]);
		expect(cd.peek(blkKey('a'))).toBeUndefined();
	});
});

describe('the half-open probe, through the chain', () => {
	it('lets one request through after expiry', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now() - COOLDOWN.CAP_MS * 2);
		const r = await chain(cd, [['a', 'OK']]);
		expect(r.provider).toBe('a');
	});

	it('re-arms at the cap when the probe still fails', async () => {
		const before = Date.now();
		const cd = new InMemoryCooldownStore(() => 0.0001);
		cd.arm(blkKey('a'), before - COOLDOWN.CAP_MS * 2);
		await chain(cd, [['a', 'HARD_BLOCK']]);
		const entry = cd.peek(blkKey('a'));
		// The jitter is set to almost zero, so anything near the cap can only come from the
		// failed-probe rule rather than from the backoff curve.
		expect((entry?.untilMs ?? 0) - before).toBeGreaterThan(COOLDOWN.CAP_MS * 0.9);
	});

	it('skips the provider when another request already took the probe', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now() - COOLDOWN.CAP_MS * 2);
		await cd.claim(blkKey('a'), Date.now());
		const r = await chain(cd, [
			['a', 'OK'],
			['b', 'OK'],
		]);
		expect(r.provider).toBe('b');
	});
});

describe('fail open', () => {
	it('routes normally when the cooldown store throws on read', async () => {
		// integrations.md section 3: cooldown lookup fails OPEN. Losing it costs a wasted
		// attempt; refusing the request costs the request.
		const broken: CooldownStore = {
			check: () => Promise.reject(new Error('valkey is gone')),
			claim: () => Promise.reject(new Error('valkey is gone')),
			arm: () => {},
			clear: () => {},
			release: () => {},
			list: () => Promise.resolve([]),
		};
		const r = await chain(broken, [['a', 'OK']]);
		expect(r.outcome).toBe('OK');
	});

	it('does not let a throwing arm() break a request', async () => {
		const broken: CooldownStore = {
			check: (keys) =>
				Promise.resolve(new Map(keys.map((k) => [k, { kind: 'open' as const }]))),
			claim: () => Promise.resolve(true),
			arm: () => {
				throw new Error('write failed');
			},
			clear: () => {},
			release: () => {},
			list: () => Promise.resolve([]),
		};
		await expect(chain(broken, [['a', 'HARD_BLOCK']])).resolves.toMatchObject({
			outcome: 'HARD_BLOCK',
		});
	});

	it('routes exactly as before with no store at all', async () => {
		const r = await chain(undefined, [
			['a', 'OK'],
			['b', 'OK'],
		]);
		expect(r.provider).toBe('a');
	});
});

describe('the in-memory store does not leak', () => {
	it('sweeps entries whose cooldown ended long ago', async () => {
		// Keyed by (provider, domain), so a long-lived gateway with wide traffic accumulates
		// one entry per host it has ever been blocked on and nothing would ever remove them.
		// Valkey gets this free from key TTLs.
		const cd = new InMemoryCooldownStore(() => 0.5);
		for (let i = 0; i < 100; i++) cd.arm(blkKey('a', `host${i}.example`), 0);
		expect(cd.size).toBe(100);
		const removed = cd.sweep(COOLDOWN.CAP_MS + 60 * 60 * 1000 + 1);
		expect(removed).toBe(100);
		expect(cd.size).toBe(0);
	});

	it('keeps entries that are still live', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		cd.sweep(Date.now());
		expect(cd.size).toBe(1);
	});
});

describe('a refusal names the providers the request ruled out, not only the cooling ones', () => {
	// Reported by a caller: the ladder answered "every capable provider is cooling", pinning
	// firecrawl a minute later served the page. Firecrawl was never cooling; the request carried
	// `wait_for`, which firecrawl cannot honour, so it was ruled out before cooldowns were read.
	// "capable" carried the whole distinction and the message never said who it excluded.
	const noWait = (id: string, outcome: Outcome): Adapter => {
		const a = adapterFor(id, outcome);
		return { ...a, capabilities: { ...a.capabilities, waitForSelector: false } };
	};

	it('says who was left out, and why, when every capable provider is cooling', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		// The forced slot is spent, so this request gets the refusal rather than the floor.
		cd.arm(forcedProbeKey(DOMAIN), Date.now(), COOLDOWN.CAP_MS);
		const r = await runChain(
			{ ...REQ, waitFor: '.results' },
			{
				transport,
				candidates: [
					{ adapter: adapterFor('a', 'OK'), key: 'k' },
					{ adapter: noWait('firecrawl', 'OK'), key: 'k' },
				],
				maxBodyBytes: 1024 * 1024,
				cooldowns: cd,
			},
		);
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.reason).toMatch(
			/^every capable provider is cooling: a \(blocked on target\.example\)/,
		);
		expect(r.reason).toMatch(/; not capable of this request: firecrawl \(wait_for\)$/);
	});

	it('says it on an exhausted chain too', async () => {
		const r = await runChain(
			{ ...REQ, waitFor: '.results' },
			{
				transport,
				candidates: [
					{ adapter: adapterFor('a', 'PROVIDER_ERROR'), key: 'k' },
					{ adapter: noWait('firecrawl', 'OK'), key: 'k' },
				],
				maxBodyBytes: 1024 * 1024,
			},
		);
		// After the outcome's own meaning, which was the whole message before.
		expect(r.reason).toBe(
			'Provider 5xx or infrastructure failure; not capable of this request: firecrawl (wait_for)',
		);
	});

	it('adds nothing when every provider was capable', async () => {
		const r = await chain(undefined, [['a', 'PROVIDER_ERROR']]);
		expect(r.reason).toBeUndefined();

describe('a cooldown records what armed it', () => {
	const acctKey = (provider: string) =>
		cooldownKey('acct', { provider, org: 'self', domain: DOMAIN, premium: 'none' }) as string;

	it("keeps the outcome and the provider's words for an account refusal", async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		const suspended: Adapter = {
			...adapterFor('brightdata', 'AUTH_FAILED'),
			parse: () => ({
				outcome: 'AUTH_FAILED',
				providerMessage: 'Account is suspended',
				cost: { microcredits: 0, source: 'estimated' },
			}),
		};
		await runChain(REQ, {
			transport,
			candidates: [{ adapter: suspended, key: 'k' }],
			maxBodyBytes: 1024 * 1024,
			cooldowns: cd,
		});
		expect(cd.peek(acctKey('brightdata'))).toMatchObject({
			reason: 'AUTH_FAILED',
			detail: 'Account is suspended',
		});
	});

	it('keeps the outcome for a domain block, with no words invented', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain(cd, [['a', 'HARD_BLOCK']]);
		const e = cd.peek(blkKey('a'));
		expect(e?.reason).toBe('HARD_BLOCK');
		expect(e).not.toHaveProperty('detail');
	});

	it('drops an old reason on a re-arm that gives none, rather than repeating it as new', () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm('k', 0, undefined, { reason: 'QUOTA_EXHAUSTED' });
		cd.arm('k', 1);
		expect(cd.peek('k')).not.toHaveProperty('reason');
	});
});
