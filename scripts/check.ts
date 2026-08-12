// `pnpm check` — everything CI will run, in one command.
//
// This exists because of a number, not a preference: there are nine PR-blocking commands
// and twenty-four in the manifest, and asking a contributor to know which nine is asking
// them to get it wrong. Every one of the twenty-four is somebody's exit criterion, so none
// can be deleted — but nobody should have to hold the list in their head.
//
// So a contributor needs three commands, ever:
//
//     pnpm bootstrap    once
//     pnpm dev          to run it
//     pnpm check        before you push
//
// The list is DERIVED from scripts/commands.json, never written here. A command that
// becomes PR-blocking joins this automatically, and one that is still a stub cannot sneak
// in — which is the same reason the CI matrix is generated from the same file.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Entry {
	kind: string;
	status: string;
	ci: string;
}

const manifest = JSON.parse(
	readFileSync(join(ROOT, 'scripts/commands.json'), 'utf8'),
) as Record<string, Entry | unknown>;

/**
 * `bootstrap` is excluded, and only `bootstrap`.
 *
 * It is the SETUP command — preflight, install, build — not a verification. Running it here
 * would reinstall on every check, and a check that takes a minute to start is a check people
 * stop running. It stays PR-blocking in CI, where a clean clone is the point.
 */
const NOT_A_CHECK = new Set(['bootstrap']);

const all = Object.entries(manifest)
	.filter(([k]) => !k.startsWith('$'))
	.map(([id, e]) => ({ id, ...(e as Entry) }))
	// Every PR-blocking command, whatever its kind — `pnpm --filter @proxlane/db test` runs
	// from the root exactly like a root script does.
	//
	// This used to filter to `root-script`, which was invisible while the only filtered script
	// was a stub. The moment `@proxlane/db test` became real, `pnpm check` silently stopped
	// matching CI: the matrix in `ci.yml` filters on `status` and `ci` alone, so the db suite
	// was PR-blocking in CI and absent from "the one command before you push". CLAUDE.md says
	// check "runs every PR-blocking check, derived from commands.json so it cannot drift" —
	// which was false for as long as the two filters disagreed.
	//
	// `bin` stays out: `proxlane doctor` is not a pnpm script and `pnpm proxlane doctor` is not
	// a command. No bin is `ci: pr` today, so this excludes nothing that CI runs; it is here so
	// that making one PR-blocking fails loudly rather than producing a broken invocation.
	.filter((e) => e.status === 'implemented' && e.ci === 'pr' && e.kind !== 'bin')
	.map((e) => e.id)
	.filter((id) => !NOT_A_CHECK.has(id));

// `build` first: typecheck, the test projects and conformance all read from dist. The rest
// are order-independent, so they run in manifest order rather than an invented one.
const ordered = ['build', ...all.filter((id) => id !== 'build')];

if (ordered.length <= 1) {
	// Non-zero denominator. A `check` that ran only `build` has verified almost nothing, and
	// reporting that as a pass is the vacuous green this repo is arranged against.
	process.stderr.write(
		`check resolved ${ordered.length} command(s) from the manifest — that is a bug, not a clean repo\n`,
	);
	process.exit(1);
}

process.stdout.write(
	`\n  running ${ordered.length} checks, derived from scripts/commands.json\n\n`,
);

// Widest id, not a literal. `--filter @proxlane/db test` is 26 characters and ran straight
// into the status with a hardcoded 16, printing `testFAIL`.
const WIDTH = Math.max(...ordered.map((id) => id.length)) + 2;

const failed: string[] = [];
for (const id of ordered) {
	process.stdout.write(`  ${id.padEnd(WIDTH)}`);
	const started = Date.now();
	try {
		// SPLIT on spaces. `execFileSync` passes each array element as one argv entry, so a
		// multi-word id went to pnpm as a single argument and it looked for a script literally
		// named `--filter @proxlane/db test`. That failed in 220ms while the same command passed
		// when run by hand — invisible until the first `filtered-script` became implemented.
		execFileSync('pnpm', id.split(' '), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
		process.stdout.write(`ok    ${Date.now() - started}ms\n`);
	} catch {
		process.stdout.write(`FAIL  ${Date.now() - started}ms\n`);
		failed.push(id);
	}
}

if (failed.length > 0) {
	// Run them ALL and report all failures, rather than stopping at the first. One round trip
	// beats discovering the next problem only after fixing this one.
	process.stdout.write(
		`\n  ${failed.length} failed: ${failed.join(', ')}\n` +
			`  Re-run one on its own for the detail, e.g. \`pnpm ${failed[0]}\`\n\n`,
	);
	process.exit(1);
}
process.stdout.write('\n  all checks pass — this is what CI will run\n\n');
