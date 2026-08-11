// The HTTP surface. `GET /v1?api_key=…&url=…`
//
// The shape is deliberately ScraperAPI's, because `plan.md` section 4 makes drop-in
// migration the product promise: one hostname change, parameters unchanged in shape. An
// endpoint that needed its own client would make the migration page a lie.
//
// Everything here is thin. Deciding what to do is `runChain`'s job; this parses a query
// string, maps an Outcome onto an HTTP response, and gets out of the way.

import { type Adapter, carriesBody, type GatewayRequest, policyFor } from '@proxlane/adapters';
import { Hono } from 'hono';
import type { ChainResult } from './chain.js';
import { runChain } from './chain.js';
import type { HealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

export interface AppDeps {
	readonly transport: HttpTransport;
	/** Ordered candidates. BYOK, so the key travels with the adapter. */
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	/** The gateway's own key. Callers present this; provider keys never leave the server. */
	readonly apiKey: string;
	readonly maxBodyBytes: number;
	readonly defaultDeadlineMs: number;
	/** Omit to route without health. The gateway then behaves exactly as it did before. */
	readonly health?: HealthStore;
}

/** Constant-time compare, so a wrong key cannot be discovered one character at a time. */
function keyMatches(presented: string, expected: string): boolean {
	if (presented.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < presented.length; i++) {
		diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

function headersFor(r: ChainResult): Record<string, string> {
	// Spend across EVERY attempt, not just the winning one. A failover that cost two charged
	// hops and reports the price of one is the number that makes margin look better than it
	// is — see plan.md section 7's unbilled-spend metric.
	const total = r.attempts.reduce((n, a) => n + (a.costMicrocredits ?? 0), 0);
	return {
		'X-Outcome': r.outcome,
		'X-Attempts': String(r.attempts.length),
		'X-Cost-Estimate': (total / 1_000_000).toFixed(6),
		...(r.provider === undefined ? {} : { 'X-Provider-Used': r.provider }),
		// Present ONLY when a rule fired. Still no `none`: emitting that on every response
		// would assert the detector ran and found nothing, which is untrue for a request that
		// never reached a provider or came back as JSON. Absence means "no rule fired",
		// which is what a caller can actually act on.
		...(r.detectRuleId === undefined ? {} : { 'X-Detect-Rule': r.detectRuleId }),
		// Present only when a provider actually served. `demoted-forced` is the one worth
		// reading: every capable provider was demoted and the least-bad was used anyway, so a
		// degraded answer is expected. A user who can see that understands their world;
		// scattered unexplained failures get blamed on us. operations.md section 4.
		...(r.providerHealth === undefined ? {} : { 'X-Provider-Health': r.providerHealth }),
	};
}

export function createApp(deps: AppDeps): Hono {
	const app = new Hono();

	// Health is "this process is up and serving", not "fully configured". A gateway with no
	// provider keys is correctly running and will honestly answer NO_PROVIDER_AVAILABLE —
	// failing the healthcheck for that would restart-loop a container whose only problem is
	// that nobody has signed up for a provider yet.
	//
	// The COUNT, never the names: this endpoint takes no key, and which providers an operator
	// pays for is not something to hand out. A count is enough to diagnose.
	app.get('/health', (c) => c.json({ status: 'ok', providers: deps.candidates.length }));

	// The operator's view of what the router believes. Unlike `/health`, this one NAMES
	// providers — an operator debugging "why is everything slow" needs to know which provider
	// the gateway has given up on.
	//
	// AND THEREFORE IT TAKES THE KEY. `/health` reports a count and no names precisely because
	// it is unauthenticated: which providers an operator pays for is not something to hand to
	// anyone who can reach the port. An open endpoint listing them would have quietly undone
	// that decision one file away from where it is written down.
	//
	// The argument for leaving it open — "a diagnostic you cannot reach when things are broken
	// is useless" — is true of `/health`, which is the container healthcheck. It is not true
	// here: the operator asking this question always has the gateway key, and `proxlane doctor`
	// is already configured with one.
	app.get('/health/providers', async (c) => {
		if (!keyMatches(c.req.query('api_key') ?? '', deps.apiKey)) {
			return c.json({ error: 'unauthorized', message: 'api_key missing or incorrect' }, 401);
		}
		if (deps.health === undefined) {
			// Honest 501 rather than an empty list. `{providers: []}` would read as "all fine".
			return c.json(
				{ error: 'not_enabled', message: 'this gateway is running without health tracking' },
				501,
			);
		}
		const now = Date.now();
		const states = await deps.health.all(now);
		return c.json({
			providers: deps.candidates.map(({ adapter }) => {
				const id = adapter.capabilities.id;
				const st = states.get(id);
				return {
					id,
					state: st?.state ?? 'healthy',
					// null until MIN_SAMPLES observations exist. Reported as null rather than
					// omitted, because "we have no baseline yet" is the actionable answer when
					// somebody asks why a dying provider has not been demoted.
					baselineFailureRate: st?.p0 ?? null,
					statistic: st === undefined ? 0 : Number(st.s.toFixed(3)),
					samplesInState: st?.samples ?? 0,
				};
			}),
		});
	});

	app.get('/v1', async (c) => {
		const presented = c.req.query('api_key') ?? '';
		if (!keyMatches(presented, deps.apiKey)) {
			// NOT an Outcome. The taxonomy describes what happened to a scrape; this request
			// never became one. Reusing AUTH_FAILED here would put gateway auth failures into
			// the provider health statistics.
			return c.json({ error: 'unauthorized', message: 'api_key missing or incorrect' }, 401);
		}

		const url = c.req.query('url');
		if (url === undefined || url === '') {
			return c.json({ error: 'bad_request', message: 'url is required' }, 400);
		}

		const renderRaw = c.req.query('render');
		const premiumRaw = c.req.query('premium') ?? 'none';
		if (premiumRaw !== 'none' && premiumRaw !== 'residential' && premiumRaw !== 'stealth') {
			return c.json(
				{ error: 'bad_request', message: 'premium must be none, residential or stealth' },
				400,
			);
		}
		const countryCode = c.req.query('country_code');
		const forced = c.req.query('provider');

		const req: GatewayRequest = {
			url,
			method: 'GET',
			// Explicit, never inferred from presence: `render=false` must mean false, and the
			// absence of the parameter must mean false too. Treating presence as truth is how
			// `render=false` ends up rendering and billing 5x.
			renderJs: renderRaw === 'true' || renderRaw === '1',
			premium: premiumRaw,
			deadlineMs: deps.defaultDeadlineMs,
			...(countryCode === undefined ? {} : { countryCode }),
		};

		let candidates = deps.candidates;
		if (forced !== undefined) {
			// Benchmarking escape hatch from plan.md section 4. Narrowing to nothing is left to
			// the chain, which answers NO_PROVIDER_AVAILABLE — the same answer as asking for a
			// capability nobody has, and for the same reason.
			candidates = candidates.filter((x) => x.adapter.capabilities.id === forced);
		}

		const result = await runChain(req, {
			transport: deps.transport,
			candidates,
			maxBodyBytes: deps.maxBodyBytes,
			...(deps.health === undefined ? {} : { health: deps.health }),
		});

		const policy = policyFor(result.outcome);
		// 'upstream' means pass the TARGET's status through — the drop-in promise: a caller
		// migrating from a provider must keep seeing the status their code already branches
		// on. Falling back to 200 only when the adapter reported none.
		const status =
			policy.httpStatus === 'upstream'
				? (result.result?.upstreamStatusCode ?? 200)
				: policy.httpStatus;

		if (carriesBody(result.outcome) && result.result?.body !== undefined) {
			const contentType = result.result.contentType ?? 'application/octet-stream';
			return c.body(result.result.body as unknown as ArrayBuffer, status as 200, {
				...headersFor(result),
				'Content-Type': contentType,
			});
		}

		// No page to return, so say what happened rather than serving an empty 200. The
		// attempt list is included because the logged grain is the attempt: a caller debugging
		// a failover needs to see which providers were tried and what each said.
		return c.json(
			{
				outcome: result.outcome,
				...(result.reason === undefined ? {} : { reason: result.reason }),
				attempts: result.attempts,
			},
			status as 502,
			headersFor(result),
		);
	});

	return app;
}
