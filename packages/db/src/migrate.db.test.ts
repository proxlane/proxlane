// The exit criterion for `packages/db`: a migration up/down round-trip against a real
// Postgres 17, per `.claude/agents/data-engineer.md`.
//
// Nothing here is mocked. The container is the same image constant the compose file uses, so
// what is tested is the DDL a self-hoster will actually run.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp, migrationFiles, publicTables } from './migrate.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(PKG, 'migrations');

/** Every table the Better Auth generation owns. Named, so an accidental drop is visible. */
const AUTH_TABLES = [
	'account',
	'invitation',
	'member',
	'organization',
	'session',
	'two_factor',
	'user',
	'verification',
];

let pool: Pool;

beforeAll(() => {
	const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
	if (url === undefined) throw new Error('no TEST_DATABASE_URL — globalSetup did not run');
	pool = new Pool({ connectionString: url });
});

afterAll(async () => {
	await pool?.end();
});

/** Each test starts from an empty database, so none can depend on another's leftovers. */
beforeEach(async () => {
	await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
	await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
});

describe('the migration set is complete', () => {
	it('finds migrations to run', () => {
		// Non-zero denominator. An empty directory would make every assertion below vacuous.
		expect(migrationFiles(DIR).length).toBeGreaterThan(0);
	});

	it('ships a down file for every up', () => {
		// The rule that makes rollback possible at all. Enforced here rather than trusted,
		// because the cost of noticing at rollback time is an incident.
		for (const file of migrationFiles(DIR)) {
			expect(
				() => readFileSync(join(DIR, 'down', file), 'utf8'),
				`no down for ${file}`,
			).not.toThrow();
		}
	});
});

describe('up', () => {
	it('creates every Better Auth table', async () => {
		const ran = await migrateUp(pool, { dir: DIR });
		expect(ran).toEqual(migrationFiles(DIR));
		expect(await publicTables(pool)).toEqual(AUTH_TABLES);
	});

	it('is idempotent: a second run applies nothing', async () => {
		await migrateUp(pool, { dir: DIR });
		expect(await migrateUp(pool, { dir: DIR })).toEqual([]);
		expect(await publicTables(pool)).toEqual(AUTH_TABLES);
	});

	it('stores timestamps as timestamptz, never naked', async () => {
		// The correction `scripts/generate-auth-schema.ts` applies, asserted against the real
		// catalogue rather than the source. `session.expires_at` in local time is a security bug
		// the day the clock shifts, and a column type is the least reversible thing in a schema.
		await migrateUp(pool, { dir: DIR });
		const { rows } = await pool.query<{
			table_name: string;
			column_name: string;
			data_type: string;
		}>(
			`SELECT table_name, column_name, data_type FROM information_schema.columns
			 WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'`,
		);
		expect(rows.length).toBeGreaterThan(10);
		const naked = rows.filter((r) => r.data_type !== 'timestamp with time zone');
		expect(naked.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
	});

	it('enforces the foreign keys the org model depends on', async () => {
		// Tenancy is only real if the database refuses an orphan. `member` pointing at a
		// deleted organization would be an org that half exists.
		await migrateUp(pool, { dir: DIR });
		const { rows } = await pool.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM information_schema.table_constraints
			 WHERE table_schema='public' AND constraint_type='FOREIGN KEY'`,
		);
		expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(6);
	});
});

describe('down', () => {
	it('returns the database to empty', async () => {
		await migrateUp(pool, { dir: DIR });
		expect(await publicTables(pool)).toEqual(AUTH_TABLES);

		const undone = await migrateDown(pool, { dir: DIR, steps: migrationFiles(DIR).length });
		expect(undone).toEqual([...migrationFiles(DIR)].reverse());
		expect(await publicTables(pool)).toEqual([]);
	});

	it('round-trips: up, down, up again', async () => {
		// The exit criterion. A down that leaves an object behind fails on the second up, at a
		// far more confusing moment than here.
		await migrateUp(pool, { dir: DIR });
		await migrateDown(pool, { dir: DIR, steps: migrationFiles(DIR).length });
		const again = await migrateUp(pool, { dir: DIR });
		expect(again).toEqual(migrationFiles(DIR));
		expect(await publicTables(pool)).toEqual(AUTH_TABLES);
	});

	it('refuses to roll back a migration with no down file', async () => {
		// A rollback that silently marks a migration un-applied while leaving its tables would
		// break the NEXT up on an object that already exists.
		await migrateUp(pool, { dir: DIR });
		await pool.query(
			`INSERT INTO drizzle.__drizzle_migrations (hash) VALUES ('9999_invented.sql')`,
		);
		await expect(migrateDown(pool, { dir: DIR, steps: 1 })).rejects.toThrow(
			/no down migration/,
		);
	});

	it('leaves the journal consistent with what exists', async () => {
		await migrateUp(pool, { dir: DIR });
		await migrateDown(pool, { dir: DIR, steps: 1 });
		const { rows } = await pool.query<{ hash: string }>(
			'SELECT hash FROM drizzle.__drizzle_migrations',
		);
		expect(rows).toHaveLength(migrationFiles(DIR).length - 1);
	});
});
