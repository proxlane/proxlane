// The soak. `operations.md` section 9's launch gate, as a runnable thing.
//
// THE GATE IS p95 OF GATEWAY-INTERNAL TIME, not end-to-end. Section 1 is explicit: measured
// "from a `Server-Timing: gw;dur=` header the router emits, NOT from end-to-end request
// time". End-to-end is dominated by the provider, so gating on it would measure a vendor's
// afternoon and would move when nothing in this repo changed.
//
// That header did not exist when this file was first specified, which is why the harness
// could not be written: a soak measuring end-to-end latency against a mock measures nothing
// at all. It exists now.
//
// Plain JS, not TypeScript: k6 runs a Go-embedded JS runtime, not Node.

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.PROXLANE_URL || 'http://127.0.0.1:8899';
const KEY = __ENV.PROXLANE_KEY || 'soak';
const VUS = Number(__ENV.SOAK_VUS || 50);
const DURATION = __ENV.SOAK_DURATION || '30m';
const CEILING = Number(__ENV.SOAK_MAX_INFLIGHT || 32);

/**
 * Gateway-internal milliseconds on requests the gateway actually SERVED. The gate reads this.
 *
 * SHED REQUESTS ARE EXCLUDED, and that exclusion is the difference between a real gate and a
 * decorative one. A shed request is refused before a provider is chosen: no translate, no
 * fetch, no parse, no detection — roughly 0.02 ms of work. In the first run of this harness
 * 709k of 741k responses were `GATEWAY_BUSY`, so they were 95% of the sample and dragged the
 * p95 to 0.00 ms. The gate would have passed no matter how slow real routing became.
 *
 * The cost of shedding is still measured, in `shed_ms` below, because it also has to stay
 * cheap: an expensive refusal under overload is how a busy gateway falls over.
 */
const gatewayMs = new Trend('gateway_ms');
/** Gateway time on responses the ceiling refused. Should be a rounding error. */
const shedMs = new Trend('shed_ms');
/** Provider time, tracked only so the split can be eyeballed for plausibility. */
const upstreamMs = new Trend('upstream_ms');
const shed = new Counter('shed_gateway_busy');
/**
 * How many responses actually carried a parseable `Server-Timing`.
 *
 * A Trend has no `count` in k6's summary — only avg/min/med/max/percentiles — so without this
 * there is no denominator, and the runner's "did this measure anything" check read a missing
 * field as zero and failed a run that had in fact measured 1.3 million requests.
 */
const timed = new Counter('gateway_timed');

/**
 * Outcome tallies, as k6 Counters.
 *
 * A plain object does NOT work: each VU runs in its own isolate, and `handleSummary` runs in
 * yet another, so a module-level object is per-VU and always arrives empty. Metrics are the
 * only state k6 aggregates across them, and they must be created at init time — hence a fixed
 * list rather than one created on first sight.
 */
const OUTCOMES = [
	'OK',
	'SOFT_BLOCK',
	'PROVIDER_ERROR',
	'RATE_LIMITED',
	'TARGET_NOT_FOUND',
	'RESPONSE_TOO_LARGE',
	'GATEWAY_BUSY',
	'BUDGET_EXCEEDED',
	'NO_PROVIDER_AVAILABLE',
];
const outcomeCounters = {};
for (const name of OUTCOMES) outcomeCounters[name] = new Counter(`outcome_${name}`);
/** Anything not in the list above, which would mean the taxonomy grew and this did not. */
const outcomeOther = new Counter('outcome_OTHER');

/**
 * The traffic mix.
 *
 * Weighted towards success because that is what production looks like, but every failure
 * path is present in every minute of the run. A soak that only exercises the happy path
 * measures the cheapest code in the process and reports it as the p95.
 */
const MIX = [
	{ path: 'ok', weight: 60 },
	{ path: 'blocked', weight: 15 }, // 200 + challenge page: the detector's path, and a failover
	{ path: 'error', weight: 10 }, // 5xx: failover through the whole chain
	{ path: 'notfound', weight: 8 }, // a real answer, no failover
	{ path: 'ratelimited', weight: 5 }, // 429 from the provider, with Retry-After
	{ path: 'slow', weight: 2 }, // holds a slot open, which is what makes the ceiling bite
];
const TOTAL_WEIGHT = MIX.reduce((n, m) => n + m.weight, 0);

function pickPath() {
	let r = Math.random() * TOTAL_WEIGHT;
	for (const m of MIX) {
		r -= m.weight;
		if (r <= 0) return m.path;
	}
	return 'ok';
}

export const options = {
	scenarios: {
		// The measurement. Constant VUs, so the arrival rate follows the gateway's own speed
		// and the run cannot queue up an unbounded backlog the way constant-arrival-rate does.
		soak: {
			executor: 'constant-vus',
			vus: VUS,
			duration: DURATION,
			gracefulStop: '30s',
		},
		// A separate, deliberately oversubscribed burst that exists only to prove the ceiling
		// sheds. Kept out of the soak scenario so its 429s do not pollute the latency mix.
		burst: {
			executor: 'constant-vus',
			vus: Math.max(4, CEILING * 2),
			duration: '30s',
			startTime: '60s',
			exec: 'burst',
			gracefulStop: '10s',
		},
	},
	thresholds: {
		// THE GATE, on served requests only.
		gateway_ms: ['p(95)<50'],
		// Refusing must stay far cheaper than serving, or the gateway gets slower exactly when
		// it is under the most pressure.
		shed_ms: ['p(95)<5'],
		// Not http_req_failed: 502s and 429s are correct answers here, and a threshold on them
		// would fail the run for the gateway behaving exactly as designed.
		checks: ['rate>0.99'],
	},
	// p(99) is not one of k6's default summary statistics, and asking for a value it does not
	// compute returns null rather than erroring.
	summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
	noConnectionReuse: false,
	userAgent: 'proxlane-soak/1',
};

function record(res) {
	const timing = res.headers['Server-Timing'] || res.headers['server-timing'] || '';
	const gw = /gw;dur=([\d.]+)/.exec(timing);
	const up = /up;dur=([\d.]+)/.exec(timing);
	// A response with no Server-Timing is a REGRESSION, not a datapoint to skip. Silently
	// ignoring it would let the header disappear and the gate keep passing on a shrinking
	// sample, which is the failure mode that makes a green run meaningless.
	const present = gw !== null;
	const outcome = res.headers['X-Outcome'] || res.headers['x-outcome'] || 'NONE';
	if (present) {
		if (outcome === 'GATEWAY_BUSY') shedMs.add(Number(gw[1]));
		else {
			gatewayMs.add(Number(gw[1]));
			timed.add(1);
		}
	}
	if (up !== null) upstreamMs.add(Number(up[1]));

	if (outcomeCounters[outcome] !== undefined) outcomeCounters[outcome].add(1);
	else outcomeOther.add(1);
	return present;
}

export default function soak() {
	const path = pickPath();
	const res = http.get(`${BASE}/v1?api_key=${KEY}&url=https://target.invalid/${path}`, {
		tags: { mode: path },
	});
	const timed = record(res);
	// HONOUR Retry-After, the way a client should. Without this a shed VU loops instantly on a
	// response that costs the gateway 0.02 ms, and one burst window produced 600,000 429s that
	// buried every other number in the run. A client that ignores backpressure is a real thing,
	// but modelling only that client makes the whole soak a measurement of the refusal path.
	if (res.status === 429) sleep(0.2);
	check(res, {
		'carries Server-Timing': () => timed,
		'carries an outcome class': (r) =>
			(r.headers['X-Outcome-Class'] || r.headers['x-outcome-class'] || '') !== '',
		'never 500s': (r) => r.status !== 500,
	});
}

export function burst() {
	const res = http.get(`${BASE}/v1?api_key=${KEY}&url=https://target.invalid/slow`, {
		tags: { mode: 'burst' },
	});
	record(res);
	if (res.status === 429) shed.add(1);
	// A shed response returns in microseconds, so without this the burst VUs spin and produce
	// hundreds of thousands of 429s that drown every other metric in the run.
	sleep(0.05);
	check(res, {
		// A 429 must be OUR 429, not a provider's leaking through. The class is what separates
		// them: GATEWAY_BUSY is `gateway`, a provider's cap is `provider`.
		'429s are GATEWAY_BUSY': (r) =>
			r.status !== 429 || (r.headers['X-Outcome'] || r.headers['x-outcome']) === 'GATEWAY_BUSY',
		'shed responses say when to retry': (r) =>
			r.status !== 429 || (r.headers['Retry-After'] || r.headers['retry-after']) !== undefined,
		'never 500s': (r) => r.status !== 500,
	});
}

/** Written to stdout as JSON so the runner can assert on it without parsing k6's own output. */
export function handleSummary(data) {
	const metric = (name, stat) => {
		const m = data.metrics[name];
		return m && m.values ? m.values[stat] : null;
	};
	const outcomes = {};
	for (const name of OUTCOMES) {
		const n = metric(`outcome_${name}`, 'count');
		if (n) outcomes[name] = n;
	}
	const other = metric('outcome_OTHER', 'count');
	if (other) outcomes.OTHER = other;

	const summary = {
		gatewayMs: {
			p95: metric('gateway_ms', 'p(95)'),
			p99: metric('gateway_ms', 'p(99)'),
			avg: metric('gateway_ms', 'avg'),
			max: metric('gateway_ms', 'max'),
			// From the Counter, not the Trend: a Trend reports no count.
			count: metric('gateway_timed', 'count'),
		},
		shedMsP95: metric('shed_ms', 'p(95)'),
		upstreamMsAvg: metric('upstream_ms', 'avg'),
		requests: metric('http_reqs', 'count'),
		shed: metric('shed_gateway_busy', 'count'),
		checksPassed: metric('checks', 'rate'),
		outcomes,
	};
	return { stdout: `\nPROXLANE_SOAK_SUMMARY ${JSON.stringify(summary)}\n` };
}
