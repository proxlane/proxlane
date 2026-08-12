// Applying and rolling back migrations.
//
// `operations.md` section 3: migrations run as an explicit step, never at boot and never
// `db push` in CI. So this is a library the deploy step and the tests call, not something the
// gateway imports — `apps/gateway` never migrates, and never touches Postgres on the hot path.
//
// DOWN IS HAND-WRITTEN, and that is the reason this file exists rather than a one-line call to
// drizzle's migrator. drizzle-kit generates forward-only SQL, so without a `down` half the only
// way to undo a bad migration in production is to restore a backup.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Where drizzle records what it has applied. Created by its own migrator. */
const JOURNAL = 'drizzle.__drizzle_migrations';

export interface MigrateOptions {
	/** Directory holding `NNNN_name.sql` and `down/NNNN_name.sql`. */
	readonly dir: string;
}

/** Migration files in apply order, by their numeric prefix rather than by string sort. */
export function migrationFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.sql'))
		.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

/**
 * Apply every migration that has not been applied.
 *
 * Deliberately not drizzle's own `migrate()`: that would record hashes this file cannot then
 * reconcile with the down half, leaving `up` and `down` keeping two different journals of the
 * same thing. One journal, written here, is the only way rollback can be correct.
 */
export async function migrateUp(pool: Pool, opts: MigrateOptions): Promise<string[]> {
	await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
	await pool.query(
		`CREATE TABLE IF NOT EXISTS ${JOURNAL} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL UNIQUE,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
	);
	const applied = new Set(
		(await pool.query<{ hash: string }>(`SELECT hash FROM ${JOURNAL}`)).rows.map((r) => r.hash),
	);

	const ran: string[] = [];
	for (const file of migrationFiles(opts.dir)) {
		if (applied.has(file)) continue;
		const sql = readFileSync(join(opts.dir, file), 'utf8');
		const client = await pool.connect();
		try {
			// One transaction per migration. A migration that fails halfway and leaves the
			// journal saying it succeeded is unrecoverable without manual surgery.
			await client.query('BEGIN');
			await client.query(sql);
			await client.query(`INSERT INTO ${JOURNAL} (hash) VALUES ($1)`, [file]);
			await client.query('COMMIT');
			ran.push(file);
		} catch (err) {
			await client.query('ROLLBACK');
			throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : err}`);
		} finally {
			client.release();
		}
	}
	return ran;
}

/**
 * Roll back the last `steps` applied migrations, newest first.
 *
 * Throws if a down file is missing rather than skipping it. A rollback that silently leaves
 * tables behind and marks the migration un-applied is worse than one that refuses: the next
 * `up` would then fail on an object that already exists, at a much more confusing moment.
 */
export async function migrateDown(
	pool: Pool,
	opts: MigrateOptions & { readonly steps?: number },
): Promise<string[]> {
	const { rows } = await pool.query<{ hash: string }>(
		`SELECT hash FROM ${JOURNAL} ORDER BY id DESC LIMIT $1`,
		[opts.steps ?? 1],
	);

	const undone: string[] = [];
	for (const { hash } of rows) {
		const path = join(opts.dir, 'down', hash);
		let sql: string;
		try {
			sql = readFileSync(path, 'utf8');
		} catch {
			throw new Error(
				`no down migration for ${hash}. Every migration ships its rollback: ` +
					`write ${join('down', hash)} before this can be undone.`,
			);
		}
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(sql);
			await client.query(`DELETE FROM ${JOURNAL} WHERE hash = $1`, [hash]);
			await client.query('COMMIT');
			undone.push(hash);
		} catch (err) {
			await client.query('ROLLBACK');
			throw new Error(
				`rollback of ${hash} failed: ${err instanceof Error ? err.message : err}`,
			);
		} finally {
			client.release();
		}
	}
	return undone;
}

/** Tables in `public`, so a test can assert what a migration actually did. */
export async function publicTables(pool: Pool): Promise<string[]> {
	const { rows } = await pool.query<{ table_name: string }>(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		 ORDER BY table_name`,
	);
	return rows.map((r) => r.table_name);
}
