// Hosted auth: which candidates a token yields, and the order its refusals are checked in.

import type { Adapter } from '@proxlane/adapters';
import {
	generateTokenKeypair,
	loadTokenKeyring,
	sealToken,
	type TokenKeyring,
} from '@proxlane/shared/token';
import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit.js';
import { candidatesFor, resolveTenant, spendAuthFailures, type Tenancy } from './tenant.js';

const adapter = (id: string) => ({ capabilities: { id } }) as unknown as Adapter;
const ADAPTERS = new Map(
	['scraperapi', 'scrapfly', 'scrapingbee'].map((id) => [id, adapter(id)]),
);
const ORDER = ['scraperapi', 'scrapfly', 'scrapingbee'];
const ids = (cs: readonly { adapter: Adapter }[]) => cs.map((c) => c.adapter.capabilities.id);

let publicKey: string;
let keyring: TokenKeyring;
beforeAll(async () => {
	const pair = await generateTokenKeypair();
	publicKey = pair.publicKey;
	keyring = await loadTokenKeyring([pair.secretKey]);
});

function tenancy(over: Partial<Tenancy> = {}): Tenancy {
	return {
		keyring,
		adapters: ADAPTERS,
		order: ORDER,
		denied: new Set(),
		addressLimit: new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
		credentialLimit: new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
		authFailures: new InMemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
		...over,
	};
}

describe('the candidates a token yields', () => {
	const payload = (order?: string[]) => ({
		keys: { scrapingbee: 'b', scraperapi: 'a', 'not-shipped': 'x' },
		...(order === undefined ? {} : { order }),
		issuedAt: 1,
	});
	const credentials = { scrapingbee: 'hb', scraperapi: 'ha', 'not-shipped': 'hx' };

	it('follows the gateway order when the token has none, and only for keys it holds', () => {
		expect(
			ids(candidatesFor(payload(), credentials, { adapters: ADAPTERS, order: ORDER })),
		).toEqual(['scraperapi', 'scrapingbee']);
	});

	it('puts the token order first, then the rest in the gateway order', () => {
		const cs = candidatesFor(payload(['scrapingbee']), credentials, {
			adapters: ADAPTERS,
			order: ORDER,
		});
		expect(ids(cs)).toEqual(['scrapingbee', 'scraperapi']);
	});

	it('drops a provider this gateway does not ship, rather than refusing a newer page', () => {
		const cs = candidatesFor(payload(), credentials, { adapters: ADAPTERS, order: ORDER });
		expect(ids(cs)).not.toContain('not-shipped');
	});

	it('bills each key to its own prefixed account, never `self` or an operator org', () => {
		const cs = candidatesFor(payload(), credentials, { adapters: ADAPTERS, order: ORDER });
		expect(cs.map((c) => [c.key, c.account])).toEqual([
			['a', 't.ha'],
			['b', 't.hb'],
		]);
	});
});

describe('refusals, in the order that keeps them cheap', () => {
	const NOW = Date.UTC(2026, 9, 30);

	it('limits by address BEFORE opening, so garbage cannot buy a decrypt', async () => {
		let opened = 0;
		const counting: TokenKeyring = {
			...keyring,
			open: (t, n) => {
				opened++;
				return keyring.open(t, n);
			},
		};
		const t = tenancy({
			keyring: counting,
			addressLimit: new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 }),
		});
		await resolveTenant('pxl1_garbage', '203.0.113.7', t, NOW);
		const second = await resolveTenant('pxl1_garbage', '203.0.113.7', t, NOW);
		expect(second).toMatchObject({ ok: false, status: 429, why: 'address-limit' });
		expect(opened).toBe(1);
	});

	it('refuses a denied token by id, and still names it for the log', async () => {
		const token = await sealToken({ keys: { scraperapi: 'a' } }, publicKey, NOW);
		const first = await resolveTenant(token, 'a', tenancy(), NOW);
		if (!first.ok) throw new Error('did not resolve');
		const denied = await resolveTenant(
			token,
			'a',
			tenancy({ denied: new Set([first.id]) }),
			NOW,
		);
		expect(denied).toMatchObject({ ok: false, status: 401, why: 'denied', id: first.id });
	});

	it('limits per provider key, so resealing the same key for a fresh token buys nothing', async () => {
		const t = tenancy({
			credentialLimit: new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 }),
		});
		const a = await sealToken({ keys: { scraperapi: 'real' } }, publicKey, NOW);
		const b = await sealToken(
			{ keys: { scraperapi: 'real', scrapfly: 'junk' } },
			publicKey,
			NOW,
		);
		expect((await resolveTenant(a, 'x', t, NOW)).ok).toBe(true);
		const again = await resolveTenant(b, 'y', t, NOW);
		expect(again).toMatchObject({ ok: false, status: 429, why: 'key-limit' });
		expect(again.ok === false && again.retryAfterMs).toBeGreaterThan(0);
	});

	it('budgets AUTH_FAILED per address, so junk keys cannot turn the gateway into an oracle', async () => {
		// Fresh random keys evade the per-key limit by construction. What they cannot evade is
		// failing, and failures are what this spends.
		const authFailures = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
		const t = tenancy({ authFailures });
		const junk = await sealToken(
			{ keys: { scraperapi: 'junk1', scrapfly: 'junk2' } },
			publicKey,
			NOW,
		);
		expect((await resolveTenant(junk, '203.0.113.7', t, NOW)).ok).toBe(true);
		await spendAuthFailures(
			'scraperapi:AUTH_FAILED>scrapfly:AUTH_FAILED>scrapingbee:OK',
			'203.0.113.7',
			t,
			NOW,
		);
		await spendAuthFailures('scraperapi:AUTH_FAILED', '203.0.113.7', t, NOW);
		expect(await resolveTenant(junk, '203.0.113.7', t, NOW)).toMatchObject({
			ok: false,
			status: 429,
			why: 'auth-failures',
		});
		// Another address is untouched, and a chain with no refusal spends nothing.
		expect((await resolveTenant(junk, '198.51.100.1', t, NOW)).ok).toBe(true);
		await spendAuthFailures('scraperapi:OK', '198.51.100.1', t, NOW);
		expect(await authFailures.peek('198.51.100.1', NOW)).toBe(0);
	});

	it('says what to do for each way a token fails to open, without echoing it', async () => {
		const r = await resolveTenant(`pxl1_00000000_${'A'.repeat(120)}`, 'a', tenancy(), NOW);
		expect(r).toMatchObject({
			ok: false,
			status: 401,
			code: 'UNAUTHORIZED',
			why: 'unknown-key',
		});
		expect(r.ok === false && r.message).toContain('connect page');
		expect(r.ok === false && r.message).not.toContain('pxl1_');
	});
});
