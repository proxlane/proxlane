// Named manifest.unit.test.ts, NOT contract.test.ts.
//
// `contract.test.ts` would match the `contract` vitest project, which no implemented
// command invokes — leaving `unit` with zero files and `pnpm test:unit` failing its own
// passWithNoTests: false. The obvious filename is a trap.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Spawns a subprocess per case, so the unit of work is a process rather than a function call.
// vitest's 5s default was never chosen for that — it is what applies when nobody says
// otherwise, and it leaves a spawn almost no headroom. These have never failed in CI, where the
// runner is unloaded; they fail reliably on a developer machine that is also building something
// else, which is the case that matters, because that is where a false red costs someone an hour
// chasing a regression that is not there. The ceiling measures nothing: a few seconds each when
// the machine is idle.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Entry = {
	id: string;
	kind: 'root-script' | 'filtered-script' | 'bin';
	owner: string;
	spec: string;
	subject: string;
	status: 'implemented' | 'not-implemented';
	ci: 'pr' | 'none';
};

const manifest = JSON.parse(
	readFileSync(join(ROOT, 'scripts/commands.json'), 'utf8'),
) as Record<string, Entry | unknown>;

const entries = Object.entries(manifest).filter(([k]) => !k.startsWith('$')) as [
	string,
	Entry,
][];
const stubs = entries.filter(([, e]) => e.status === 'not-implemented');

const cliPkg = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
const cliBin = String(cliPkg.bin.proxlane);

/** Run a stub the way a user actually would.
 *
 *  `kind: bin` entries must go through the built binary, not the harness. The bin ships
 *  standalone to npm and cannot read scripts/commands.json at runtime, so it carries its
 *  own copy of the message — which means testing the harness for it would prove nothing
 *  about the code that actually runs. repo:check asserts the two copies agree.
 *
 *  Everything else goes through the harness directly rather than `pnpm <id>`: that would
 *  spawn a package-manager process per test, and for `test:unit` it would recurse into
 *  this very file. */
function runStub(id: string, kind: Entry['kind']): { code: number; stderr: string } {
	// Resolve the bin from packages/cli's own `bin` field rather than node_modules/.bin.
	// pnpm links bins at install time, but the target only exists after build — so on a
	// clean clone the symlink is missing and the test would fail for a bootstrap reason
	// rather than a real one. The published tarball ships dist/, so real installs are fine.
	const [cmd, args] =
		kind === 'bin'
			? [process.execPath, [join(ROOT, 'packages/cli', cliBin), ...id.split(' ').slice(1)]]
			: [process.execPath, ['scripts/not-implemented.ts', id]];
	try {
		execFileSync(cmd as string, args as string[], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, stderr: '' };
	} catch (err) {
		const e = err as { status?: number; stderr?: string };
		return { code: e.status ?? -1, stderr: e.stderr ?? '' };
	}
}

describe('the honest-stub contract', () => {
	// The set legitimately empties when the last stub flips to implemented, which is the
	// one documented exemption from the non-zero-denominator rule. The floor lives on the
	// implemented set instead — see below.
	it.runIf(stubs.length > 0).each(stubs)('%s exits non-zero and names its owner', (id, e) => {
		const { code, stderr } = runStub(id, e.kind);

		// Not 0: a zero-exit stub satisfies eleven agent briefs by the letter while having
		// built nothing, and two of these commands are launch gates.
		expect(code, `${id} exited 0 — a stub must fail honestly`).not.toBe(0);
		// Not 127 either: that reads as "command not found", which is the false claim being
		// refuted. The command IS wired.
		expect(code, `${id} exited 127 — reads as "not wired", but it is`).not.toBe(127);
		expect(code).toBe(1);

		expect(stderr).toContain('NOT IMPLEMENTED');
		expect(stderr, `${id} must name its owning agent`).toContain(e.owner);
		expect(stderr, `${id} must name its subject`).toContain(e.subject);
	});

	it('every stub cites a doc that exists on disk', () => {
		expect(stubs.length + entries.length).toBeGreaterThan(0);
		for (const [id, e] of stubs) {
			const file = (e.spec.split('#')[0] ?? '').trim();
			expect(file, `${id} has no spec file`).not.toBe('');
			expect(
				readFileSync(join(ROOT, file), 'utf8').length,
				`${id} cites ${file}, which is empty or missing`,
			).toBeGreaterThan(0);
		}
	});
});

describe('the manifest itself', () => {
	// This is the non-zero floor. It can never legitimately be empty, so it is never exempt.
	it('has implemented commands, and each subject exists on disk', () => {
		const impl = entries.filter(([, e]) => e.status === 'implemented');
		expect(impl.length, 'zero implemented commands cannot be right').toBeGreaterThan(0);
		for (const [id, e] of impl) {
			expect(e.subject, `${id} has no subject`).toBeTruthy();
			// Existence, not just truthiness. Flipping a stub to "implemented" without
			// building it removes that id from the stub set, so the parameterised block
			// above simply runs one fewer case — it shrinks silently rather than failing.
			// This is what makes `pnpm test:unit` go red on a false flip, not just
			// `repo:check`. Without it the two disagree, and the cheaper check is the one
			// someone runs.
			expect(
				existsSync(join(ROOT, e.subject)),
				`${id} is marked implemented but ${e.subject} does not exist`,
			).toBe(true);
		}
	});

	it('never marks a persistent command for the CI matrix', () => {
		// `dev` is persistent. In the matrix it hangs the build rather than failing it.
		expect(manifest.dev).toBeDefined();
		expect((manifest.dev as Entry).ci).toBe('none');
	});

	it('no root-script id collides with a pnpm built-in', () => {
		// `setup` is the live example: pnpm dispatches built-ins before falling through to
		// `run`, so the script would never execute — pnpm's own setup would, appending to
		// the contributor's shell profile and exiting 0.
		const builtins = new Set([
			'setup',
			'install',
			'run',
			'test',
			'publish',
			'init',
			'add',
			'remove',
			'exec',
			'dlx',
			'why',
			'link',
			'pack',
			'patch',
			'prune',
			'root',
			'bin',
			'store',
			'start',
			'update',
			'audit',
			'config',
			'deploy',
			'env',
			'fetch',
			'import',
			'licenses',
			'list',
			'outdated',
			'rebuild',
			'server',
			'unlink',
			'create',
			'dedupe',
			'doctor',
		]);
		const collisions = entries
			.filter(([id, e]) => e.kind === 'root-script' && builtins.has(id))
			.map(([id]) => id);
		expect(collisions, 'these can never be invoked as `pnpm <id>`').toEqual([]);
	});
});
