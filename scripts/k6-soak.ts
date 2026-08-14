// `pnpm k6:soak` — the launch gate from `operations.md` section 9, end to end.
//
// Starts the mock provider and the real gateway, runs k6 against them, samples the gateway's
// RSS throughout, and asserts three things:
//
//   p95 of `Server-Timing: gw;dur=` under 50 ms   the gate itself
//   no sustained RSS growth after minute 10       the leak check
//   the ceiling sheds with GATEWAY_BUSY           backpressure actually works
//
// WHERE THIS RUNS IS STILL AN OWNER DECISION, and running it does not settle it. The
// deployment box sits at roughly 66% CPU and 51% IO pressure during normal scrape windows,
// and a gateway-internal p95 measured there is measuring the neighbours: the metric excludes
// network but fully includes event-loop starvation. What this harness removes is the OTHER
// half of that problem — provider variance — so the number now depends only on the machine.
// Run it somewhere quiet, or restate the threshold. `docs/state.md` tracks the decision.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(ROOT, 'test/k6/harness.ts');
// Taken from argv, not hardcoded, so the root script names it: `repo:check` assertion 2
// requires a command to reference the subject its manifest entry points at, and a path buried
// in here would let the two drift apart silently.
const SCRIPT = resolve(ROOT, process.argv[2] ?? 'test/k6/soak.js');

const PORT = Number(process.env.SOAK_PORT ?? 8899);
const KEY = process.env.PROXLANE_KEY ?? 'soak';
const MAX_INFLIGHT = Number(process.env.SOAK_MAX_INFLIGHT ?? 32);
const VUS = process.env.SOAK_VUS ?? '50';
const DURATION = process.env.SOAK_DURATION ?? '30m';
/** The gate. Not configurable: a threshold you can pass in is a threshold that gets raised. */
const P95_BUDGET_MS = 50;
/** RSS is sampled every this many ms. */
const RSS_INTERVAL_MS = 5_000;
/**
 * The leak check ignores everything before this point, and does not run at all on a shorter run.
 *
 * `test/k6/README.md` specified "an RSS slope threshold from minute 10" and it is not an
 * arbitrary warm-up allowance: a Node process under load grows for several minutes while the
 * heap finds its working size and the JIT tiers up. Measured here, a 110-second run showed
 * 1.73 MB/min of pure warm-up and failed a gateway with no leak at all.
 *
 * A short run therefore REPORTS the slope and does not assert on it. Asserting on a number
 * that is meaningless at that duration is how a check gets a reputation for crying wolf, and
 * a check nobody believes is worse than no check.
 */
const RSS_SETTLE_MS = 10 * 60_000;

function fail(message: string): never {
	process.stderr.write(`\n${message}\n\n`);
	process.exit(1);
}

/**
 * k6 is a Go binary, not an npm package.
 *
 * The npm `k6` is a 0.0.0 placeholder, which is why the pinned-toolchain table has no row for
 * it — a row needs an assertion behind it, and `repo:check` shelling out to `k6 version`
 * would fail from a clean clone. So its absence is reported here, by the one command that
 * needs it, rather than being a mysterious spawn error.
 */
function requireK6(): string {
	const probe = spawnSync('k6', ['version'], { encoding: 'utf8' });
	if (probe.error !== undefined || probe.status !== 0) {
		fail(
			'  k6 is not installed, and this command cannot run without it.\n\n' +
				'    macOS    brew install k6\n' +
				'    Linux    https://grafana.com/docs/k6/latest/set-up/install-k6/\n\n' +
				'  It is a Go binary rather than an npm package, which is why `pnpm install`\n' +
				'  does not provide it and why it has no row in the toolchain table.',
		);
	}
	return (probe.stdout || '').trim().split('\n')[0] ?? 'k6';
}

/**
 * Least-squares slope of RSS over the samples, in MB per minute.
 *
 * Fitted only over samples at or after `from`, which the caller sets to the settle point.
 */
function rssSlopeMbPerMin(
	samples: readonly { t: number; rssMb: number }[],
	from: number,
): number | undefined {
	const tail = samples.filter((p) => p.t >= from);
	if (tail.length < 4) return undefined;
	const n = tail.length;
	const meanT = tail.reduce((s, p) => s + p.t, 0) / n;
	const meanR = tail.reduce((s, p) => s + p.rssMb, 0) / n;
	let num = 0;
	let den = 0;
	for (const p of tail) {
		num += (p.t - meanT) * (p.rssMb - meanR);
		den += (p.t - meanT) ** 2;
	}
	if (den === 0) return undefined;
	return (num / den) * 60_000; // per ms -> per minute
}

function rssMb(pid: number): number | undefined {
	// `ps` rather than reading the harness's own `process.memoryUsage()`: the number that
	// matters is what the OS thinks the process holds, which is what an OOM killer acts on.
	const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
	if (out.status !== 0) return undefined;
	const kb = Number((out.stdout || '').trim());
	return Number.isFinite(kb) && kb > 0 ? kb / 1024 : undefined;
}

const version = requireK6();
if (!existsSync(SCRIPT)) fail(`  ${SCRIPT} is missing.`);

process.stdout.write(
	`\n  ${version}\n` +
		`  ${VUS} VUs for ${DURATION}, ceiling ${MAX_INFLIGHT}, against a local mock provider\n` +
		`  gate: p95 of Server-Timing gw;dur under ${P95_BUDGET_MS} ms\n\n`,
);

// ---------------------------------------------------------------- the gateway under test

const harness = spawn('node', [HARNESS, String(PORT), KEY, String(MAX_INFLIGHT)], {
	cwd: ROOT,
	stdio: ['ignore', 'pipe', 'pipe'],
});
let harnessLog = '';
harness.stdout.on('data', (d: Buffer) => {
	harnessLog += d.toString();
});
harness.stderr.on('data', (d: Buffer) => {
	harnessLog += d.toString();
});

const stop = () => {
	if (harness.exitCode === null) harness.kill('SIGTERM');
};
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		stop();
		process.exit(130);
	});
}

// Wait for it to answer rather than sleeping a guessed interval.
const started = Date.now();
let ready = false;
while (Date.now() - started < 30_000) {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/health`);
		if (res.ok) {
			ready = true;
			break;
		}
	} catch {
		// Not up yet.
	}
	await new Promise((r) => setTimeout(r, 200));
}
if (!ready) {
	stop();
	fail(`  the harness never became ready on :${PORT}\n\n${harnessLog}`);
}

const samples: { t: number; rssMb: number }[] = [];
const sampler = setInterval(() => {
	const mb = rssMb(harness.pid ?? 0);
	if (mb !== undefined) samples.push({ t: Date.now(), rssMb: mb });
}, RSS_INTERVAL_MS);
// NOT unref'd. It has to hold the loop while k6 runs, which is the whole point.

// ---------------------------------------------------------------- the run

// SPAWNED, NOT spawnSync. The first version used the synchronous form and the RSS sampler
// never fired once: `spawnSync` blocks the event loop for the entire run, so every timer is
// frozen until k6 exits. The leak check reported "not enough samples" on a 110-second run and
// looked like a threshold that had not been reached yet.
const k6 = spawn('k6', ['run', '--quiet', SCRIPT], {
	cwd: ROOT,
	stdio: ['ignore', 'pipe', 'inherit'],
	env: {
		...process.env,
		PROXLANE_URL: `http://127.0.0.1:${PORT}`,
		PROXLANE_KEY: KEY,
		SOAK_VUS: VUS,
		SOAK_DURATION: DURATION,
		SOAK_MAX_INFLIGHT: String(MAX_INFLIGHT),
	},
});
let stdout = '';
k6.stdout.on('data', (d: Buffer) => {
	stdout += d.toString();
});
const status = await new Promise<number>((r) => k6.on('close', (code) => r(code ?? 1)));
clearInterval(sampler);
stop();

process.stdout.write(stdout.replace(/PROXLANE_SOAK_SUMMARY .*/g, '').trimEnd());

const line = /PROXLANE_SOAK_SUMMARY (\{.*\})/.exec(stdout);
if (line?.[1] === undefined) {
	fail(`  k6 produced no summary. Exit ${status}.\n\n${harnessLog}`);
}

interface Summary {
	gatewayMs: {
		p95: number | null;
		p99: number | null;
		max: number | null;
		count: number | null;
	};
	shedMsP95: number | null;
	requests: number | null;
	shed: number | null;
	checksPassed: number | null;
	outcomes: Record<string, number>;
}
const summary = JSON.parse(line[1]) as Summary;
const runStart = samples[0]?.t ?? Date.now();
const settled = runStart + RSS_SETTLE_MS;
const longEnough = samples.some((p) => p.t >= settled);
const slope = rssSlopeMbPerMin(samples, longEnough ? settled : runStart);
const failures: string[] = [];

// ---------------------------------------------------------------- the assertions

// A run that measured nothing must never pass. This is the zero-denominator rule: a soak
// whose Server-Timing sample is empty would otherwise report a p95 of null and exit 0.
if ((summary.gatewayMs.count ?? 0) < 100) {
	failures.push(
		`only ${summary.gatewayMs.count ?? 0} Server-Timing samples — the run measured nothing`,
	);
}
if (summary.gatewayMs.p95 === null || summary.gatewayMs.p95 > P95_BUDGET_MS) {
	failures.push(
		`gateway p95 is ${summary.gatewayMs.p95 ?? 'unknown'} ms, over the ${P95_BUDGET_MS} ms gate`,
	);
}
// 0.5 MB/min over a 30-minute run is 15 MB, which is noise on a Node process; a real leak
// under this load shows up an order of magnitude above it.
if (!longEnough) {
	// Reported, not asserted. See RSS_SETTLE_MS.
	process.stdout.write(
		`  NOTE: the run is shorter than ${RSS_SETTLE_MS / 60_000} minutes, so the RSS slope below\n` +
			'        is warm-up and is not asserted on. Use the full duration for the leak check.\n',
	);
} else if (slope !== undefined && slope > 0.5) {
	failures.push(
		`RSS is growing ${slope.toFixed(2)} MB/min after minute ${RSS_SETTLE_MS / 60_000}`,
	);
} else if (slope === undefined) {
	failures.push('no RSS samples after the settle point — the leak check did not run');
}
if ((summary.shed ?? 0) === 0) {
	failures.push(
		'the burst scenario never saw a 429 — either the ceiling is not enforced, or the burst ' +
			'was not oversubscribed enough to reach it',
	);
}
if ((summary.checksPassed ?? 0) < 0.99) {
	failures.push(`only ${((summary.checksPassed ?? 0) * 100).toFixed(1)}% of checks passed`);
}

process.stdout.write(
	`\n  requests        ${summary.requests ?? 0}\n` +
		`  gateway p95     ${summary.gatewayMs.p95?.toFixed(2) ?? '?'} ms   (gate ${P95_BUDGET_MS})\n` +
		`  gateway p99     ${summary.gatewayMs.p99?.toFixed(2) ?? '?'} ms\n` +
		`  gateway max     ${summary.gatewayMs.max?.toFixed(2) ?? '?'} ms\n` +
		`  shed p95        ${summary.shedMsP95?.toFixed(2) ?? '?'} ms   (refusing must stay cheap)\n` +
		`  RSS slope       ${slope === undefined ? 'not enough samples' : `${slope.toFixed(2)} MB/min`}${longEnough ? '' : ' (warm-up, not asserted)'}\n` +
		`  shed (429)      ${summary.shed ?? 0}\n` +
		`  outcomes        ${JSON.stringify(summary.outcomes)}\n\n`,
);

if (failures.length > 0) {
	process.stderr.write(`  ${failures.length} FAILURE(S):\n`);
	for (const f of failures) process.stderr.write(`    - ${f}\n`);
	process.stderr.write('\n');
	process.exit(1);
}
if (status !== 0) {
	fail(`  k6 exited ${status} — a threshold in soak.js failed.`);
}
process.stdout.write('  soak passed\n\n');
