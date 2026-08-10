// The CLI's contract with a PROGRAM: exit codes, JSON shape, and no colour when nobody is
// looking. Those three are the whole reason an agent can use this, so they are the tests.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { doctor } from './doctor.js';
import { outcomes } from './outcomes.js';
import { colorEnabled, EXIT, style } from './output.js';
import { providers } from './providers.js';

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
		expect(data).toHaveLength(16);
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
