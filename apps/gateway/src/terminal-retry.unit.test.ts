// The one place the chain asks the same provider twice.
//
// The rule the rest of the file exists to hold: failover IS the retry, everywhere except the
// end of the chain. These tests are mostly negative — they pin down where the retry does not
// happen, because a retry that leaked into the middle of the chain would spend money asking a
// machine that just failed, while a different provider sat unasked one hop away.

import type {
	Adapter,
	GatewayRequest,
	Outcome,
	ProviderCapabilities,
} from '@proxlane/adapters';
import type { HttpTransport, TransportResult } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';

function caps(id: string, over: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
	return {
		id,
		line: 1,
		renderJs: true,
		waitForSelector: true,
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
				none: { plain: 100, rendered: 100 },
				residential: { plain: 100, rendered: 100 },
				stealth: { plain: 100, rendered: 100 },
			},
		},
		...over,
	};
}

/**
 * An adapter whose parse walks a script, one outcome per call.
 *
 * The last entry repeats, so `['PROVIDER_ERROR']` is a provider that is simply down while
 * `['PROVIDER_ERROR', 'OK']` is one that recovers on the second ask — which is the case the
 * whole feature is for.
 */
function scripted(id: string, script: Outcome[]): Adapter & { calls: number } {
	const a = {
		calls: 0,
		capabilities: caps(id),
		translate: (req: GatewayRequest) => ({
			url: `https://api.${id}.test/?u=${encodeURIComponent(req.url)}`,
			method: 'GET' as const,
			headers: {},
			timeoutMs: 70_000,
		}),
		parse: () => {
			const outcome = script[Math.min(a.calls, script.length - 1)] as Outcome;
			a.calls += 1;
			return { outcome, cost: { microcredits: 100, source: 'estimated' as const } };
		},
	};
	return a;
}

const transport: HttpTransport = {
	async execute(): Promise<TransportResult> {
		return {
			kind: 'response',
			response: { status: 200, headers: {}, body: new Uint8Array() },
			latencyMs: 10,
		};
	},
};

const req = (over: Partial<GatewayRequest> = {}): GatewayRequest => ({
	url: 'https://example.com/',
	method: 'GET',
	renderJs: false,
	premium: 'none',
	deadlineMs: 90_000,
	...over,
});

const run = (
	adapters: Adapter[],
	over: { terminalRetries?: number; deadlineMs?: number } = {},
) =>
	runChain(req(over.deadlineMs === undefined ? {} : { deadlineMs: over.deadlineMs }), {
		transport,
		candidates: adapters.map((adapter) => ({ adapter, key: 'k' })),
		maxBodyBytes: 1024 * 1024,
		...(over.terminalRetries === undefined ? {} : { terminalRetries: over.terminalRetries }),
	});

describe('the terminal retry', () => {
	it('asks the last provider again when it failed to answer', async () => {
		const a = scripted('only', ['PROVIDER_ERROR']);
		const r = await run([a]);
		expect(a.calls).toBe(2);
		expect(r.attempts).toHaveLength(2);
		expect(r.outcome).toBe('PROVIDER_ERROR');
	});

	it('returns the retry’s answer when the second go works', async () => {
		// The case that justifies the feature. Measured against a real provider: a front-door
		// 502 and a `no_free_workers` both cleared immediately on a second ask.
		const a = scripted('only', ['PROVIDER_ERROR', 'OK']);
		const r = await run([a]);
		expect(r.outcome).toBe('OK');
		expect(r.attempts.map((x) => x.outcome)).toEqual(['PROVIDER_ERROR', 'OK']);
	});

	it('keeps the failed attempt on the bill', async () => {
		// A cost estimate that hides a retry is the number this project exists not to print.
		// Both attempts were charged, so both appear.
		const a = scripted('only', ['PROVIDER_ERROR', 'OK']);
		const r = await run([a]);
		const total = r.attempts.reduce((n, x) => n + (x.costMicrocredits ?? 0), 0);
		expect(total).toBe(200);
	});

	it('does nothing at 0', async () => {
		const a = scripted('only', ['PROVIDER_ERROR']);
		const r = await run([a], { terminalRetries: 0 });
		expect(a.calls).toBe(1);
		expect(r.attempts).toHaveLength(1);
	});

	it('obeys a count above one', async () => {
		const a = scripted('only', ['PROVIDER_ERROR']);
		await run([a], { terminalRetries: 3 });
		expect(a.calls).toBe(4);
	});

	it('retries a timeout, which is the other way a provider fails to answer', async () => {
		const a = scripted('only', ['PROVIDER_TIMEOUT', 'OK']);
		const r = await run([a]);
		expect(r.outcome).toBe('OK');
	});
});

describe('what it must not retry', () => {
	// Each of these costs a request and cannot come back different. Asking twice is asking to
	// be refused twice and billed twice.
	const refuse: Outcome[] = [
		'HARD_BLOCK',
		'AUTH_FAILED',
		'RATE_LIMITED',
		'TARGET_NOT_FOUND',
		'TARGET_ERROR',
	];
	for (const outcome of refuse) {
		it(`leaves ${outcome} alone`, async () => {
			const a = scripted('only', [outcome]);
			await run([a]);
			expect(a.calls).toBe(1);
		});
	}

	it('leaves PROVIDER_DRIFT alone', async () => {
		// The one outcome that pages a human. A provider that changed its envelope will change
		// it again on the retry, and the second attempt only delays the alert.
		const a = scripted('only', ['PROVIDER_DRIFT']);
		await run([a]);
		expect(a.calls).toBe(1);
	});
});

describe('where it does not apply', () => {
	it('never fires at a non-terminal hop', async () => {
		// THE CENTRAL RULE. Provider A fails; the next hop is a different provider, which is
		// both cheaper and likelier to work than asking A twice.
		const a = scripted('a', ['PROVIDER_ERROR']);
		const b = scripted('b', ['OK']);
		const r = await run([a, b]);
		expect(a.calls).toBe(1);
		expect(b.calls).toBe(1);
		expect(r.provider).toBe('b');
	});

	it('spends its allowance once per request, not once per provider', async () => {
		// Two providers, one retry: three attempts, and the extra one is at the end. A
		// per-provider budget would make a three-provider chain cost six requests on a bad day.
		const a = scripted('a', ['PROVIDER_ERROR']);
		const b = scripted('b', ['PROVIDER_ERROR']);
		const r = await run([a, b]);
		expect(a.calls).toBe(1);
		expect(b.calls).toBe(2);
		expect(r.attempts.map((x) => x.provider)).toEqual(['a', 'b', 'b']);
	});

	it('will not borrow time the deadline does not have', async () => {
		// A retry is a hop nobody budgeted for. Without the deadline guard it eats the tail of
		// the request and turns a clean PROVIDER_ERROR into a BUDGET_EXCEEDED, which sends
		// whoever reads it debugging the wrong system.
		const a = scripted('only', ['PROVIDER_ERROR']);
		const r = await run([a], { deadlineMs: 21_000 });
		expect(a.calls).toBe(1);
		expect(r.outcome).toBe('PROVIDER_ERROR');
	});
});
