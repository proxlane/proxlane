// The CLI's contract with a PROGRAM: exit codes, JSON shape, and no colour when nobody is
// looking. Those three are the whole reason an agent can use this, so they are the tests.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTCOMES } from '@proxlane/adapters';
import { describe, expect, it, vi } from 'vitest';
import { doctor } from './doctor.js';
import { outcomes } from './outcomes.js';
import { colorEnabled, EXIT, style } from './output.js';
import { providers } from './providers.js';

// Spawns a subprocess per case, so the unit of work is a process rather than a function call.
// vitest's 5s default was never chosen for that — it is what applies when nobody says
// otherwise, and it leaves a spawn almost no headroom. These have never failed in CI, where the
// runner is unloaded; they fail reliably on a developer machine that is also building something
// else, which is the case that matters, because that is where a false red costs someone an hour
// chasing a regression that is not there. The ceiling measures nothing: a few seconds each when
// the machine is idle.
vi.setConfig({ testTimeout: 60_000 });

// The BUILT bin, not the source. Node's type stripping does not rewrite a `.js` specifier
// to `.ts`, so `node src/bin.ts` cannot resolve its own imports — and testing the source
// would test a thing no user ever runs. This is what `npx proxlane` executes.
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/bin.mjs');
if (!existsSync(BIN)) {
	// Loud, not skipped. A skip would turn "the CLI was never built" into a green run, which
	// is the vacuous pass this repo is arranged against.
	throw new Error(`${BIN} does not exist — run \`pnpm build\` before \`pnpm test:unit\``);
}
// Built rather than written as a literal: a regex containing a control character trips
// biome's noControlCharactersInRegex, and it is right that an ESC byte in source is worth
// objecting to. What we are asserting is simply that no ANSI sequence reached the caller.
// Named once. Inline, `'--provider=scraperapi', '<anything quoted>'` reads to gitleaks'
// generic-api-key rule as an api key assignment and fails the secret scan. Naming it also
// happens to read better, which is the usual sign the restructure was the right fix rather
// than an allowlist entry.
const SCRAPERAPI = '--provider=scraperapi';

const ESC = new RegExp(`${String.fromCharCode(27)}\\[`);

/** Run the real bin and capture everything a caller can observe. */
function run(args: string[], env: Record<string, string | undefined> = {}) {
	const merged: Record<string, string> = {};
	for (const [k, v] of Object.entries({ ...process.env, ...env })) {
		if (v !== undefined) merged[k] = v;
	}
	try {
		const out = execFileSync(process.execPath, [BIN, ...args], {
			encoding: 'utf8',
			env: merged,
			stdio: ['ignore', 'pipe', 'pipe'],
			// cwd matters: bin.ts loads .env.local relative to it, and the repo's own would
			// make the missing-key test below pass for the wrong reason.
			cwd: '/',
		});
		return { code: 0, stdout: out, stderr: '' };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
	}
}

/** Capture what a command writes to stdout without spawning. */
async function capture(fn: () => Promise<number> | number): Promise<[number, string]> {
	const chunks: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	(process.stdout as { write: unknown }).write = (c: string) => {
		chunks.push(String(c));
		return true;
	};
	try {
		const code = await fn();
		return [code, chunks.join('')];
	} finally {
		(process.stdout as { write: unknown }).write = original;
	}
}

describe('exit codes, which are public API', () => {
	it('0 when the answer is good', () => {
		expect(run(['--version']).code).toBe(EXIT.OK);
		expect(run(['outcomes', '--json']).code).toBe(EXIT.OK);
	});

	it('2 for a wrong invocation, distinguished from a bad answer', () => {
		expect(run(['bogus']).code).toBe(EXIT.USAGE);
		expect(run(['scrape', '--provider=x']).code).toBe(EXIT.USAGE);
		expect(run(['scrape', 'https://x.test/']).code).toBe(EXIT.USAGE);
		expect(run(['scrape', 'https://x.test/', '--provider=nope']).code).toBe(EXIT.USAGE);
	});

	it('3 when the environment is wrong, not 2 — fix the setup, not the call', () => {
		const r = run(['scrape', 'https://x.test/', SCRAPERAPI, '--json'], {
			SCRAPERAPI_KEY: undefined,
		});
		expect(r.code).toBe(EXIT.CONFIG);
		expect(JSON.parse(r.stderr).error.code).toBe('MISSING_KEY');
	});

	it('rejects a bad --premium and a bad --timeout before spending anything', () => {
		const withFlag = (flagArg: string) =>
			run(['scrape', 'https://x.test/', SCRAPERAPI, flagArg]).code;
		expect(withFlag('--premium=gold')).toBe(EXIT.USAGE);
		expect(withFlag('--timeout=soon')).toBe(EXIT.USAGE);
	});
});

describe('--json is a contract, not a formatting option', () => {
	it('puts a parseable envelope on STDOUT and nothing else', () => {
		const r = run(['outcomes', '--json']);
		const env = JSON.parse(r.stdout);
		expect(env.ok).toBe(true);
		expect(env.command).toBe('outcomes');
		expect(Array.isArray(env.data)).toBe(true);
	});

	it('puts a parseable envelope on STDERR when it fails', () => {
		// A caller doing `proxlane x --json | jq` must still be able to read the failure.
		const r = run(['bogus', '--json']);
		expect(() => JSON.parse(r.stderr)).not.toThrow();
		expect(JSON.parse(r.stderr)).toMatchObject({
			ok: false,
			error: { code: 'UNKNOWN_COMMAND' },
		});
	});

	it('never leaks help text onto stdout in --json mode', () => {
		expect(run(['bogus', '--json']).stdout).toBe('');
	});

	it('emits every outcome with the fields a retry decision needs', async () => {
		const [code, out] = await capture(() => outcomes([], true));
		expect(code).toBe(EXIT.OK);
		const { data } = JSON.parse(out);
		// Derived from the union, not a literal. A hardcoded count goes stale the moment an
		// outcome is added, and then the test that exists to prove the CLI lists them ALL is
		// the thing asserting it lists an outdated number.
		expect(data).toHaveLength(OUTCOMES.length);
		for (const d of data) {
			expect(d).toHaveProperty('failover');
			expect(d).toHaveProperty('chargeable');
			expect(d).toHaveProperty('httpStatus');
			expect(d).toHaveProperty('cooldown');
		}
	});

	it('rejects an unknown outcome by NAMING the valid set', () => {
		// Saves the caller a round trip, which is B9's thesis applied to arguments.
		const r = run(['outcomes', 'NOT_A_THING']);
		expect(r.code).toBe(EXIT.USAGE);
		expect(r.stderr).toContain('SOFT_BLOCK');
	});
});

describe('output discipline', () => {
	it('disables colour for NO_COLOR with ANY value, including empty', () => {
		// no-color.org specifies presence, not truthiness. Checking truthiness would leave
		// `NO_COLOR=` colourised, which is exactly the bare form people set.
		expect(colorEnabled({ NO_COLOR: '' })).toBe(false);
		expect(colorEnabled({ NO_COLOR: '0' })).toBe(false);
	});

	it('emits no escape codes when colour is off', () => {
		expect(style('x', 'red', false)).toBe('x');
		expect(run(['outcomes'], { NO_COLOR: '' }).stdout).not.toMatch(ESC);
	});

	it('is plain by default in a pipe, because a captured log is the common case', () => {
		expect(run(['providers']).stdout).not.toMatch(ESC);
	});
});

describe('outcomes says what to DO, not only what happened', () => {
	// The policy fields answer what the GATEWAY does. None of them answers the caller's only
	// question, and `failover: true` actively misleads: on a blocked outcome it means proxlane
	// already tried every provider, so a reader who takes it as "retryable" pays twice for the
	// same answer.
	const one = async (name: string) => {
		const [, out] = await capture(() => outcomes([name, '--json'], true));
		return (
			JSON.parse(out) as {
				data: { outcome: string; action: string; what: string; docs: string }[];
			}
		).data[0];
	};

	it('tells a blocked caller NOT to retry immediately, despite failover: true', async () => {
		const d = await one('SOFT_BLOCK');
		expect(d?.action).toBe('Retry later');
		expect(d?.what).toMatch(/blocked again/);
	});

	it('tells a target answer never to be retried', async () => {
		expect((await one('TARGET_NOT_FOUND'))?.action).toBe('Do not retry');
	});

	it('links to a page that exists, per outcome class', async () => {
		// docs:check proves the path and the anchor resolve; this proves the shape reaches the
		// caller, and that the anchor tracks the class rather than being a constant.
		expect((await one('SOFT_BLOCK'))?.docs).toBe('https://proxlane.dev/docs/outcomes#blocked');
		expect((await one('TARGET_NOT_FOUND'))?.docs).toBe(
			'https://proxlane.dev/docs/outcomes#target',
		);
	});

	it('carries advice for every outcome, with no gaps', async () => {
		// The reason CLASS_ADVICE is `satisfies Record<OutcomeClass, …>`: the old copy was a
		// `Record<string, …>` and a new class rendered nothing at all.
		const [, out] = await capture(() => outcomes(['--json'], true));
		const rows = (JSON.parse(out) as { data: { action?: string; docs?: string }[] }).data;
		expect(rows.length).toBe(OUTCOMES.length);
		expect(rows.filter((r) => !r.action || !r.docs)).toHaveLength(0);
	});

	it('prints the remedy in the human output too', async () => {
		const [, out] = await capture(() => outcomes(['SOFT_BLOCK'], false));
		expect(out).toMatch(/Retry later\./);
		expect(out).toContain('proxlane.dev/docs/outcomes#blocked');
	});
});

describe('doctor', () => {
	it('reports what it CHECKED, not merely pass or fail', async () => {
		// operating.md B9: "Postgres: ok" is useless in an issue thread. Every check must
		// carry the observation that answers the follow-up question.
		const [, out] = await capture(() => doctor(true));
		const { data } = JSON.parse(out);
		expect(data.checks.length).toBeGreaterThan(0);
		for (const c of data.checks) {
			expect(c.detail, `${c.name} has no detail`).toBeTruthy();
			expect(c.detail).not.toBe('ok');
		}
	});

	it('never prints a key, only its length', async () => {
		const [, out] = await capture(() => doctor(true));
		const key = process.env.SCRAPERAPI_KEY;
		if (key !== undefined && key !== '') expect(out).not.toContain(key);
		expect(out).toMatch(/SCRAPERAPI_KEY (set \(\d+ chars\)|not set)/);
	});

	it('fails when NO key is set, because then nothing routes at all', async () => {
		// The per-key checks are `ok` when absent, for the reason the next test states. Applied
		// to *every* key that reasoning produced "13 checks, all good" for a gateway that
		// cannot serve one request — a green diagnostic on a broken install, in the tool whose
		// job is answering the first support question.
		const keys = ['SCRAPERAPI_KEY', 'SCRAPINGBEE_KEY', 'SCRAPFLY_KEY', 'BRIGHTDATA_KEY'];
		const saved = keys.map((k) => [k, process.env[k]] as const);
		for (const k of keys) delete process.env[k];
		try {
			const [, out] = await capture(() => doctor(true));
			const { data } = JSON.parse(out);
			const agg = data.checks.find((c: { name: string }) => c.name === 'providers');
			expect(agg, 'no aggregate providers check').toBeDefined();
			expect(agg.ok).toBe(false);
			expect(agg.fix, 'a failing check must say what to do').toBeTruthy();
		} finally {
			for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
		}
	});

	it('says nothing about the aggregate when at least one key is set', async () => {
		const saved = process.env.SCRAPERAPI_KEY;
		process.env.SCRAPERAPI_KEY = 'x'.repeat(32);
		try {
			const [, out] = await capture(() => doctor(true));
			const { data } = JSON.parse(out);
			const agg = data.checks.find((c: { name: string }) => c.name === 'providers');
			expect(agg, 'the aggregate check should not appear once a key exists').toBeUndefined();
		} finally {
			if (saved === undefined) delete process.env.SCRAPERAPI_KEY;
			else process.env.SCRAPERAPI_KEY = saved;
		}
	});

	it('treats a missing BYOK key as information, not failure', async () => {
		// Reporting it as broken trains people to ignore the output, which is how a
		// diagnostic stops being read. Nobody is expected to hold all three keys.
		const [, out] = await capture(() => doctor(true));
		const { data } = JSON.parse(out);
		for (const c of data.checks.filter((x: { name: string }) => x.name.startsWith('key:'))) {
			expect(c.ok).toBe(true);
		}
	});
});

describe('doctor knows about routing state', () => {
	// Two operator reviews had to ask for these. `operating.md` B9's rule — every support
	// question that takes more than one exchange becomes a check — was not followed when
	// health, cooldowns and Valkey shipped, and the first question they produced was one this
	// command could not answer.

	const withEnv = async (vars: Record<string, string | undefined>) => {
		const saved: Record<string, string | undefined> = {};
		for (const [k, v] of Object.entries(vars)) {
			saved[k] = process.env[k];
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		try {
			const [, out] = await capture(() => doctor(true));
			return JSON.parse(out) as {
				data: { checks: { name: string; ok: boolean; detail: string; fix?: string }[] };
			};
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	};
	const find = (r: Awaited<ReturnType<typeof withEnv>>, name: string) =>
		r.data.checks.find((c) => c.name === name);

	it('names an EMPTY PROXLANE_VALKEY_URL as unset, which is the case that shipped', async () => {
		// `${VAR:-}` in compose sets the variable to an empty string. A gateway reading
		// `!== undefined` built a Redis client for `''` and logged ECONNREFUSED for its whole
		// life. One line here instead of one support thread.
		const r = await withEnv({ PROXLANE_VALKEY_URL: '' });
		expect(find(r, 'state store')?.detail).toMatch(/set but empty/);
	});

	it('says where routing state lives, because it decides what a restart costs', async () => {
		const off = await withEnv({ PROXLANE_VALKEY_URL: undefined });
		expect(find(off, 'state store')?.detail).toMatch(/in-process/);
		const on = await withEnv({ PROXLANE_VALKEY_URL: 'redis://example.test:6379' });
		expect(find(on, 'state store')?.detail).toMatch(/valkey at/);
	});

	it('never prints credentials from the connection string', async () => {
		const r = await withEnv({ PROXLANE_VALKEY_URL: 'redis://user:hunter2@example.test:6379' });
		const detail = find(r, 'state store')?.detail ?? '';
		expect(detail).not.toContain('hunter2');
		expect(detail).toContain('REDACTED');
	});

	it('fails when replicas exceed what the state backing can support', async () => {
		// The misconfiguration the gateway refuses to boot on. Better to learn it from doctor
		// than from a crash loop.
		const r = await withEnv({ PROXLANE_REPLICAS: '3', PROXLANE_VALKEY_URL: undefined });
		const c = find(r, 'replicas');
		expect(c?.ok).toBe(false);
		expect(c?.fix).toMatch(/PROXLANE_VALKEY_URL/);
	});

	it('accepts several replicas once state is shared', async () => {
		const r = await withEnv({
			PROXLANE_REPLICAS: '3',
			PROXLANE_VALKEY_URL: 'redis://example.test:6379',
		});
		expect(find(r, 'replicas')?.ok).toBe(true);
	});

	it('rejects a replica count it cannot parse, rather than reading it as one', async () => {
		const r = await withEnv({ PROXLANE_REPLICAS: 'two' });
		const c = find(r, 'replicas');
		expect(c?.ok).toBe(false);
		expect(c?.fix).toMatch(/positive number/);
	});

	it('states the health default, which is not guessable', async () => {
		const off = await withEnv({ PROXLANE_HEALTH: undefined });
		expect(find(off, 'provider health')?.detail).toMatch(/off \(the default\)/);
		const on = await withEnv({ PROXLANE_HEALTH: 'on' });
		expect(find(on, 'provider health')?.detail).toMatch(/^on\b/);
	});

	it('states the cooldown default too, and that it is the opposite one', async () => {
		const on = await withEnv({ PROXLANE_COOLDOWNS: undefined });
		expect(find(on, 'cooldowns')?.detail).toMatch(/^on\b/);
		const off = await withEnv({ PROXLANE_COOLDOWNS: 'off' });
		expect(find(off, 'cooldowns')?.detail).toMatch(/OFF/);
	});

	it('states the terminal retry and the two outcomes it applies to', async () => {
		const on = await withEnv({ PROXLANE_TERMINAL_RETRIES: undefined });
		const detail = find(on, 'terminal retry')?.detail ?? '';
		expect(detail).toMatch(/PROVIDER_ERROR and PROVIDER_TIMEOUT/);
		// The billing half of the answer. "Why two charges for one request" is the support
		// question this exists to end, and it cannot be ended without naming the headers.
		expect(detail).toMatch(/X-Cost-Estimate/);
		const off = await withEnv({ PROXLANE_TERMINAL_RETRIES: '0' });
		expect(find(off, 'terminal retry')?.detail).toMatch(/^off\b/);
	});

	it('says whether there is any failover at all, which the retry count alone does not', async () => {
		// The question an operator does not know to ask. With one key the first hop IS the
		// terminal hop, so the whole failover story in the README does not apply to them.
		const one = await withEnv({
			SCRAPERAPI_KEY: 'k',
			SCRAPINGBEE_KEY: undefined,
			SCRAPFLY_KEY: undefined,
			BRIGHTDATA_KEY: undefined,
		});
		expect(find(one, 'terminal retry')?.detail).toMatch(/ONE provider key/);
		const two = await withEnv({
			SCRAPERAPI_KEY: 'k',
			SCRAPINGBEE_KEY: 'k',
			SCRAPFLY_KEY: undefined,
			BRIGHTDATA_KEY: undefined,
		});
		expect(find(two, 'terminal retry')?.detail).toMatch(/2 provider keys/);
	});

	it('warns when one provider is configured and the retry is switched off', async () => {
		// Nothing is misconfigured, so it stays `ok` — but that combination means a single
		// transient provider error fails the request outright, with no second chance anywhere.
		const r = await withEnv({
			PROXLANE_TERMINAL_RETRIES: '0',
			SCRAPERAPI_KEY: 'k',
			SCRAPINGBEE_KEY: undefined,
			SCRAPFLY_KEY: undefined,
			BRIGHTDATA_KEY: undefined,
		});
		expect(find(r, 'terminal retry')?.ok).toBe(true);
		expect(find(r, 'terminal retry')?.fix).toMatch(/Add a second provider key/);
	});

	it('fails a retry count it cannot use, rather than reading it as the default', async () => {
		const r = await withEnv({ PROXLANE_TERMINAL_RETRIES: '99' });
		const c = find(r, 'terminal retry');
		expect(c?.ok).toBe(false);
		expect(c?.fix).toMatch(/between 0 and 10/);
	});

	it('reports an unreachable store as a FAILURE, not a note', async () => {
		// Port 1 refuses immediately on every platform. The distinction that matters is
		// "misconfigured" versus "Valkey is unwell", and an operator cannot act without it.
		const r = await withEnv({ PROXLANE_VALKEY_URL: 'redis://127.0.0.1:1' });
		const c = find(r, 'valkey reachable');
		expect(c?.ok).toBe(false);
		expect(c?.fix, 'must say the gateway still serves').toMatch(/fails OPEN/);
	});

	it('does not check reachability when no store is configured', async () => {
		// A check reporting "ok" for a component that does not exist is the zero-exit stub in
		// another costume, which this file's own header forbids.
		const r = await withEnv({ PROXLANE_VALKEY_URL: undefined });
		expect(find(r, 'valkey reachable')).toBeUndefined();
	});
});

describe('providers', () => {
	it('lists every registered adapter with the fields the router filters on', async () => {
		const [code, out] = await capture(() => providers(true));
		expect(code).toBe(EXIT.OK);
		const { data } = JSON.parse(out);
		expect(data.length).toBeGreaterThan(0);
		for (const p of data) {
			for (const f of ['renderJs', 'premiumTiers', 'maxTimeoutMs', 'countryCodes', 'cost']) {
				expect(p, `${p.id} missing ${f}`).toHaveProperty(f);
			}
			// Naming the env var removes the commonest support question entirely.
			expect(p.keyEnvVar).toMatch(/^[A-Z0-9_]+_KEY$/);
		}
	});
});

describe('--version', () => {
	it('reports the package version, not a hardcoded literal', () => {
		// It reported 0.0.0 from a package published as 0.0.1 — the CLI lying about itself in
		// the first field anyone checks when filing a bug, and guaranteed to drift again on
		// every release.
		const pkg = JSON.parse(
			readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
		) as { version: string };
		expect(run(['--version']).stdout.trim()).toBe(pkg.version);
	});

	it('is the same version --help advertises', () => {
		const pkg = JSON.parse(
			readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
		) as { version: string };
		expect(run(['--help']).stdout).toContain(`proxlane ${pkg.version}`);
	});
});

describe('help', () => {
	it('documents every exit code the CLI can actually return', () => {
		const help = run(['--help']).stdout;
		for (const c of Object.values(EXIT)) expect(help).toContain(`  ${c}  `);
	});

	it('documents every command it dispatches', () => {
		const help = run(['--help']).stdout;
		for (const c of ['scrape', 'providers', 'outcomes', 'doctor']) expect(help).toContain(c);
	});
});
