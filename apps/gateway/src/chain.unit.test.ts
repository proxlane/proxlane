// The chain, against a fake transport. The network boundary is the ONLY thing faked, which
// is the rule integrations.md section 6 sets — and here the fake is the point: these tests
// are about what the chain decides, not about what a provider said.

import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ProviderCapabilities,
} from '@proxlane/adapters';
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
		maxTimeoutMs: 70_000,
		fastTimeoutMs: 22_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			base: 1,
			multipliers: {},
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
