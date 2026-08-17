// The HTTP surface. `GET /v1?api_key=…&url=…`
//
// The shape is deliberately ScraperAPI's, because `plan.md` section 4 makes drop-in
// migration the product promise: one hostname change, parameters unchanged in shape. An
// endpoint that needed its own client would make the migration page a lie.
//
// Everything here is thin. Deciding what to do is `runChain`'s job; this parses a query
// string, maps an Outcome onto an HTTP response, and gets out of the way.

import { createHash, timingSafeEqual } from 'node:crypto';
import {
	type Adapter,
	carriesBody,
	type GatewayRequest,
	outcomeClass,
	policyFor,
} from '@proxlane/adapters';
import {
	type ErrorCode,
	errorBody,
	errorClassFor,
	GATEWAY_ERROR_CODES,
	requestIdFrom,
} from '@proxlane/shared';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { MIN_USEFUL_ATTEMPT_MS } from './budget.js';
import type { ChainResult } from './chain.js';
import { runChain } from './chain.js';
import type { CooldownStore } from './cooldown-store.js';
import type { HealthStore } from './health-store.js';
import { InflightLimiter, retryAfterSeconds } from './inflight.js';
import { serverTimingHeader, splitTimings } from './server-timing.js';
import type { HttpTransport } from './transport.js';

export interface AppDeps {
	readonly transport: HttpTransport;
	/** Ordered candidates. BYOK, so the key travels with the adapter. */
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	/** The gateway's own key. Callers present this; provider keys never leave the server. */
	readonly apiKey: string;
	readonly maxBodyBytes: number;
	readonly defaultDeadlineMs: number;
	/**
	 * Concurrent `/v1` requests before the gateway sheds with `GATEWAY_BUSY`.
	 *
	 * Omit to run without a ceiling, which is what the unit and contract tests want: they
	 * drive the handler directly and a limiter would make their concurrency meaningful. The
	 * server always sets it — `index.ts` reads `PROXLANE_MAX_INFLIGHT`.
	 */
	readonly maxInflight?: number;
	/** Omit to route without health. The gateway then behaves exactly as it did before. */
	readonly health?: HealthStore;
	/** Omit to route without cooldowns. */
	readonly cooldowns?: CooldownStore;
	/**
	 * Whose account the `cd:acct` namespace belongs to.
	 *
	 * `ChainDeps` has always accepted this and `AppDeps` did not, so nothing ever supplied it
	 * and every account cooldown was keyed `cd:acct:self:{provider}`. Harmless with one
	 * deployment; wrong the moment two share a Valkey, which is the exact shape the Valkey
	 * store exists to enable — one gateway's expired key would cool that provider for the
	 * other, which is the cross-org contamination the two namespaces exist to prevent.
	 */
	readonly orgId?: string;
	/** Extra goes at the last capable provider. See `chain.ts`. Defaults to 1; 0 disables. */
	readonly terminalRetries?: number;
	/**
	 * Where `error.docs` points. Defaults to the GitHub taxonomy section, which exists;
	 * `docs.proxlane.dev` does not resolve and README.md says so.
	 */
	readonly docsUrl?: string;
}

/**
 * Where the caller's gateway key came from.
 *
 * `api_key` in the query string is the drop-in surface — `plan.md` section 4 promises a
 * hostname change and nothing else, and that is what the providers we replace accept. It is
 * also the worst place to put a credential: query strings reach access logs, proxy logs,
 * `Referer` headers and error trackers, none of which are meant to hold secrets.
 *
 * So both are accepted and the header wins. Migrating callers keep working unchanged; anyone
 * writing new code has somewhere better to put it, and `proxlane doctor` can tell them so.
 */
function presentedKey(c: {
	req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined };
}): string {
	const auth = c.req.header('authorization');
	if (auth !== undefined) {
		// Case-insensitive scheme per RFC 9110, exactly one space, and nothing else trimmed:
		// a key is opaque and may legitimately end in characters trimming would eat.
		const m = /^[Bb][Ee][Aa][Rr][Ee][Rr] (.+)$/.exec(auth);
		if (m?.[1] !== undefined) return m[1];
	}
	return c.req.query('api_key') ?? '';
}

/**
 * Compare the presented gateway key against the configured one.
 *
 * `timingSafeEqual` over SHA-256 digests rather than a hand-rolled character loop. The loop
 * short-circuited on length, which leaks key length over the network in O(1), and a
 * `charCodeAt` loop is not a constant-time primitive anyway: V8 may deoptimise it, and sliced
 * or rope string representations make per-character access non-uniform.
 *
 * Hashing first is what makes the lengths equal, so the comparison is genuinely fixed-width
 * for any pair of inputs. `SECURITY.md` claims constant time; this is the primitive that
 * earns the claim rather than approximating it.
 */
function keyMatches(presented: string, expected: string): boolean {
	const a = createHash('sha256').update(presented, 'utf8').digest();
	const b = createHash('sha256').update(expected, 'utf8').digest();
	return timingSafeEqual(a, b);
}

/**
 * Per-request identity, so every response can be traced back to one attempt chain.
 *
 * `requestId` is set by middleware before any handler runs, which is the only way to
 * guarantee it reaches responses the scrape path never produces — 401, a missing `url`, an
 * unhandled throw. Threading it through handlers by hand would miss exactly those, and those
 * are the ones people open issues about.
 */
type Vars = { Variables: { requestId: string; startedAt: number } };

/**
 * Every error the gateway returns, with the two headers a caller branches on.
 *
 * Added because the pre-chain returns did not have them. A request that never became a scrape
 * — no url, a bad `premium`, an over-cap request body, a wrong key — went out as a bare JSON
 * body, while everything that reached the chain carried `X-Outcome` and `X-Outcome-Class`. So
 * the docs' own advice ("switch on the closed class") failed on the most common client
 * mistake of all, and a caller reading headers first saw nothing at all.
 *
 * `X-Outcome` IS OMITTED FOR A CODE THAT IS NOT AN OUTCOME, which is the one subtlety here.
 * `UNAUTHORIZED` and `NOT_ENABLED` are gateway error codes: the taxonomy describes what
 * happened to a scrape, and neither of these requests ever became one. Putting them in a
 * header named `X-Outcome` would widen the header's vocabulary past the type it is named
 * after, and an existing test guards exactly that.
 *
 * `X-Outcome-Class` is emitted either way, and that is the point of having a closed class:
 * `errorClassFor` knows both vocabularies, so a caller branching on `client` versus `gateway`
 * gets a usable answer on every error the gateway can produce, including the ones with no
 * outcome to report.
 *
 * X-Attempts is '0' on every one of these, and that is a fact rather than a placeholder:
 * nothing was tried, and omitting it would leave a caller summing attempt counts to find a
 * gap where a request quietly failed early.
 */
function errorWith(
	c: Context<Vars>,
	status: ContentfulStatusCode,
	args: { code: ErrorCode; message: string; docsUrl?: string },
	extra: Record<string, string> = {},
) {
	return c.json(
		errorBody({
			requestId: c.get('requestId'),
			code: args.code,
			message: args.message,
			...(args.docsUrl === undefined ? {} : { docsUrl: args.docsUrl }),
		}),
		status,
		{
			...(args.code in GATEWAY_ERROR_CODES ? {} : { 'X-Outcome': args.code }),
			'X-Outcome-Class': errorClassFor(args.code),
			'X-Attempts': '0',
			// Zero, spelled out, because `api.md` promises this header on every response and a
			// missing one is indistinguishable from a lost one. Nothing was tried, so nothing
			// was spent.
			'X-Cost-Estimate': '0.000000',
			...extra,
		},
	);
}

function headersFor(r: ChainResult, totalMs: number): Record<string, string> {
	// Spend across EVERY attempt, not just the winning one. A failover that cost two charged
	// hops and reports the price of one is the number that makes margin look better than it
	// is — see plan.md section 7's unbilled-spend metric.
	const total = r.attempts.reduce((n, a) => n + (a.costMicrocredits ?? 0), 0);
	return {
		'X-Outcome': r.outcome,
		// The coarse, CLOSED class. `X-Outcome` is open and will gain members as adapters land,
		// so a caller that branches on it breaks on our schedule. This one does not grow, and is
		// what integration code should switch on. See `OutcomeClass` in @proxlane/shared.
		'X-Outcome-Class': outcomeClass(r.outcome),
		'X-Attempts': String(r.attempts.length),
		'X-Cost-Estimate': (total / 1_000_000).toFixed(6),
		// Gateway time, provider time, and the total, split by subtraction. `operations.md`
		// section 1 gates p95 on `gw;dur=` specifically, because end-to-end time measures the
		// provider's afternoon rather than our routing.
		'Server-Timing': serverTimingHeader(splitTimings(totalMs, r.attempts)),
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
		// Seconds, per RFC 9110, and rounded UP: rounding a 1.4s wait down to 1 invites a
		// retry that is still too early, which re-arms the very cooldown being waited out.
		// Only set when the chain actually knows — a 503 with a guessed Retry-After is worse
		// than none, because a caller will believe it.
		...(r.retryAfterMs === undefined
			? {}
			: { 'Retry-After': String(Math.ceil(r.retryAfterMs / 1000)) }),
	};
}

export function createApp(deps: AppDeps): Hono<Vars> {
	const app = new Hono<Vars>();

	// FIRST, and on every route including /health. A support thread that starts "it returned
	// 401" is unanswerable without one, and `requests.id` in the log is this same value — so
	// the id a user pastes is the row a maintainer looks up.
	//
	// Echoes the caller's `X-Request-Id` when it is safe to (see `requestIdFrom`), so a client
	// with its own tracing keeps one id across both systems. Anything unusable is silently
	// replaced rather than rejected: refusing a request over a malformed trace header turns a
	// debugging aid into an outage.
	app.use('*', async (c, next) => {
		const id = requestIdFrom(c.req.header('x-request-id'));
		c.set('requestId', id);
		// Stamped in the middleware rather than the handler so it covers auth, parsing and the
		// edge guard too. Timing only the chain would exclude the gateway work most likely to
		// regress, and the whole point of the number is that it is ours.
		c.set('startedAt', performance.now());
		await next();
		c.header('X-Request-Id', id);
	});

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
		if (!keyMatches(presentedKey(c), deps.apiKey)) {
			return errorWith(c, 401, {
				code: 'UNAUTHORIZED',
				message: 'api_key missing or incorrect',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}
		if (deps.health === undefined) {
			// Honest 501 rather than an empty list. `{providers: []}` would read as "all fine".
			return errorWith(c, 501, {
				code: 'NOT_ENABLED',
				message: 'this gateway is running without health tracking',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}
		const now = Date.now();
		// Fail OPEN, like the routing path. This is the tool an operator reaches for when
		// something is wrong, so it must not be the one thing that breaks when the backing
		// store is unhealthy — which is exactly when they are using it. It used to 500.
		let states: Awaited<ReturnType<typeof deps.health.all>>;
		let degraded: string | undefined;
		try {
			states = await deps.health.all(now);
		} catch (err) {
			states = new Map();
			degraded = err instanceof Error ? err.message : String(err);
		}
		return c.json({
			// Present only when the store could not be read. Its absence is the healthy case,
			// and a caller that ignores it sees every provider as `healthy`, which is what
			// routing does too — so the endpoint and the router agree about a degraded store.
			...(degraded === undefined ? {} : { stateUnavailable: degraded }),
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

	// The cooldowns actually held right now.
	//
	// Cooldowns are ON by default and were the only routing mechanism with no way to see them:
	// `/health/providers` covers health, which ships off. An operator asking "why is one
	// provider never used" had to read source, and two reviews said so.
	//
	// Takes the key, like `/health/providers` and for the same reason: it names providers, and
	// it names the DOMAINS this deployment has been blocked on, which is more sensitive still.
	app.get('/health/cooldowns', async (c) => {
		if (!keyMatches(presentedKey(c), deps.apiKey)) {
			return errorWith(c, 401, {
				code: 'UNAUTHORIZED',
				message: 'api_key missing or incorrect',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}
		if (deps.cooldowns === undefined) {
			return errorWith(c, 501, {
				code: 'NOT_ENABLED',
				message: 'this gateway is running without cooldowns',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}
		const now = Date.now();
		let entries: Awaited<ReturnType<typeof deps.cooldowns.list>>;
		try {
			entries = await deps.cooldowns.list(now);
		} catch (err) {
			// Fails open like everything else that reads this state: a diagnostic must not be
			// the one thing that breaks when the store is unwell.
			return c.json({
				stateUnavailable: err instanceof Error ? err.message : String(err),
				cooling: [],
				expired: [],
			});
		}
		const shape = (e: (typeof entries)[number]) => {
			// `cd:blk:{provider}:{domain}` and `cd:acct:{org}:{provider}`. Parsed rather than
			// echoed, because "which namespace" is the answer an operator needs first: an
			// account cooldown has nothing to do with the domain they are debugging.
			const parts = e.key.split(':');
			const isBlk = parts[1] === 'blk';
			return {
				scope: isBlk ? ('domain' as const) : ('account' as const),
				provider: isBlk ? parts[2] : parts[3],
				...(isBlk ? { domain: parts.slice(3).join(':') } : { org: parts[2] }),
				expiresInMs: Math.max(0, e.untilMs - now),
				consecutive: e.consecutive,
				// True means the single post-expiry probe is out with a request right now.
				probeTaken: e.probeTaken,
			};
		};
		const cooling = entries.filter((e) => now < e.untilMs).map(shape);
		// Expired but still recorded. Not noise: `consecutive` is what makes the backoff
		// exponential, so these are the reason the NEXT cooldown on that key is longer.
		const expired = entries.filter((e) => now >= e.untilMs).map(shape);
		return c.json({ cooling, expired });
	});

	// Undefined means no ceiling. Constructed once at boot, so a bad value throws before the
	// server listens rather than on the first request that would have been shed.
	const limiter =
		deps.maxInflight === undefined ? undefined : new InflightLimiter(deps.maxInflight);

	const served = async (c: Context<Vars>) => {
		const url = c.req.query('url');
		if (url === undefined || url === '') {
			return errorWith(c, 400, {
				code: 'BAD_REQUEST',
				message: 'url is required',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}

		const renderRaw = c.req.query('render');
		const premiumRaw = c.req.query('premium') ?? 'none';
		if (premiumRaw !== 'none' && premiumRaw !== 'residential' && premiumRaw !== 'stealth') {
			return errorWith(c, 400, {
				code: 'BAD_REQUEST',
				message: 'premium must be none, residential or stealth',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}
		const countryCode = c.req.query('country_code');
		const forced = c.req.query('provider');

		// THE PER-REQUEST DEADLINE, which `integrations.md` section 5 has promised since the
		// budget arithmetic was written ("Clients set their own via the `timeout` param") and
		// which nothing read. Every request got `PROXLANE_DEADLINE_MS`, so a caller who wanted a
		// fast answer or no answer waited the full ninety seconds for a slow chain to finish.
		//
		// CAPPED AT THE SERVER'S OWN, never above it. A caller must be able to ask for less time
		// than the operator budgeted and never for more: the ceiling is what bounds how long one
		// request can hold an in-flight slot, and `maxInflight` is sized on the assumption that
		// it holds.
		//
		// Floored at MIN_USEFUL_ATTEMPT_MS rather than accepted and then failed. `hopBudget`
		// returns BUDGET_EXCEEDED below that floor without opening a connection, so `timeout=1`
		// would be a 504 that never tried anything — an error report where a 400 belongs.
		const timeoutRaw = c.req.query('timeout');
		let deadlineMs = deps.defaultDeadlineMs;
		if (timeoutRaw !== undefined && timeoutRaw !== '') {
			const asked = Number(timeoutRaw);
			if (!Number.isInteger(asked) || asked < MIN_USEFUL_ATTEMPT_MS) {
				return errorWith(c, 400, {
					code: 'BAD_REQUEST',
					message: `timeout must be a whole number of milliseconds, at least ${MIN_USEFUL_ATTEMPT_MS}`,
					...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
				});
			}
			deadlineMs = Math.min(asked, deps.defaultDeadlineMs);
		}

		// POST was reachable everywhere except here. `GatewayRequest` has carried `method` and
		// `body` since the contract landed, adapters declare a `post` capability, the chain
		// already filters on it and conformance tests it — and the surface hardcoded GET, so
		// none of it could be used.
		//
		// The body is read as TEXT, not parsed. Whatever the caller sends is what the target
		// gets; guessing at JSON versus form encoding here would corrupt one of them.
		let body: string | undefined;
		if (c.req.method === 'POST') {
			body = await c.req.text();
			// The same cap the RESPONSE uses, applied to the request. Without it a caller can
			// push an unbounded body through a gateway whose memory budget is sized on
			// `maxInflight * bodyCap * 2.5` — see operations.md section 1. Bytes, not
			// characters: a multi-byte body would otherwise pass a length check and blow the cap.
			const size = Buffer.byteLength(body, 'utf8');
			if (size > deps.maxBodyBytes) {
				return errorWith(c, 413, {
					code: 'RESPONSE_TOO_LARGE',
					message: `request body is ${size} bytes, over the ${deps.maxBodyBytes} cap`,
					...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
				});
			}
		}

		const req: GatewayRequest = {
			url,
			method: c.req.method === 'POST' ? 'POST' : 'GET',
			...(body === undefined ? {} : { body }),
			// Explicit, never inferred from presence: `render=false` must mean false, and the
			// absence of the parameter must mean false too. Treating presence as truth is how
			// `render=false` ends up rendering and billing 5x.
			renderJs: renderRaw === 'true' || renderRaw === '1',
			premium: premiumRaw,
			deadlineMs,
			...(countryCode === undefined ? {} : { countryCode }),
		};

		let candidates = deps.candidates;
		if (forced !== undefined) {
			// Benchmarking escape hatch from plan.md section 4.
			candidates = candidates.filter((x) => x.adapter.capabilities.id === forced);
			if (candidates.length === 0) {
				// NAMED HERE, because this is the only layer that knows the difference.
				//
				// Narrowing to nothing used to be left to the chain, on the grounds that
				// NO_PROVIDER_AVAILABLE is the right outcome either way — which it is. But the
				// chain sees an empty candidate list and reports "no providers configured", and
				// with four keys set that is false. `provider=scrapfly ` with a trailing space,
				// or a typo, sent the operator to check keys that were fine.
				//
				// The outcome is unchanged. Only the sentence is, and the sentence is the part a
				// human reads.
				const available = deps.candidates.map((x) => x.adapter.capabilities.id).sort();
				return errorWith(c, 503, {
					code: 'NO_PROVIDER_AVAILABLE',
					message:
						available.length === 0
							? `no provider "${forced}", and none is configured — set a provider key`
							: `no provider "${forced}". Configured: ${available.join(', ')}`,
					...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
				});
			}
		}

		const result = await runChain(req, {
			transport: deps.transport,
			candidates,
			maxBodyBytes: deps.maxBodyBytes,
			...(deps.health === undefined ? {} : { health: deps.health }),
			...(deps.cooldowns === undefined ? {} : { cooldowns: deps.cooldowns }),
			...(deps.orgId === undefined ? {} : { orgId: deps.orgId }),
			...(deps.terminalRetries === undefined ? {} : { terminalRetries: deps.terminalRetries }),
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
				...headersFor(result, performance.now() - c.get('startedAt')),
				'Content-Type': contentType,
			});
		}

		// No page to return, so say what happened rather than serving an empty 200. The
		// attempt list is included because the logged grain is the attempt: a caller debugging
		// a failover needs to see which providers were tried and what each said.
		return c.json(
			errorBody({
				requestId: c.get('requestId'),
				// The outcome IS the error code here. One vocabulary, whether the failure happened
				// at a provider or before we ever reached one.
				code: result.outcome,
				message: result.reason ?? policyFor(result.outcome).meaning,
				// The logged grain is the attempt: a caller debugging a failover needs to see which
				// providers were tried and what each said.
				attempts: result.attempts,
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			}),
			status as 502,
			headersFor(result, performance.now() - c.get('startedAt')),
		);
	};

	const handler = async (c: Context<Vars>) => {
		if (!keyMatches(presentedKey(c), deps.apiKey)) {
			// NOT an Outcome. The taxonomy describes what happened to a scrape; this request
			// never became one. Reusing AUTH_FAILED here would put gateway auth failures into
			// the provider health statistics.
			return errorWith(c, 401, {
				code: 'UNAUTHORIZED',
				message: 'api_key missing or incorrect',
				...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
			});
		}

		// SHED AFTER AUTH, AND ONLY ON `/v1`.
		//
		// After auth, because a slot is a scarce resource and an unauthenticated caller must
		// not be able to consume one. Shedding first would let anyone who can reach the port
		// fill the ceiling with junk and starve the operator's own traffic — turning
		// backpressure into the denial-of-service it exists to prevent. Auth is a hash and a
		// constant-time compare, so the ordering costs nothing worth measuring.
		//
		// Only `/v1` because this handler is only registered there. `/health` must answer
		// under load or the orchestrator restarts a gateway whose sole problem is that it is
		// busy, which converts a shed request into an outage.
		if (limiter !== undefined && !limiter.tryAcquire()) {
			const busyMs = performance.now() - c.get('startedAt');
			// The outcome, class and a zero attempt count come from `errorWith`, which is where
			// every error path gets them. This one adds the two that are its own.
			return errorWith(
				c,
				429,
				{
					code: 'GATEWAY_BUSY',
					message: `at the in-flight ceiling of ${limiter.max}; retry shortly`,
					...(deps.docsUrl === undefined ? {} : { docsUrl: deps.docsUrl }),
				},
				{
					'Retry-After': String(retryAfterSeconds()),
					// Emitted on the shed path too, so the soak's p95 covers requests the gateway
					// refused. Leaving them out would measure only the requests that got a slot,
					// which is the population that looks best.
					'Server-Timing': serverTimingHeader(splitTimings(busyMs, [])),
				},
			);
		}

		try {
			return await served(c);
		} finally {
			// FINALLY, not the success path. A throw that skipped this leaks a slot for the
			// lifetime of the process, and enough of them wedge the gateway at a ceiling it
			// never recovers from — a failure that is silent and reads exactly like load.
			limiter?.release();
		}
	};

	// Both verbs, one handler. GET is the drop-in surface; POST additionally forwards a body.
	// Registered explicitly rather than with `app.all`, so PUT and DELETE still 404 instead of
	// being silently treated as GET.
	app.get('/v1', handler);
	app.post('/v1', handler);

	return app;
}
