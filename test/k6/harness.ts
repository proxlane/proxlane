// The gateway under test, wired to the mock provider.
//
// This is the REAL `createApp`: the real chain, the real detector, the real transport, the
// real backpressure limiter, over a real socket. The only substitution is which host the
// adapter points at, which is the one thing that has to change for the run to be free and
// deterministic.
//
// WHY THE MOCK ADAPTER LIVES HERE and not in `packages/adapters/src/_dev/`. Dev adapters are
// loaded by `pnpm record`, and this one has no reason to be reachable from anything a
// contributor runs. Building it in the harness also keeps it out of the shipped gateway
// bundle entirely — the alternative, teaching `apps/gateway/src/index.ts` to load test
// adapters behind an environment flag, puts test code in the production image forever in
// exchange for saving twenty lines here.

import { serve } from '@hono/node-server';
import {
	type Adapter,
	type GatewayRequest,
	MICROCREDITS_PER_CREDIT,
	type ParsedResult,
	type ProviderHttpRequest,
	type ProviderHttpResponse,
} from '@proxlane/adapters';
// The BUILT gateway, not its source. Two reasons: Node's type stripping does not rewrite a
// `./x.js` import to `./x.ts`, so the source graph will not load under bare node; and the
// soak should measure the artifact that ships rather than a differently-bundled copy of it.
import { createApp } from '@proxlane/gateway/app';
import { createFetchTransport } from '@proxlane/gateway/transport';
import { startMockProvider } from './mock-provider.ts';

const DECODER = new TextDecoder();

/**
 * An adapter that is honest about being fake.
 *
 * It satisfies the real contract — pure `translate`, pure `parse`, explicit parameters — so
 * the chain treats it exactly as it treats ScraperAPI. What it does NOT do is pretend to be a
 * provider: its id says `mock`, and nothing outside this directory can load it.
 */
// No `as Adapter` anywhere below. The cast is what let the first version ship a `parse` with
// no `cost` field: the contract requires one on every result, TypeScript knew, and the cast
// silenced it. Every mock request then 500'd inside the chain.
function mockAdapter(endpoint: string, line: 1 | 2 | 3, id: string): Adapter {
	return {
		capabilities: {
			id,
			line,
			renderJs: true,
			countryCodes: 'all',
			premiumTiers: new Set(['none', 'residential', 'stealth']),
			sessions: true,
			// Short, deliberately. A soak that inherits ScraperAPI's 75-second terminal budget
			// spends its last minutes waiting on requests that will never finish.
			maxTimeoutMs: 8_000,
			fastTimeoutMs: 4_000,
			post: true,
			// The real CostTable shape, filled with obviously-fake numbers. A round 1 credit
			// keeps the arithmetic checkable by eye when reading a soak's cost totals.
			costTable: {
				effectiveDate: '2026-01-01',
				sourceUrl: 'https://example.invalid/mock-pricing',
				base: 1_000_000,
				multipliers: { renderJs: 5, premium: { none: 1, residential: 10, stealth: 30 } },
			},
		},
		translate(req: GatewayRequest): ProviderHttpRequest {
			const url = new URL(endpoint);
			url.searchParams.set('url', req.url);
			// Every parameter explicit, per the house rule, even here: an adapter that leans on
			// provider defaults is the bug the rule exists to prevent, and a mock that breaks the
			// rule teaches the wrong shape to whoever copies it.
			url.searchParams.set('render', String(req.renderJs));
			url.searchParams.set('premium', req.premium);
			if (req.countryCode !== undefined) url.searchParams.set('country', req.countryCode);
			return {
				url: url.toString(),
				method: req.method,
				headers: {},
				timeoutMs: 0, // Replaced by the router's per-attempt budget.
				...(req.body === undefined ? {} : { body: req.body }),
			};
		},
		parse(res: ProviderHttpResponse): ParsedResult {
			// Cost is required on EVERY result, including failures: an attempt that a provider
			// billed for still cost money, and the chain sums across all of them.
			const cost = { microcredits: MICROCREDITS_PER_CREDIT, source: 'estimated' as const };
			if (res.status === 429) {
				return { outcome: 'RATE_LIMITED', upstreamStatusCode: 429, cost };
			}
			if (res.status === 404) {
				return { outcome: 'TARGET_NOT_FOUND', upstreamStatusCode: 404, cost };
			}
			if (res.status >= 500) {
				return { outcome: 'PROVIDER_ERROR', upstreamStatusCode: res.status, cost };
			}
			// A 200 is NOT a success. The detector decides, downstream of here, from the body —
			// which is the product's whole thesis and has to be on the measured path.
			return {
				outcome: 'OK',
				body: res.body,
				contentType: res.headers['content-type'] ?? 'text/html',
				charset: 'utf-8',
				upstreamStatusCode: res.status,
				cost,
			};
		},
	};
}

export interface HarnessOptions {
	readonly apiKey: string;
	readonly port?: number;
	readonly maxInflight?: number;
	readonly bodyCapMb?: number;
	/** How many mock providers to put in the chain, so failover has somewhere to go. */
	readonly providers?: number;
}

export interface Harness {
	readonly port: number;
	readonly mockPort: number;
	readonly mockCounts: Readonly<Record<string, number>>;
	close: () => Promise<void>;
}

export async function startHarness(options: HarnessOptions): Promise<Harness> {
	const mock = await startMockProvider({});
	const endpoint = `http://127.0.0.1:${mock.port}/scrape`;
	const count = options.providers ?? 3;

	// Three by default, matching the launch chain, so a blocked first hop actually fails over
	// and the soak measures a chain rather than a single call.
	const candidates = Array.from({ length: count }, (_, i) => ({
		adapter: mockAdapter(endpoint, ((i % 3) + 1) as 1 | 2 | 3, `mock${i + 1}`),
		key: 'MOCK',
	}));

	const app = createApp({
		transport: createFetchTransport(),
		candidates,
		apiKey: options.apiKey,
		maxBodyBytes: (options.bodyCapMb ?? 10) * 1024 * 1024,
		defaultDeadlineMs: 20_000,
		...(options.maxInflight === undefined ? {} : { maxInflight: options.maxInflight }),
	});

	const server = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: '127.0.0.1' });
	await new Promise<void>((r) => setTimeout(r, 60));
	const address = server.address();
	const port =
		typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

	return {
		port,
		mockPort: mock.port,
		get mockCounts() {
			return mock.counts;
		},
		close: async () => {
			await new Promise<void>((r) => server.close(() => r()));
			await mock.close();
		},
	};
}

/** Run the harness standalone: `node test/k6/harness.ts <port> <apiKey> <maxInflight>`. */
if (process.argv[1]?.endsWith('harness.ts') === true) {
	const port = Number(process.argv[2] ?? 8899);
	const apiKey = process.argv[3] ?? 'soak';
	const maxInflight = Number(process.argv[4] ?? 32);
	const harness = await startHarness({ apiKey, port, maxInflight });
	process.stdout.write(
		`harness ready port=${harness.port} mock=${harness.mockPort} maxInflight=${maxInflight}\n`,
	);
	const shutdown = async () => {
		// Counts go to stderr so the runner can read them without them landing in k6's stdout.
		process.stderr.write(`mock-counts ${JSON.stringify(harness.mockCounts)}\n`);
		await harness.close();
		process.exit(0);
	};
	for (const signal of ['SIGTERM', 'SIGINT'] as const)
		process.on(signal, () => void shutdown());
	void DECODER; // Kept for parse-side debugging; referenced so lint stays quiet.
}
