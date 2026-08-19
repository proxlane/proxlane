// Cooldowns as the router consumes them.
//
// The semantics are proved in `packages/shared/src/cooldown.unit.test.ts`. This is the part
// where a correct state machine still produces wrong routing: which provider was skipped,
// whether the deadline was divided among providers that were never going to be tried, and
// what the caller is told when everything is cooling.

import type { Adapter, Outcome, ProviderCapabilities } from '@proxlane/adapters';
import { COOLDOWN, cooldownKey } from '@proxlane/shared';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';
import type { HttpTransport } from './transport.js';

function caps(id: string): ProviderCapabilities {
	return {
		line: 1,
		id,
		renderJs: true,
		post: true,
		sessions: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none', 'residential', 'stealth']),
		fastTimeoutMs: 22_000,
		maxTimeoutMs: 75_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			unit: 'provider-credits',
			base: 1,
			multipliers: {},
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

const blkKey = (provider: string, domain = DOMAIN) =>
	cooldownKey('blk', { provider, domain, org: 'self' }) as string;

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
	it('says so, with the moment it stops being true', async () => {
		// No floor here, and that is the difference from health: a demoted provider is a guess
		// about a trend, while a cooldown is a fact — each of these refused THIS domain minutes
		// ago. Forcing one buys a probable second refusal at full price.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blkKey('a'), Date.now());
		cd.arm(blkKey('b'), Date.now());
		const r = await chain(cd, [
			['a', 'OK'],
			['b', 'OK'],
		]);
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.attempts).toHaveLength(0);
		expect(r.reason).toContain(DOMAIN);
		expect(r.retryAfterMs).toBeGreaterThan(0);
	});

	it('never advertises a wait longer than the cap', async () => {
		const cd = new InMemoryCooldownStore(() => 0.999999);
		cd.arm(blkKey('a'), Date.now());
		const r = await chain(cd, [['a', 'OK']]);
		expect(r.retryAfterMs).toBeLessThanOrEqual(COOLDOWN.CAP_MS);
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
			cd.peek(cooldownKey('acct', { provider: 'a', domain: DOMAIN, org: 'self' }) as string),
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
