// The chain, against a fake transport. The network boundary is the ONLY thing faked, which
// is the rule integrations.md section 6 sets — and here the fake is the point: these tests
// are about what the chain decides, not about what a provider said.

import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ProviderCapabilities,
} from '@proxlane/adapters';
import { CAPABILITIES } from '@proxlane/adapters';
import { describe, expect, it } from 'vitest';
import { hopBudget, MIN_USEFUL_ATTEMPT_MS } from './budget.js';
import { isCapable, runChain } from './chain.js';
import type { HttpTransport, TransportResult } from './transport.js';

function caps(over: Partial<ProviderCapabilities> & { id: string }): ProviderCapabilities {
	return {
		line: 1,
		renderJs: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none']),
		sessions: false,
		post: false,
		binary: false,
		maxTimeoutMs: 70_000,
		fastTimeoutMs: 22_000,
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
		...over,
	};
}

/** An adapter whose parse() returns whatever the test says, so the chain is what is tested. */
function adapterOf(
	id: string,
	outcome: Outcome,
	over: Partial<ProviderCapabilities> = {},
): Adapter {
	return {
		capabilities: caps({ id, ...over }),
		translate: (req) => ({
			url: `https://api.${id}.test/?u=${encodeURIComponent(req.url)}`,
			method: 'GET',
			headers: {},
			timeoutMs: 70_000,
		}),
		parse: () => ({ outcome, cost: { microcredits: 0, source: 'estimated' } }),
	};
}

function transportOf(
	results: TransportResult[],
): HttpTransport & { budgets: number[]; served: string[] } {
	const budgets: number[] = [];
	const served: string[] = [];
	let i = 0;
	return {
		budgets,
		served,
		async execute(_req, opts) {
			budgets.push(opts.budgetMs);
			served.push(_req.url);
			return results[Math.min(i++, results.length - 1)] as TransportResult;
		},
	};
}

const okResponse: TransportResult = {
	kind: 'response',
	response: { status: 200, headers: {}, body: new Uint8Array() },
	latencyMs: 10,
};

const req = (over: Partial<GatewayRequest> = {}): GatewayRequest => ({
	url: 'https://example.com/',
	method: 'GET',
	renderJs: false,
	premium: 'none',
	deadlineMs: 90_000,
	...over,
});

describe('the default deadline lets the terminal hop reach its cap', () => {
	// WHY THE DEFAULT IS 120s AND NOT 90s, pinned as arithmetic rather than left in prose.
	//
	// `operations.md` recorded the move to 120s, explained it, and called 90s "the old default".
	// The gateway shipped 90 for months anyway, because a decision written down and a decision
	// implemented look identical from inside a document. This is the number that made it matter.
	//
	// Walk a real three-provider chain. `hopBudget` reserves MIN_USEFUL_ATTEMPT_MS for every hop
	// still to come, so the terminal hop never simply gets the remainder.
	const walk = (deadlineMs: number, caps: readonly number[]): number[] => {
		let spent = 0;
		return caps.map((cap, i) => {
			const b = hopBudget(deadlineMs - spent, caps.length - i, cap);
			const got = b.kind === 'attempt' ? b.perAttemptMs : 0;
			spent += got;
			return got;
		});
	};
	// ScraperAPI, ScrapingBee, Scrapfly: fast caps 22s and 22s, terminal cap 70s.
	const CHAIN = [22_000, 22_000, 70_000] as const;

	it('gave the terminal hop barely half its cap at the old 90s default', () => {
		const [, , terminal] = walk(90_000, CHAIN);
		expect(terminal).toBe(38_000);
		// The hop that exists to rescue a failing request was the one being cut short.
		expect(terminal).toBeLessThan(70_000 * 0.6);
	});

	it('gives it nearly all of it at the shipped 120s', () => {
		const [, , terminal] = walk(120_000, CHAIN);
		expect(terminal).toBe(68_000);
		expect(terminal).toBeGreaterThan(70_000 * 0.95);
	});

	it('still fits three real attempts, which is what N=3 claims', () => {
		// A chain that does not fit its own advertised attempt count is the README's
		// three-provider reliability claim being untrue rather than optimistic.
		const hops = walk(120_000, CHAIN);
		expect(hops.every((h) => h >= 8_000)).toBe(true);
		expect(hops.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120_000);
	});
});

describe('the budget arithmetic that makes three attempts possible', () => {
	it('reserves time for the hops behind it, instead of min(cap, remaining)', () => {
		// integrations.md section 5: min(cap, remaining) gives attempt 1 seventy-five of
		// ninety seconds and leaves the chain at roughly 1.5 attempts, on exactly the failure
		// it exists for.
		const b = hopBudget(90_000, 2, 22_000);
		expect(b.kind).toBe('attempt');
		if (b.kind === 'attempt') expect(b.perAttemptMs).toBe(22_000);
	});

	it('never returns more than the provider cap', () => {
		const b = hopBudget(90_000, 0, 22_000);
		if (b.kind === 'attempt') expect(b.perAttemptMs).toBe(22_000);
	});

	it('still gives the floor when the reserve would eat everything', () => {
		// Without the lower clamp this returns a negative budget and the chain cannot finish.
		const b = hopBudget(20_000, 5, 70_000);
		expect(b.kind).toBe('attempt');
		if (b.kind === 'attempt') expect(b.perAttemptMs).toBe(MIN_USEFUL_ATTEMPT_MS);
	});

	it('refuses rather than opening a connection that cannot finish', () => {
		const b = hopBudget(MIN_USEFUL_ATTEMPT_MS - 1, 0, 70_000);
		expect(b.kind).toBe('exhausted');
	});
});

describe('capability filtering happens before anyone is charged', () => {
	it('excludes a provider that cannot render JS', () => {
		expect(isCapable(caps({ id: 'a', renderJs: false }), req({ renderJs: true }))).toBe(false);
		expect(isCapable(caps({ id: 'a', renderJs: true }), req({ renderJs: true }))).toBe(true);
	});

	it('excludes a combination the provider sells only separately', () => {
		// THE CHECK THAT READS TWO FIELDS AT ONCE. Everything else here asks "does this provider
		// do X"; this asks "does it do X AND Y together". ScraperAPI sells sessions and it sells
		// premium proxies, and its docs say `session_number` "Can not be combined with
		// premium/ultra_premium" — so the router used to send exactly that and let the provider
		// decide which half to drop.
		const withConflict = caps({
			id: 'a',
			sessions: true,
			// The default fixture sells `none` only, and the tier check runs BEFORE conflicts — so
			// without this the provider is excluded for the ordinary reason and the conjunction is
			// never reached. The test would pass for the wrong reason.
			premiumTiers: new Set(['none', 'residential']),
			conflicts: [
				{ sessions: true, premium: ['residential'], why: 'https://example.test/docs' },
			],
		});
		// Each half alone is still served, which is the point of a conjunction.
		expect(isCapable(withConflict, req({ sessionId: 's' })), 'session alone').toBe(true);
		expect(isCapable(withConflict, req({ premium: 'residential' })), 'premium alone').toBe(
			true,
		);
		// Together, it is not.
		expect(
			isCapable(withConflict, req({ sessionId: 's', premium: 'residential' })),
			'both together',
		).toBe(false);
	});

	it('declares no conflict that is really a ban', () => {
		// A CONFLICT IS A CONJUNCTION, and this is what separates the two. If dropping any single
		// named condition still excludes the provider, the conflict was not about the combination
		// — it was banning one feature outright, which `premiumTiers`/`sessions` already express
		// and which silently removes the provider from chains it could serve.
		//
		// Caught by mutation: a conflict written `sessions: false` skips the session check
		// entirely and degrades to "never serves residential". The type forbids it, this covers
		// the case where somebody defeats the type.
		let checked = 0;
		for (const c of CAPABILITIES) {
			for (const k of c.conflicts ?? []) {
				const base = { url: 'https://x.test/', method: 'GET' as const, renderJs: false };
				// The request that the conflict is about: every condition satisfied.
				const both = {
					...base,
					premium: (k.premium?.[0] ?? 'none') as never,
					...(k.sessions === true ? { sessionId: 's' } : {}),
					...(k.renderJs !== undefined ? { renderJs: k.renderJs } : {}),
					...(k.binary === true ? { binary: true } : {}),
					...(k.method !== undefined ? { method: k.method } : {}),
				};
				expect(isCapable(c, both as never), `${c.id}: the conflict does not apply`).toBe(false);

				// Now drop the session half. The provider must still serve it, or this was a ban.
				if (k.sessions === true && k.premium !== undefined) {
					const premiumOnly = { ...both, sessionId: undefined };
					expect(
						isCapable(c, premiumOnly as never),
						`${c.id}: excluded on ${k.premium[0]} alone — that is a ban, not a conflict`,
					).toBe(true);
					const sessionOnly = { ...both, premium: 'none' as never };
					expect(
						isCapable(c, sessionOnly as never),
						`${c.id}: excluded on a session alone — that is a ban, not a conflict`,
					).toBe(true);
					checked += 1;
				}
			}
		}
		expect(checked, 'no real conflict to check').toBeGreaterThan(0);
	});

	it('leaves a provider with no conflicts alone', () => {
		// `conflicts` is optional and absent on three of four adapters. An undefined list must
		// not exclude anything, or the field becomes a way to silently empty every chain.
		expect(isCapable(caps({ id: 'a', sessions: true }), req({ sessionId: 's' }))).toBe(true);
	});

	it('excludes on tier, POST, sessions and country', () => {
		expect(isCapable(caps({ id: 'a' }), req({ premium: 'stealth' }))).toBe(false);
		expect(isCapable(caps({ id: 'a', post: false }), req({ method: 'POST' }))).toBe(false);
		expect(isCapable(caps({ id: 'a', sessions: false }), req({ sessionId: 's' }))).toBe(false);
		expect(
			isCapable(caps({ id: 'a', countryCodes: new Set(['de']) }), req({ countryCode: 'US' })),
		).toBe(false);
		expect(
			isCapable(caps({ id: 'a', countryCodes: new Set(['us']) }), req({ countryCode: 'US' })),
		).toBe(true);
	});
});

describe('NO_PROVIDER_AVAILABLE, which only the chain can produce', () => {
	it('fires when nothing is configured', async () => {
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.attempts).toHaveLength(0);
	});

	it('fires when a provider exists but cannot do what was asked', async () => {
		const r = await runChain(req({ renderJs: true }), {
			transport: transportOf([okResponse]),
			candidates: [{ adapter: adapterOf('a', 'OK', { renderJs: false }), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.reason).toMatch(/capabilities/);
		// Nothing was attempted, so nothing was spent.
		expect(r.attempts).toHaveLength(0);
	});
});

describe('BUDGET_EXCEEDED, which only the chain can produce', () => {
	it('fires instead of opening an attempt that cannot succeed', async () => {
		const r = await runChain(req({ deadlineMs: 1_000 }), {
			transport: transportOf([okResponse]),
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('BUDGET_EXCEEDED');
		expect(r.attempts).toHaveLength(0);
	});

	it('reports the budget, not the previous provider failure', async () => {
		// Reporting the last outcome would hide a tuning problem as a provider problem and
		// send someone debugging the wrong system.
		// An explicit clock, not arithmetic that happens to advance. Each read moves 25s, so
		// hop 1 gets its 22s budget and times out, and hop 2 finds only 5s left — under the
		// 8s floor.
		let elapsed = 0;
		const clock = () => {
			const at = elapsed;
			elapsed += 25_000;
			return at;
		};
		const r = await runChain(req({ deadlineMs: 30_000 }), {
			transport: transportOf([{ kind: 'timeout', afterMs: 22_000 }]),
			candidates: [
				{ adapter: adapterOf('a', 'OK'), key: 'k' },
				{ adapter: adapterOf('b', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000,
			now: clock,
		});
		expect(r.outcome).toBe('BUDGET_EXCEEDED');
	});
});

describe('the failover walk follows FAILOVER, never its own opinion', () => {
	it('does not retry an outcome marked failover:false, even with hops to spare', async () => {
		// A real 404 is a real 404 at the next provider, and ScraperAPI charges for one.
		const transport = transportOf([okResponse]);
		const r = await runChain(req(), {
			transport,
			candidates: [
				{ adapter: adapterOf('a', 'TARGET_NOT_FOUND'), key: 'k' },
				{ adapter: adapterOf('b', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('TARGET_NOT_FOUND');
		expect(r.attempts).toHaveLength(1);
		expect(transport.budgets).toHaveLength(1);
	});

	it('fails over on an outcome marked failover:true and returns the later success', async () => {
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [
				{ adapter: adapterOf('a', 'HARD_BLOCK'), key: 'k' },
				{ adapter: adapterOf('b', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('b');
		expect(r.attempts.map((a) => a.outcome)).toEqual(['HARD_BLOCK', 'OK']);
	});

	it('honours failover:once — a second TARGET_ERROR stops the chain', async () => {
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [
				{ adapter: adapterOf('a', 'TARGET_ERROR'), key: 'k' },
				{ adapter: adapterOf('b', 'TARGET_ERROR'), key: 'k' },
				{ adapter: adapterOf('c', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.attempts).toHaveLength(2);
	});

	it('gives the terminal hop maxTimeoutMs and the others fastTimeoutMs', async () => {
		const transport = transportOf([{ kind: 'timeout', afterMs: 100 }]);
		await runChain(req(), {
			transport,
			candidates: [
				{ adapter: adapterOf('a', 'OK'), key: 'k' },
				{ adapter: adapterOf('b', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000,
		});
		expect(transport.budgets[0]).toBe(22_000);
		expect(transport.budgets[1]).toBe(70_000);
	});
});

describe('transport failures become outcomes no adapter can produce', () => {
	it('maps a deadline to PROVIDER_TIMEOUT', async () => {
		const r = await runChain(req(), {
			transport: transportOf([{ kind: 'timeout', afterMs: 22_000 }]),
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('PROVIDER_TIMEOUT');
	});

	it('maps an oversized body to RESPONSE_TOO_LARGE', async () => {
		const r = await runChain(req(), {
			transport: transportOf([{ kind: 'too-large', cap: 10 }]),
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 10,
		});
		expect(r.outcome).toBe('RESPONSE_TOO_LARGE');
	});

	it('maps a transport error to PROVIDER_ERROR, never to a parsed outcome', async () => {
		// Nothing was said, so there is nothing to parse. Calling parse() on a non-response is
		// how a fabricated outcome enters the chain.
		const r = await runChain(req(), {
			transport: transportOf([{ kind: 'error', message: 'ECONNRESET' }]),
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('PROVIDER_ERROR');
	});
});

describe('SOFT_BLOCK, which only the chain can assign', () => {
	const blockPage = new TextEncoder().encode(
		'<html><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>',
	);
	const withBody = (body: Uint8Array): Adapter => ({
		capabilities: caps({ id: 'a' }),
		translate: (r) => ({
			url: `https://api.a.test/?u=${encodeURIComponent(r.url)}`,
			method: 'GET',
			headers: {},
			timeoutMs: 70_000,
		}),
		parse: () => ({
			outcome: 'OK',
			body,
			contentType: 'text/html; charset=utf-8',
			charset: 'utf-8',
			cost: { microcredits: 0, source: 'estimated' },
		}),
	});

	it('turns an adapter OK into SOFT_BLOCK when a rule fires', async () => {
		// The adapter said OK and meant it — the provider fetched something and returned 200.
		// Only looking at the bytes reveals it is a challenge, which is why parse() can never
		// produce this outcome and the chain must.
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [{ adapter: withBody(blockPage), key: 'k' }],
			maxBodyBytes: 1_000_000,
		});
		expect(r.outcome).toBe('SOFT_BLOCK');
		expect(r.detectRuleId).toBe('cloudflare-challenge');
	});

	it('fails over on it, because another provider may not be blocked', async () => {
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [
				{ adapter: withBody(blockPage), key: 'k' },
				{ adapter: adapterOf('b', 'OK'), key: 'k' },
			],
			maxBodyBytes: 1_000_000,
		});
		expect(r.outcome).toBe('OK');
		expect(r.attempts.map((a) => a.outcome)).toEqual(['SOFT_BLOCK', 'OK']);
		expect(r.attempts[0]?.detectRuleId).toBe('cloudflare-challenge');
	});

	it('leaves a real page alone', async () => {
		const page = new TextEncoder().encode('<html><body><h1>Moby-Dick</h1></body></html>');
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [{ adapter: withBody(page), key: 'k' }],
			maxBodyBytes: 1_000_000,
		});
		expect(r.outcome).toBe('OK');
		expect(r.detectRuleId).toBeUndefined();
	});

	it('does not re-label a non-OK outcome, whatever the body holds', async () => {
		// A 404 whose body happens to carry a vendor token is still a 404. Re-labelling it
		// SOFT_BLOCK would make it fail over — and TARGET_NOT_FOUND exists precisely because
		// retrying a real 404 spends money to reach the same answer.
		const notFound: Adapter = {
			...withBody(blockPage),
			parse: () => ({
				outcome: 'TARGET_NOT_FOUND',
				body: blockPage,
				contentType: 'text/html',
				cost: { microcredits: 0, source: 'estimated' },
			}),
		};
		const r = await runChain(req(), {
			transport: transportOf([okResponse]),
			candidates: [{ adapter: notFound, key: 'k' }],
			maxBodyBytes: 1_000_000,
		});
		expect(r.outcome).toBe('TARGET_NOT_FOUND');
		expect(r.attempts).toHaveLength(1);
	});
});

describe('the URL that was judged is the URL that gets sent', () => {
	it("forwards the guard-normalised URL, not the caller's raw string", async () => {
		// A live bypass before this. `\\` is an authority terminator to WHATWG, so the guard
		// read the host as example.com and allowed it — while Python's urllib, which most
		// provider backends run, reads the host as the metadata address. Validating one
		// string and sending another is the whole class of bug.
		const transport = transportOf([okResponse]);
		await runChain(req({ url: 'http://example.com\\@169.254.169.254/' }), {
			transport,
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		const sent = transport.served[0] as string;
		expect(sent).toContain(encodeURIComponent('http://example.com/@169.254.169.254/'));
		expect(sent).not.toContain('%5C');
	});

	it('normalises a host the guard allowed, so downstream cannot re-read it', async () => {
		const transport = transportOf([okResponse]);
		await runChain(req({ url: 'https://EXAMPLE.com/A' }), {
			transport,
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(transport.served[0]).toContain(encodeURIComponent('https://example.com/A'));
	});
});

describe('the edge decides before any provider is chosen', () => {
	it('refuses a private target without opening a connection', async () => {
		const transport = transportOf([okResponse]);
		const r = await runChain(req({ url: 'http://169.254.169.254/' }), {
			transport,
			candidates: [{ adapter: adapterOf('a', 'OK'), key: 'k' }],
			maxBodyBytes: 1_000,
		});
		expect(r.outcome).toBe('TARGET_FORBIDDEN');
		// Not merely the right outcome: the URL never reached a provider's logs either.
		expect(transport.budgets).toHaveLength(0);
	});
});
