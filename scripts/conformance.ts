// pnpm conformance [--adapter=<id>] — run the shared suite over every registered adapter.
//
// The suite itself lives in packages/adapters/conformance/, because it is the adapters
// package's own contract with itself. This file is the runner: argument handling, the
// report, and the exit code.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--adapter='))?.split('=')[1];

// Loaded from the build, not the source: Node's type stripping does not rewrite a `.js`
// specifier to `.ts`, so the suite's own imports cannot resolve from source.
const built = join(ROOT, 'packages/adapters/conformance-dist/index.mjs');
let conform: (only?: string) => Promise<{
	failures: { adapter: string; check: string; detail: string }[];
	checks: number;
	notices: { adapter: string; detail: string }[];
	adapters: string[];
}>;
try {
	({ conform } = (await import(pathToFileURL(built).href)) as { conform: typeof conform });
} catch {
	process.stderr.write(
		`conformance is not built. Run \`pnpm build\` first.\n  expected ${built}\n`,
	);
	process.exit(2);
}

const { failures, checks, adapters, notices } = await conform(only);

if (adapters.length === 0) {
	process.stderr.write(
		only === undefined
			? 'no adapters are registered — there is nothing to conform\n'
			: `"${only}" is not a registered adapter\n`,
	);
	process.exit(2);
}
if (checks === 0) {
	// The non-zero denominator rule. A suite that examined nothing has proved nothing, and
	// reporting that as a pass is the same lie as a stub exiting 0.
	process.stderr.write(
		`conformance ran 0 checks across ${adapters.length} adapter(s) — that is a bug in the suite\n`,
	);
	process.exit(1);
}

const byAdapter = new Map<string, typeof failures>();
for (const f of failures) {
	const list = byAdapter.get(f.adapter) ?? [];
	list.push(f);
	byAdapter.set(f.adapter, list);
}

process.stdout.write(
	`\nconformance — ${checks} checks across ${adapters.length} adapter(s)\n\n`,
);
for (const id of adapters) {
	const fs = byAdapter.get(id) ?? [];
	process.stdout.write(fs.length === 0 ? `  ok    ${id}\n` : `  FAIL  ${id}  (${fs.length})\n`);
	for (const f of fs) process.stdout.write(`          [${f.check}] ${f.detail}\n`);
}

// BEFORE THE VERDICT, not after it. A notice printed under "all adapters conform" is a line
// nobody reads; printed above the result it is the thing still on screen when someone stops
// looking.
for (const n of notices) process.stdout.write(`\n  DUE SOON  ${n.adapter}: ${n.detail}\n`);

if (failures.length > 0) {
	process.stdout.write(`\n${failures.length} failure(s)\n\n`);
	process.exit(1);
}
process.stdout.write('\nall adapters conform\n\n');
