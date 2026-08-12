// Does repo:check actually fail when the thing it checks is wrong?
//
// This exists because the recurring defect in this repo has not been a check that is
// missing — it is a check that LOOKS like it is working and is not. An assertion with zero
// cases hidden inside another assertion's count. A test spawning the wrong binary. A type
// guard that only guards half the cases. Every one of those passed a green build.
//
// So: break something on purpose, assert repo:check goes red, put it back.
//
// Mutations are always reverted in afterEach, and only ever touch files this test wrote a
// backup of first.

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Runs repo:check and returns its exit code AND its output. */
function repoCheck(): { code: number; out: string } {
	try {
		const out = execFileSync(process.execPath, ['scripts/repo-check.ts'], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

/**
 * Assert repo:check went red, and that the reason is EXACTLY the one we caused.
 *
 * Anchored, full-line matchers only — no alternations, no `.*` standing in for a value we
 * could simply assert. Two earlier versions of this file failed that bar:
 *
 *   - `/table says .*, catalog says|catalog:/` — the second branch matched almost any
 *     output mentioning the catalog, so it passed regardless of which assertion fired.
 *   - a bulk regex rewrite whose non-greedy `.*?` spanned call boundaries under DOTALL and
 *     silently paired the catalog matcher with the conformance mutation.
 *
 * A matcher that cannot distinguish the failure it names from a different one is a
 * formality, not a test.
 */
function expectRedBecause(reason: RegExp, note: string): void {
	const { code, out } = repoCheck();
	expect(code, `${note}: repo:check stayed green`).not.toBe(0);
	expect(out, `${note}: went red, but not for the expected reason`).toMatch(reason);
}

const backups: string[] = [];

/** Mutate a tracked file, having first stashed a byte-exact copy beside it. */
function mutate(relPath: string, transform: (text: string) => string): void {
	const abs = join(ROOT, relPath);
	copyFileSync(abs, `${abs}.teeth-bak`);
	backups.push(relPath);
	const before = readFileSync(abs, 'utf8');
	const after = transform(before);
	// A no-op transform means the anchor string has drifted, and the assertion below would
	// then run against an unmutated repo. Without this the test reports "stayed green" and
	// looks like a broken check rather than a stale fixture.
	expect(after, `${relPath}: mutation changed nothing — the anchor has drifted`).not.toBe(
		before,
	);
	writeFileSync(abs, after);
}

afterEach(() => {
	while (backups.length > 0) {
		const rel = backups.pop() as string;
		const abs = join(ROOT, rel);
		copyFileSync(`${abs}.teeth-bak`, abs);
		rmSync(`${abs}.teeth-bak`);
	}
});

describe('repo:check goes red when it should', () => {
	it('is green to begin with, or nothing below means anything', () => {
		expect(repoCheck().code).toBe(0);
	});

	it('catches an ownership row naming a file that does not exist', () => {
		// The defect: CLAUDE.md owned `.github/workflows/release.yml` from the scaffold, the
		// file was never written, operating.md B8 described its behaviour in the present
		// tense, and 22 changesets accumulated behind a publish path that did not exist.
		// Nothing failed, because assertion 4 checks the opposite direction — that every
		// tracked file has an owner.
		mutate('CLAUDE.md', (t) =>
			t.replace(
				'| `/AGENTS.md` |',
				'| `/does-not-exist.md` | invented | oss-maintainer |\n| `/AGENTS.md` |',
			),
		);
		expectRedBecause(
			/owns \/does-not-exist\.md, which does not exist/,
			'an owned phantom file',
		);
	});

	it('catches a published health figure drifting from the simulation', () => {
		// The defect this exists for: the published detection delay was the REJECTED
		// estimator's result, carried into two files as a claim about the shipped one, under a
		// sentence telling the reader the numbers were measured. The sim is deterministic, so
		// it was always a one-command check — nobody ran it.
		mutate('docs/integrations.md', (t) =>
			t.replace(/is demoted at\n {2}\*\*[\d,]+\*\*/, 'is demoted at\n  **877**'),
		);
		expectRedBecause(/does not quote incident_demote_median/, 'a stale detection-delay figure');
	});

	it('catches a retired figure being reintroduced by value', () => {
		mutate('docs/integrations.md', (t) => `${t}\n\nOne false demote per ~54M observations.\n`);
		expectRedBecause(/retired figure "~54M"/, 'a resurrected retired figure');
	});

	it('catches a dependency edge pointing UP a layer', () => {
		// Assertion 20 exists because the graph was inverted for months and nothing noticed:
		// `shared`, the base layer, depended on `adapters`, a leaf. turbo only complains once
		// a cycle is COMPLETE, so a one-way inversion builds cleanly and stays invisible until
		// someone closes it, by which point the fix is a refactor rather than a deletion.
		//
		// The mutation restores exactly that edge.
		mutate('packages/shared/package.json', (t) => {
			const j = JSON.parse(t);
			j.dependencies = { ...j.dependencies, '@proxlane/adapters': 'workspace:*' };
			return `${JSON.stringify(j, null, '\t')}\n`;
		});
		expectRedBecause(
			/@proxlane\/shared \(layer 1\) depends on @proxlane\/adapters \(layer 2\)/,
			'shared depending on adapters',
		);
	});

	it('catches a package with no declared layer at all', () => {
		// The other half. A new package that nobody classified would otherwise be exempt from
		// the rule, which is the same shape as a check whose denominator is zero.
		mutate('packages/detect/package.json', (t) =>
			t.replace('"@proxlane/detect"', '"@proxlane/unclassified"'),
		);
		expectRedBecause(
			/@proxlane\/unclassified has no layer in repo-check assertion 20/,
			'an unclassified package',
		);
	});

	it('catches a command flipped to implemented without being built', () => {
		// Structural, not textual: inserting a second "status" key produced a duplicate that
		// JSON.parse silently resolved to the LAST occurrence, so the mutation was a no-op
		// and the test failed looking like a broken check.
		//
		// The victim is chosen at RUNTIME rather than named. This test used to flip
		// `conformance`, and broke the day conformance was actually built — the mutation
		// became a no-op, the drift guard fired, and the failure read like a broken check
		// rather than a stale fixture. Any entry still awaiting its subject will do.
		const manifest = JSON.parse(
			readFileSync(join(ROOT, 'scripts/commands.json'), 'utf8'),
		) as Record<string, { status?: string; subject?: string }>;
		const victim = Object.entries(manifest).find(
			([k, v]) => !k.startsWith('$') && v.status === 'not-implemented',
		);
		if (victim === undefined) {
			// EXEMPT, and documented: this half of assertion 2 legitimately empties when the
			// last stub flips. Asserting anything here then would be asserting on nothing.
			expect(true).toBe(true);
			return;
		}
		const [id, entry] = victim;
		mutate('scripts/commands.json', (t) => {
			const m = JSON.parse(t);
			m[id].status = 'implemented';
			return `${JSON.stringify(m, null, '\t')}\n`;
		});
		const escaped =
			`${id}: status=implemented but subject ${entry.subject} does not exist`.replace(
				/[.*+?^${}()|[\]\\/]/g,
				'\\$&',
			);
		expectRedBecause(
			new RegExp(`^ {2}\\[2\\] ${escaped}$`, 'm'),
			`${id} flipped without being built`,
		);
	});

	it('catches a hand-edited CODEOWNERS', () => {
		mutate('.github/CODEOWNERS', (t) => t.replace('@scarsam', '@someone-else'));
		expectRedBecause(
			/^ {2}\[3\] \.github\/CODEOWNERS differs from the ownership table — regenerate it$/m,
			'hand-edited CODEOWNERS',
		);
	});

	it('catches a dependency pinned outside the catalog', () => {
		mutate('packages/adapters/package.json', (t) =>
			t.replace('"typescript": "catalog:"', '"typescript": "^5.9.3"'),
		);
		expectRedBecause(
			/^ {2}\[11\] packages\/adapters: typescript@\^5\.9\.3 is a literal — every npm dependency routes through catalog:$/m,
			'pinned outside the catalog',
		);
	});

	it('catches the Base UI package that resolves cleanly and is wrong', () => {
		mutate('packages/ui/package.json', (t) =>
			t.replace(
				'"devDependencies": {',
				'"devDependencies": {\n    "@base-ui-components/react": "1.0.0-rc.0",',
			),
		);
		expectRedBecause(
			/^ {2}\[11\] packages\/ui names @base-ui-components\/react — abandoned at 1\.0\.0-rc\.0, use @base-ui\/react$/m,
			'the abandoned Base UI package',
		);
	});

	it('catches a compose image drifting from the constants', () => {
		mutate('docker/compose.dev.yml', (t) => t.replace('pgvector/pgvector:pg17', 'postgres:16'));
		expectRedBecause(
			/^ {2}\[8\] compose\.dev\.yml uses postgres:16, which is not a table row$/m,
			'compose image drift',
		);
	});

	it('catches state.md exceeding its own declared cap', () => {
		mutate('docs/state.md', (t) => t + '\nfiller\n'.repeat(30));
		expectRedBecause(
			/^ {2}\[13\] docs\/state\.md is \d+ lines against its own 50-line cap$/m,
			'state.md over its cap',
		);
	});

	it('catches a B6 job deleted from the CI workflow', () => {
		mutate('.github/workflows/ci.yml', (t) =>
			t.replace(/^ {2}secrets:$/m, '  secrets-disabled:'),
		);
		expectRedBecause(
			/^ {2}\[15\] B6 rows covered by neither the manifest nor a named CI job: secrets$/m,
			'a B6 job removed',
		);
	});

	it('catches the ci-complete gate job going missing', () => {
		mutate('.github/workflows/ci.yml', (t) => t.replace(/^ {2}ci-complete:$/m, '  ci-done:'));
		expectRedBecause(
			/^ {2}\[15\] ci\.yml has no `ci-complete` gate job for the branch ruleset to require$/m,
			'the gate job renamed',
		);
	});

	it('catches a toolchain pin that disagrees with the catalog', () => {
		mutate('pnpm-workspace.yaml', (t) => t.replace('undici: ^8.9', 'undici: ^7.0'));
		expectRedBecause(
			/^ {2}\[6\] undici: table says \^8\.9, catalog says \^7\.0$/m,
			'catalog disagrees with the table',
		);
	});
});
