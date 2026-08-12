// drizzle-kit configuration.
//
// `operations.md` section 3: migrations run as an explicit step, never at boot and never
// `db push` in CI. `db push` diffs against a live database and applies the difference, which
// means the migration that runs in production is one nobody reviewed.
//
// The URL is read from the environment and is only ever used by `generate`/`migrate` on a
// developer machine or in a deploy step. Nothing here runs in the gateway.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/schema/index.ts',
	out: './migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://proxlane:proxlane@localhost:5432/proxlane',
	},
	// Keeps the generated SQL readable in review, which is the point of not using `db push`.
	verbose: true,
	strict: true,
});
