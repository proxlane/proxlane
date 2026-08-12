// `pnpm --filter @proxlane/db test`.
//
// Its own config rather than a project in the root one, because this suite needs a real
// Postgres and nothing else does yet. The root `e2e` project starts Valkey only, on the stated
// principle that a container nobody connects to is ten seconds buying a green tick.
//
// `integrations.md` section 6: nothing mocked but the network boundary to providers. A
// migration is DDL against a specific Postgres version — the thing most worth not faking.

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.db.test.ts'],
		// Non-zero denominator: a suite that matched no files must not report success.
		passWithNoTests: false,
		globalSetup: [resolve(import.meta.dirname, 'test/postgres.ts')],
		// Pulling and starting Postgres 17 on a cold cache is slow, and being killed at 5s
		// would look like a migration bug.
		testTimeout: 120_000,
		hookTimeout: 180_000,
		// Migrations mutate one shared database. Parallel files would race on DDL.
		fileParallelism: false,
	},
});
