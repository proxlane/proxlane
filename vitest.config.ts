import { defineConfig } from 'vitest/config';

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
