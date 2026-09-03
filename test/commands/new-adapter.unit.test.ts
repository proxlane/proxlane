// The generator's output has to COMPILE, not merely exist.
//
// "Four files were written" is the kind of assertion that passes while the scaffold is
// broken — the failure mode this repo keeps producing. So the real test typechecks the
// generated tree against the same tsconfig a real adapter uses.
//
// Everything happens in a temp directory via PROXLANE_ADAPTERS_DIR, so no test scaffolds a
// half-built adapter into packages/ and then deletes it.

import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Spawns a subprocess per case, so the unit of work is a process rather than a function call.
// vitest's 5s default was never chosen for that — it is what applies when nobody says
// otherwise, and it leaves a spawn almost no headroom. These have never failed in CI, where the
// runner is unloaded; they fail reliably on a developer machine that is also building something
// else, which is the case that matters, because that is where a false red costs someone an hour
// chasing a regression that is not there. The ceiling measures nothing: a few seconds each when
// the machine is idle.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let dir: string;

function generate(id: string, cwd = dir): { code: number; out: string } {
	try {
		const out = execFileSync(process.execPath, ['scripts/new-adapter.ts', id], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...process.env, PROXLANE_ADAPTERS_DIR: cwd },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'proxlane-adapter-'));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('pnpm new-adapter', () => {
	it('refuses an id that is not a safe directory / ProviderId / URL segment', () => {
		for (const bad of ['Bad Id', 'UPPER', '9leading', 'has_underscore', '../escape']) {
			const { code, out } = generate(bad);
			expect(code, `"${bad}" should have been rejected`).not.toBe(0);
			expect(out).toContain('invalid id');
		}
	});

	it('refuses to overwrite an existing adapter', () => {
		expect(generate('dupe').code).toBe(0);
		const second = generate('dupe');
		expect(second.code).not.toBe(0);
		expect(second.out).toContain('Refusing to overwrite');
	});

	it('scaffolds the five things section 8 promises', () => {
		expect(generate('acme').code).toBe(0);
		for (const f of ['capabilities.ts', 'schema.ts', 'index.ts', 'fixtures/README.md']) {
			expect(existsSync(join(dir, 'acme', f)), f).toBe(true);
		}
		expect(existsSync(join(dir, 'registry.ts')), 'conformance registration').toBe(true);
	});

	it('registers each adapter exactly once, appending rather than replacing', () => {
		generate('alpha');
		generate('beta');
		const registry = readFileSync(join(dir, 'registry.ts'), 'utf8');
		expect(registry).toContain("'./alpha/index.js'");
		expect(registry).toContain("'./beta/index.js'");
		// Re-running must not duplicate the entry.
		generate('alpha');
		expect(registry.match(/\.\/alpha\/index\.js/g)?.length).toBe(1);
	});

	it('leaves stubs that THROW, never stubs that return something plausible', () => {
		generate('thrower');
		const src = readFileSync(join(dir, 'thrower', 'index.ts'), 'utf8');
		expect(src).toContain('translate is not implemented');
		expect(src).toContain('parse is not implemented');
		// A stub returning a default ParsedResult would let an unfinished adapter pass
		// conformance silently, which is the whole failure this repo is built against.
		expect(src).not.toMatch(/return\s*\{\s*outcome/);
	});

	it('generates code that actually typechecks', () => {
		generate('compiles');
		// Same compiler options a real adapter is held to, pointed at the temp tree. The
		// contract and zod resolve from the real workspace.
		// Without "type": "module" nodenext resolves the temp tree as CommonJS and rejects
		// every export — a harness artifact that looks exactly like a generator bug.
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
		// pnpm's isolated layout puts zod under packages/adapters/node_modules, not the
		// root — which is exactly where a real adapter resolves it from.
		if (!existsSync(join(dir, 'node_modules'))) {
			symlinkSync(
				join(ROOT, 'packages/adapters/node_modules'),
				join(dir, 'node_modules'),
				'dir',
			);
		}
		writeFileSync(
			join(dir, 'tsconfig.json'),
			JSON.stringify({
				extends: join(ROOT, 'tooling/tsconfig/node.json'),
				compilerOptions: {
					noEmit: true,
					typeRoots: [join(ROOT, 'node_modules/@types')],
				},
				include: ['compiles/**/*.ts', 'contract.ts'],
			}),
		);
		// contract.js resolves relatively from the generated file, so mirror it into place.
		writeFileSync(
			join(dir, 'contract.ts'),
			readFileSync(join(ROOT, 'packages/adapters/src/contract.ts'), 'utf8'),
		);

		let code = 0;
		let out = '';
		try {
			out = execFileSync(
				join(ROOT, 'node_modules/.bin/tsc'),
				['--noEmit', '-p', join(dir, 'tsconfig.json')],
				{ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
			);
		} catch (err) {
			const e = err as { status?: number; stdout?: string };
			code = e.status ?? -1;
			out = e.stdout ?? '';
		}
		expect(code, `generated adapter does not compile:\n${out}`).toBe(0);
	});
});
