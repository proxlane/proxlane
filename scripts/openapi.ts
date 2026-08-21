// The OpenAPI description of the gateway, GENERATED.
//
// `CLAUDE.md`'s ownership table has listed OpenAPI as docs-writer's since the scaffold and
// nothing had written one. A spec matters here for a reason specific to this product: the
// pitch is drop-in migration, and the fastest way to evaluate that claim is to point a
// generator at a description of the surface and see how close it is to the one you already
// call.
//
// GENERATED, NOT AUTHORED, for the same reason the outcome page is. Status codes, the outcome
// enum and the class enum come from `FAILOVER` — the object the gateway actually routes on —
// imported directly, because `packages/shared/src/outcome.ts` has no imports of its own and
// Node's type stripping runs it as-is. Only the prose is written by hand.
//
// Committed and asserted byte-identical by `docs:check`, the same standard as CODEOWNERS.
//
// AND EXCLUDED FROM BIOME, in `biome.json`, for a reason worth stating so nobody removes the
// entry: two tools cannot own one file's bytes. Biome formats JSON differently from
// `JSON.stringify`, so with it enabled `pnpm lint` rewrites this file and `docs:check`
// immediately reports it stale — each tool undoing the other on every run. Recorded fixtures
// are excluded for the same reason.
//
//   node scripts/openapi.ts --write    regenerate
//   node scripts/openapi.ts            fail if stale

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FAILOVER,
	OUTCOME_CLASSES,
	OUTCOMES,
	type Outcome,
} from '../packages/shared/src/outcome.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/web/public/openapi.json');

/**
 * The only hand-written part, and the part a generator cannot know.
 *
 * `docs:check` asserts this list matches the parameters `app.ts` actually reads, so a
 * parameter added to the gateway and not described here fails the build rather than shipping
 * undocumented.
 */
const PARAMETERS = [
	{
		name: 'url',
		required: true,
		schema: { type: 'string', format: 'uri' },
		description:
			'The page to fetch. Rejected at the edge with TARGET_FORBIDDEN if it resolves to a private range, a denylisted host, or a cloud metadata address.',
		example: 'https://example.com',
	},
	{
		name: 'api_key',
		required: false,
		schema: { type: 'string' },
		description:
			"The gateway's key, not a provider's. Accepted because it is what the providers this replaces accept, which is what makes migration a hostname change. Prefer the Authorization header: query strings reach access logs, proxy logs, Referer headers and error trackers.",
	},
	{
		name: 'render',
		required: false,
		schema: { type: 'string', enum: ['true', '1'] },
		description:
			'Run JavaScript on the target. Only "true" and "1" enable it; every other value, including omitting the parameter, means false. Presence alone is never truth, or render=false would render and cost about five times as much.',
	},
	{
		name: 'premium',
		required: false,
		schema: { type: 'string', enum: ['none', 'residential', 'stealth'], default: 'none' },
		description: 'Proxy tier.',
	},
	{
		name: 'country_code',
		required: false,
		schema: { type: 'string', pattern: '^[A-Za-z]{2}$' },
		description:
			'ISO 3166-1 alpha-2. Where the request should appear to come from, subject to provider coverage.',
	},
	{
		name: 'provider',
		required: false,
		schema: { type: 'string' },
		description:
			'Pin one provider and disable failover. A benchmarking escape hatch. If that provider cannot serve the request you get NO_PROVIDER_AVAILABLE rather than a silent substitution.',
	},
	{
		name: 'binary',
		required: false,
		schema: { type: 'string', enum: ['true', '1'] },
		description:
			'Ask for the response body byte for byte — an image, a PDF, anything not text. Narrows the chain to providers that can deliver it, which is not all of them: measured on 2026-08-19, two of the four launch providers destroy binary, one by decoding it as UTF-8 and one by wrapping it in a JSON envelope. Without this a request for an image returns 200 with a quietly corrupted body. If no configured provider can serve bytes the answer is NO_PROVIDER_AVAILABLE, which is the honest failure.',
	},
	{
		name: 'timeout',
		required: false,
		schema: { type: 'integer', minimum: 8000 },
		description:
			"Deadline for the whole request in milliseconds, every failover hop included. Defaults to the server's PROXLANE_DEADLINE_MS and is capped at it: a caller may ask for less time than the operator budgeted, never more. Below 8000 a single attempt cannot finish, so it is rejected as BAD_REQUEST rather than timing out having tried nothing.",
	},
] as const;

/** Response headers, and when each is present. Asserted against `app.ts` by `docs:check`. */
const HEADERS: Record<string, { description: string; schema: object }> = {
	'X-Outcome': {
		description:
			'What happened. Open: it gains members as adapters land, so branch on X-Outcome-Class instead. Absent when the request never became a scrape — a 401 or a 501 has no outcome to report, though it still carries X-Outcome-Class.',
		schema: { $ref: '#/components/schemas/Outcome' },
	},
	'X-Cost-Unit': {
		description:
			"What X-Cost-Estimate counts. `provider-credits` is the serving provider's own credits; `usd-cents` is money, used by providers that bill per request and issue no credits. Absent when a failover chain spent in more than one unit, in which case X-Cost-Estimate is the literal string `mixed` rather than a sum of incomparable numbers — the per-attempt figures in the body each carry their own unit.",
		schema: { type: 'string', enum: ['provider-credits', 'usd-cents'] },
	},
	'X-Cost-Source': {
		description:
			'Whose number X-Cost-Estimate is. `reported` means the providers told us what they charged and the adapter passed it through — three of the four do. `estimated` means they said nothing and we applied our own table, which is our model of their pricing rather than their answer, and is the one worth treating with suspicion. `mixed` when a chain used both, which a failover across providers routinely does. Absent when nothing was charged.',
		schema: { type: 'string', enum: ['reported', 'estimated', 'mixed'] },
	},
	'X-Outcome-Class': {
		description:
			'The coarse class. Closed: these six never grow. This is the one to branch on.',
		schema: { $ref: '#/components/schemas/OutcomeClass' },
	},
	'X-Attempts': {
		description: 'How many providers were tried.',
		schema: { type: 'integer', minimum: 0 },
	},
	'X-Chain': {
		description:
			'Every attempt as `provider:outcome`, in order. The only header that names who FAILED — X-Provider-Used names the winner, so a request that failed over and then succeeded otherwise looks like a clean single-hop 200. A single-attempt request has a one-element chain; the header is omitted, never empty, when no provider was tried at all.',
		schema: { type: 'string', example: 'scraperapi:PROVIDER_TIMEOUT>scrapfly:OK' },
	},
	'X-Cost-Estimate': {
		description:
			'Credits, summed across every attempt including the ones that failed. A failover that burned two charged hops reports both.',
		schema: { type: 'string' },
	},
	'Server-Timing': {
		description:
			'gw is gateway-internal time, up is time inside provider calls, total is both. Split by subtraction, so anything unaccounted for lands in gw where it is visible.',
		schema: { type: 'string' },
	},
	'X-Request-Id': {
		description:
			"Present on every response, including 401s. Echoes the caller's X-Request-Id when it is usable. Quote it in a support thread.",
		schema: { type: 'string' },
	},
	'X-Provider-Used': {
		description: 'The provider that served. Absent, never empty, when nothing served.',
		schema: { type: 'string' },
	},
	'X-Detect-Rule': {
		description:
			'The block-page rule that fired. Present only when one did: emitting "none" everywhere would assert the detector ran and found nothing, which is untrue for a request that never reached a provider.',
		schema: { type: 'string' },
	},
	'X-Provider-Health': {
		description:
			'Present when health tracking is on, or when a routing floor fired. demoted-forced means every capable provider was demoted and the least bad was used anyway. cooling-forced means every capable provider was on cooldown and one was tried regardless, rate-limited per domain, rather than take the domain off the air for the length of the backoff.',
		schema: { type: 'string' },
	},
	'Retry-After': {
		description:
			'Seconds, rounded up. Sent only when the gateway knows: a guessed value is worse than none, because a caller will believe it.',
		schema: { type: 'integer', minimum: 1 },
	},
};

/** Every status the taxonomy can produce, with the outcomes that produce it. */
function responsesFromTaxonomy(): Record<string, unknown> {
	const byStatus = new Map<number, Outcome[]>();
	for (const outcome of OUTCOMES) {
		const status = FAILOVER[outcome].httpStatus;
		if (status === 'upstream') continue; // Handled by the 200 response below.
		byStatus.set(status, [...(byStatus.get(status) ?? []), outcome]);
	}

	const responses: Record<string, unknown> = {
		'200': {
			description:
				"The target's own response, passed through unchanged. That is the drop-in promise: code that already branches on a 404 keeps working, so a target's 404 arrives as a 404 and not as an error of ours.",
			headers: headerRefs(),
			content: { '*/*': { schema: { type: 'string' } } },
		},
		'401': {
			description:
				'The gateway key was missing or wrong. Deliberately NOT an outcome: outcomes describe what happened to a scrape, and a request rejected at the door never became one. Reusing AUTH_FAILED here would put gateway auth failures into provider health.',
			content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
		},
	};

	for (const [status, outcomes] of [...byStatus].sort((a, b) => a[0] - b[0])) {
		responses[String(status)] = {
			description: outcomes
				.map((o) => `${o}: ${FAILOVER[o].meaning}.`)
				.join(' ')
				.trim(),
			headers: headerRefs(),
			content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
		};
	}
	return responses;
}

function headerRefs(): Record<string, { $ref: string }> {
	return Object.fromEntries(
		Object.keys(HEADERS).map((h) => [h, { $ref: `#/components/headers/${h}` }]),
	);
}

export function buildSpec(): string {
	const spec = {
		openapi: '3.1.0',
		info: {
			title: 'Proxlane',
			version: '1',
			summary: 'One endpoint in front of every scraping API.',
			description:
				"Routes a scrape across ScraperAPI, ScrapingBee, Scrapfly and Bright Data. When a provider blocks, errors or times out the next one is tried, and the response headers say what happened at every step.\n\nThis file is generated from the gateway's own outcome taxonomy, so the status codes and the X-Outcome enum below are the ones the router actually uses.\n\nSelf-hosted: there is no shared base URL. Point `servers` at your own gateway.",
			license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
		},
		externalDocs: { url: 'https://proxlane.dev/docs', description: 'Documentation' },
		servers: [
			{
				url: '{gateway}',
				description: 'Your own deployment. The gateway is self-hosted; we run no shared one.',
				variables: { gateway: { default: 'http://localhost:8787' } },
			},
		],
		security: [{ bearerAuth: [] }, { apiKeyQuery: [] }],
		paths: {
			'/v1': {
				get: {
					operationId: 'scrape',
					summary: 'Scrape a URL',
					description:
						'Fetches the target through the first capable provider, failing over on a block, a provider error or a timeout.',
					parameters: PARAMETERS.map((p) => ({ ...p, in: 'query' })),
					responses: responsesFromTaxonomy(),
				},
				post: {
					operationId: 'scrapePost',
					summary: 'Scrape a URL, forwarding a request body',
					description:
						'As GET, and the body is forwarded to the target as text, byte for byte. It is not parsed: guessing between JSON and form encoding would corrupt one of them. The response body cap applies to the request body too.',
					parameters: PARAMETERS.map((p) => ({ ...p, in: 'query' })),
					requestBody: {
						required: false,
						content: { '*/*': { schema: { type: 'string' } } },
					},
					responses: responsesFromTaxonomy(),
				},
			},
			'/health': {
				get: {
					operationId: 'health',
					summary: 'Liveness',
					description:
						'Takes no key. Reports that the process is up and serving, not that it is fully configured: a gateway with no provider keys is correctly running and will answer NO_PROVIDER_AVAILABLE. Returns the provider COUNT, never the names, because which providers an operator pays for is not something to hand out. Never shed under load. `version` is the running build, so a deploy can be verified: publishing an image is not deploying it, and an orchestrator keeps serving the digest it started with until something issues an update.',
					security: [],
					responses: {
						// NO 4xx, and a linter will say so. This endpoint takes no key, no parameters
						// and no body: there is no request it can refuse. Adding a 4xx to satisfy a
						// style rule would put a response in the spec that the gateway cannot return,
						// which is a worse defect than the warning.
						'200': {
							description: 'The process is serving.',
							content: {
								'application/json': {
									schema: {
										type: 'object',
										required: ['status', 'version', 'providers'],
										properties: {
											status: { type: 'string', enum: ['ok'] },
											version: { type: 'string', example: '0.4.0' },
											providers: { type: 'integer', minimum: 0 },
										},
									},
								},
							},
						},
					},
				},
			},
			'/health/providers': {
				get: {
					operationId: 'providerHealth',
					summary: 'Per-provider health state',
					description:
						'Only meaningful with PROXLANE_HEALTH=on, which is off by default because the statistic assumes independent failures and real providers have bad hours instead.',
					responses: {
						'200': { description: 'Health state per provider.' },
						'401': {
							description: 'The gateway key was missing or wrong.',
							content: {
								'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
							},
						},
					},
				},
			},
			'/health/cooldowns': {
				get: {
					operationId: 'cooldowns',
					summary: 'What is cooling, and what recently expired',
					description:
						'Expired entries are included deliberately: the consecutive count is what makes the next cooldown on that key longer.',
					responses: {
						'200': { description: 'Cooling and recently expired entries.' },
						'401': {
							description: 'The gateway key was missing or wrong.',
							content: {
								'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
							},
						},
					},
				},
			},
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: "The gateway's key. Preferred over the query parameter.",
				},
				apiKeyQuery: {
					type: 'apiKey',
					in: 'query',
					name: 'api_key',
					description:
						'The drop-in migration surface. Works, but a query string is the worst place to put a credential.',
				},
			},
			headers: HEADERS,
			schemas: {
				Outcome: {
					type: 'string',
					description: 'Open. Gains members as adapters land.',
					enum: [...OUTCOMES],
				},
				OutcomeClass: {
					type: 'string',
					description: 'Closed. These six never grow, which is why callers should branch here.',
					enum: [...OUTCOME_CLASSES],
				},
				ErrorBody: {
					type: 'object',
					required: ['requestId', 'error'],
					properties: {
						requestId: { type: 'string' },
						error: {
							type: 'object',
							required: ['code', 'class', 'message', 'docs'],
							properties: {
								code: {
									description:
										'The outcome, or UNAUTHORIZED. One vocabulary whether the failure happened at a provider or before one was reached.',
									type: 'string',
								},
								class: { $ref: '#/components/schemas/OutcomeClass' },
								message: { type: 'string' },
								docs: { type: 'string', format: 'uri' },
							},
						},
						attempts: {
							type: 'array',
							description:
								'What was tried and what each provider said. The grain you need when debugging a failover.',
							items: { type: 'object' },
						},
					},
				},
			},
		},
	};
	return `${JSON.stringify(spec, null, '\t')}\n`;
}

if (process.argv[1]?.endsWith('openapi.ts') === true) {
	const want = buildSpec();
	const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : undefined;
	if (process.argv.includes('--write')) {
		if (current === want) process.stdout.write('  openapi.json already current\n');
		else {
			writeFileSync(OUT, want);
			process.stdout.write('  wrote apps/web/public/openapi.json\n');
		}
	} else if (current !== want) {
		process.stderr.write(
			'\n  apps/web/public/openapi.json is stale.\n\n  Regenerate:  node scripts/openapi.ts --write\n\n',
		);
		process.exit(1);
	} else {
		process.stdout.write('  openapi.json current\n');
	}
}
