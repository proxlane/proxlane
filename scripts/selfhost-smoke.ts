// `pnpm selfhost:smoke` — can a stranger actually run this?
//
// Half of phase 1's definition of done, and the half that is easy to fake. The claim in
// plan.md is "a stranger self-hosts in under five minutes", so this builds the image from a
// CLEAN CONTEXT, brings it up, drives the real HTTP surface, and times the whole thing
// against that number. A smoke test that reuses a warm dist proves the developer's machine
// works, which nobody was asking about.
//
// It asserts the full stack WITHOUT needing a provider key, because most people running
// this for the first time will not have set one up yet — and a smoke test that only passes
// with credentials is a smoke test that mostly does not run. Auth, query parsing, the
// chain, the edge guard and the response mapping are all reachable with no provider at all.
// If a key IS present it additionally does one real scrape.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '-f', 'docker/compose.yml', '-p', 'proxlane-smoke'];
/** plan.md's claim, in milliseconds. Failing this is a real failure, not a slow machine. */
const BUDGET_MS = 5 * 60 * 1000;
const PORT = 8799;
const API_KEY = 'smoke-only-not-a-real-key';

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

function step(name: string): void {
	process.stdout.write(`  ${elapsed().padStart(7)}  ${name}\n`);
}

function compose(args: string[], opts: { quiet?: boolean; health?: string } = {}): void {
	const r = spawnSync('docker', [...COMPOSE, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: opts.quiet === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		env: {
			...process.env,
			PORT: String(PORT),
			PROXLANE_API_KEY: API_KEY,
			// Deliberately NOT setting PROXLANE_HEALTH: the point of this command is the
			// configuration a stranger actually gets. Turning it on here was a mistake caught by
			// a verification panel — PR 12 exists because "no check starts the shipped compose
			// file", and overriding a default reintroduces exactly that gap one layer up.
			//
			// The health-on path is covered below by a second stack, so both are real.
			...(opts.health === undefined ? {} : { PROXLANE_HEALTH: opts.health }),
		},
	});
	if (r.status !== 0) {
		throw new Error(
			`docker ${args.join(' ')} failed${r.stderr ? `: ${r.stderr.slice(0, 400)}` : ''}`,
		);
	}
}

function teardown(): void {
	// Always, even on failure. A smoke test that leaves containers running turns the second
	// run into a port conflict, which then looks like a product bug.
	spawnSync('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], {
		cwd: ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, PORT: String(PORT), PROXLANE_API_KEY: API_KEY },
	});
}

async function waitForHealth(timeoutMs: number): Promise<void> {
	const until = Date.now() + timeoutMs;
	let lastError = 'never responded';
	while (Date.now() < until) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/health`);
			if (r.ok) return;
			lastError = `status ${r.status}`;
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`gateway never became healthy: ${lastError}`);
}

interface Check {
	readonly what: string;
	readonly run: () => Promise<void>;
}

async function expectStatus(path: string, want: number, what: string): Promise<void> {
	const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
	if (r.status !== want) {
		throw new Error(`${what}: expected ${want}, got ${r.status}`);
	}
}

try {
	if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
		process.stderr.write('\n  docker is not running. selfhost:smoke needs it.\n\n');
		process.exit(2);
	}

	process.stdout.write('\n  self-host smoke — clean build, real container, real HTTP\n\n');
	teardown();

	// --no-cache is the point. Reusing layers tests the machine that already built it, and
	// the claim being verified is about a machine that never has.
	step('building the image from a clean context');
	compose(['build', '--no-cache'], { quiet: true });

	step('starting');
	compose(['up', '-d'], { quiet: true });

	step('waiting for the healthcheck');
	await waitForHealth(90_000);

	const checks: Check[] = [
		{
			what: '/health answers without a key',
			run: () => expectStatus('/health', 200, 'health'),
		},
		{
			what: 'a request with no key is refused',
			run: () => expectStatus('/v1?url=https://example.com/', 401, 'missing key'),
		},
		{
			what: 'a request with the wrong key is refused',
			run: () => expectStatus(`/v1?api_key=wrong&url=https://example.com/`, 401, 'wrong key'),
		},
		{
			what: 'a missing url is a 400, not an empty scrape',
			run: () => expectStatus(`/v1?api_key=${API_KEY}`, 400, 'missing url'),
		},
		{
			// The default deployment shipped BROKEN and this command deployed it and passed.
			// `compose.yml` set PROXLANE_VALKEY_URL to an empty string, the gateway built a
			// Redis client for it, and this endpoint 500'd on every call while the boot banner
			// claimed shared state. Nothing noticed, because the smoke test only exercised the
			// surface that existed before health and cooldowns did.
			// The DEFAULT answer. 501 rather than an empty list, because a gateway with health
			// off has no opinion at all, which is a different statement from "all fine".
			what: 'health is off by default, and says so rather than pretending',
			run: async () => {
				const r = await fetch(`http://127.0.0.1:${PORT}/health/providers?api_key=${API_KEY}`);
				if (r.status !== 501) {
					throw new Error(`/health/providers returned ${r.status}, expected 501 by default`);
				}
			},
		},
		{
			what: '/health/providers refuses without a key, unlike /health',
			run: () => expectStatus('/health/providers', 401, 'providers without a key'),
		},
		{
			// The whole stack with no provider involved: auth, parsing, the chain, the edge
			// guard, and the status mapping. This is what makes the smoke meaningful for
			// someone who has not signed up for anything yet.
			what: 'the edge guard refuses cloud metadata, in the deployed image',
			run: () =>
				expectStatus(
					`/v1?api_key=${API_KEY}&url=${encodeURIComponent('http://169.254.169.254/')}`,
					403,
					'edge guard',
				),
		},
	];

	step('driving the API');
	for (const c of checks) {
		await c.run();
		process.stdout.write(`           ok  ${c.what}\n`);
	}

	// Only if the operator has a key. Reported either way, so a run that skipped it cannot
	// be mistaken for a run that did it.
	const provider = ['SCRAPERAPI_KEY', 'SCRAPINGBEE_KEY', 'SCRAPFLY_KEY'].find(
		(v) => process.env[v] !== undefined && process.env[v] !== '',
	);
	if (provider === undefined) {
		process.stdout.write(
			'           --  no provider key set, so no real scrape was attempted.\n' +
				'               Everything above is the deployed image; a real fetch is not.\n',
		);
	} else {
		process.stdout.write(`           ..  real scrape via $${provider}\n`);
		const r = await fetch(
			`http://127.0.0.1:${PORT}/v1?api_key=${API_KEY}&url=${encodeURIComponent('https://httpbin.dev/html')}`,
		);
		const outcome = r.headers.get('x-outcome');
		if (!r.ok || outcome !== 'OK') {
			throw new Error(`real scrape returned ${r.status} / ${outcome ?? 'no outcome header'}`);
		}
		process.stdout.write(
			`           ok  real scrape: 200 OK via ${r.headers.get('x-provider-used')}\n`,
		);
	}

	// A SECOND stack, with health on. The original defect — an empty PROXLANE_VALKEY_URL
	// producing a Redis client that logged ECONNREFUSED forever and 500'd — is only visible
	// when something actually reads the state store, and nothing does with health off.
	//
	// Separate run rather than an override on the first, because the first has to be the
	// configuration a stranger gets, unmodified.
	step('restarting with PROXLANE_HEALTH=on');
	teardown();
	compose(['up', '-d'], { quiet: true, health: 'on' });
	await waitForHealth(90_000);
	{
		const r = await fetch(`http://127.0.0.1:${PORT}/health/providers?api_key=${API_KEY}`);
		if (r.status !== 200)
			throw new Error(`/health/providers returned ${r.status} with health on`);
		const body = (await r.json()) as { providers?: unknown[]; stateUnavailable?: string };
		if (!Array.isArray(body.providers)) throw new Error('no providers array in the response');
		if (body.stateUnavailable !== undefined) {
			// Reachable but unhealthy is worse than absent: the deployment is configured to use
			// a store it cannot talk to. This is the assertion the original bug would have failed.
			throw new Error(`state store unreachable: ${body.stateUnavailable}`);
		}
		process.stdout.write('           ok  with health on, the state store is reachable\n');
	}

	const total = Date.now() - started;
	if (total > BUDGET_MS) {
		// The five minutes is a claim in plan.md, not an aspiration. Blowing it is a failure.
		throw new Error(`took ${(total / 1000).toFixed(0)}s, over the ${BUDGET_MS / 1000}s claim`);
	}
	process.stdout.write(
		`\n  self-host works: clean build to serving in ${(total / 1000).toFixed(0)}s ` +
			`(claim is under ${BUDGET_MS / 60000} minutes)\n\n`,
	);
} catch (err) {
	process.stderr.write(
		`\n  FAILED after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}\n`,
	);
	// The container's own account of what went wrong beats anything this script can infer.
	const logs = spawnSync('docker', [...COMPOSE, 'logs', '--tail', '30', 'gateway'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, PORT: String(PORT), PROXLANE_API_KEY: API_KEY },
	});
	if (logs.stdout) process.stderr.write(`\n  gateway logs:\n${logs.stdout}\n`);
	teardown();
	process.exit(1);
}
teardown();
