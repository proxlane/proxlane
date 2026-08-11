import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Tests resolve `@proxlane/*` to SOURCE, not to dist.
//
// Without this they resolve through the package `exports` field to `dist/index.mjs`, which
// means every cross-package test validates the last BUILD rather than the working tree. That
// is not theoretical: `health.ts` was edited in src to break its attribution table on
// purpose, and the test written to catch exactly that went green, because it was reading a
// dist built minutes earlier. Three gateway suites had the same property and nobody had
// noticed, because CI happens to build before it tests.
//
// A test that passes against a stale artifact is the same failure class as a stub that exits
// 0: it reports a fact about something other than the thing under test.
//
// Only bare specifiers are aliased. Subpath imports like `@proxlane/vitest-config/...` keep
// their own resolution, because those packages export deliberate entry points.
const sourceAliases = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => ({ dir: d.name, entry: join(ROOT, 'packages', d.name, 'src', 'index.ts') }))
	.filter(({ entry }) => existsSync(entry))
	.map(({ dir, entry }) => {
		const { name } = JSON.parse(
			readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'),
		) as { name: string };
		return {
			find: new RegExp(`^${name.replace(/[/@]/g, '\\$&')}$`),
			replacement: resolve(entry),
		};
	});

if (sourceAliases.length === 0) {
	// Non-zero denominator. An empty alias list would silently restore the dist-resolution
	// behaviour this exists to remove, and every suite would still be green.
	throw new Error('vitest.config.ts resolved zero @proxlane source aliases');
}

// Four layers, selected by FILENAME, not by tag.
//
// `@live` used to be a tag filter. One typo in a `--exclude-tag` and a fork PR burns real
// provider keys, so the live suite is a separate project matching *.live.test.ts that only
// `pnpm test:live` ever invokes. repo:check asserts no *.live.test.ts is reachable from the
// unit/contract/e2e projects.
//
// passWithNoTests is false everywhere on purpose: a suite that ran zero tests is not a pass.
// That is the same non-zero-denominator rule the assertion set uses.
//
// Note the one test this scaffold ships is manifest.unit.test.ts, NOT contract.test.ts —
// the latter would land in the `contract` project, which no implemented command invokes,
// leaving `unit` empty and failing its own passWithNoTests.
export default defineConfig({
	resolve: { alias: sourceAliases },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['**/*.unit.test.ts'],
					passWithNoTests: false,
					// checks-have-teeth mutates tracked files (commands.json, CODEOWNERS,
					// compose) to prove repo:check goes red, and manifest.unit.test.ts reads
					// those same files. In parallel that is a latent race: it did not flake in
					// six runs, but "usually misses the window" is not a property worth
					// shipping in the suite that exists to catch things which only look
					// correct. Three files, ~2s — determinism is free here.
					fileParallelism: false,
				},
			},
			{
				extends: true,
				test: {
					name: 'contract',
					include: ['**/*.contract.test.ts'],
					passWithNoTests: false,
				},
			},
			{
				extends: true,
				test: {
					name: 'e2e',
					include: ['**/*.e2e.test.ts'],
					passWithNoTests: false,
					testTimeout: 120_000,
					// This was MISSING, and its absence made tooling/vitest/containers.ts dead
					// code. That file used to throw a loud "e2e is not implemented" error and it
					// never once ran — while repo:check asserted the image constants had "exactly
					// one consumer". They had a consumer nothing invoked.
					globalSetup: ['./tooling/vitest/containers.ts'],
				},
			},
			{
				extends: true,
				test: {
					// Its own project, not folded into `unit`, because security-engineer's exit
					// criterion is literally "pnpm test:ssrf exits 0" — that command has to run
					// exactly this and nothing else, or the criterion means something vaguer.
					name: 'ssrf',
					include: ['**/*.ssrf.test.ts'],
					passWithNoTests: false,
				},
			},
			{
				extends: true,
				test: {
					name: 'live',
					include: ['**/*.live.test.ts'],
					passWithNoTests: false,
				},
			},
		],
	},
});
