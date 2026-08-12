// Weekly partition rotation and retention for the request log.
//
// Two jobs that must both keep running forever, and whose failure modes are opposite:
//
//   ensurePartitions   forgets to run -> the next insert fails outright, because there is no
//                      partition for `now()`. The gateway stops logging, or stops serving.
//   dropExpired        forgets to run -> nothing breaks, the disk fills, and the first symptom
//                      is Postgres refusing writes at 3am.
//
// So `ensurePartitions` runs far ahead of need, and both are idempotent and keyed, per
// `operations.md` section 2's rule that every job is safe to retry.
//
// RETENTION DETACHES AND DROPS WHOLE PARTITIONS. It never issues a `DELETE` over a partitioned
// table — that rewrites rather than reclaims, holds a long transaction, and leaves the dead
// tuples behind for autovacuum. It is also what the retention job used to say, and it defeats
// the entire point of partitioning.

import type { Pool } from 'pg';

/** Tables partitioned by week. Both keyed on their own timestamp column. */
export const PARTITIONED = {
	requests: 'created_at',
	request_attempts: 'started_at',
} as const;

export type PartitionedTable = keyof typeof PARTITIONED;

/**
 * Monday 00:00:00 UTC of the week containing `at`.
 *
 * UTC, always. A boundary computed in local time silently moves twice a year, and the two
 * partitions either side of a DST change would overlap or leave a gap — one throws on insert,
 * the other loses rows to no partition at all.
 */
export function weekStart(at: Date): Date {
	const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
	// getUTCDay: 0 = Sunday. Shift so Monday is 0.
	const shift = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - shift);
	return d;
}

export function addWeeks(at: Date, n: number): Date {
	const d = new Date(at);
	d.setUTCDate(d.getUTCDate() + 7 * n);
	return d;
}

/** `requests_2026w33`. ISO-ish and sortable, which matters when reading `\dt` at 3am. */
export function partitionName(table: PartitionedTable, start: Date): string {
	const year = start.getUTCFullYear();
	// Week number from the year's first Monday, matching how the bounds are generated. Not
	// ISO-8601 week numbering: that would disagree with `weekStart` in the first days of
	// January and produce two names for one partition.
	const firstMonday = weekStart(new Date(Date.UTC(year, 0, 4)));
	const week = Math.round((start.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
	return `${table}_${year}w${String(week).padStart(2, '0')}`;
}

const iso = (d: Date): string => d.toISOString();

/**
 * Create partitions covering from this week to `weeksAhead` weeks out.
 *
 * Ahead, not just-in-time. A job that creates the partition it needs at the moment it needs it
 * has no margin: one failed run and the next insert has nowhere to go. Several weeks of
 * headroom means the alert for a broken rotation job arrives weeks before the outage would.
 */
export async function ensurePartitions(
	pool: Pool,
	opts: { readonly weeksAhead?: number; readonly now?: Date } = {},
): Promise<string[]> {
	const weeksAhead = opts.weeksAhead ?? 4;
	if (weeksAhead < 1) throw new Error('weeksAhead must be at least 1');
	const now = opts.now ?? new Date();
	const created: string[] = [];

	for (const table of Object.keys(PARTITIONED) as PartitionedTable[]) {
		for (let i = 0; i <= weeksAhead; i++) {
			const start = addWeeks(weekStart(now), i);
			const end = addWeeks(start, 1);
			const name = partitionName(table, start);
			// IF NOT EXISTS, so a re-run is a no-op rather than an error. `operations.md`
			// section 2: every job idempotent and keyed.
			const { rowCount } = await pool.query(
				`SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
				[name],
			);
			if (rowCount !== null && rowCount > 0) continue;
			await pool.query(
				`CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${table}"
				 FOR VALUES FROM ('${iso(start)}') TO ('${iso(end)}')`,
			);
			created.push(name);
		}
	}
	return created;
}

export interface ExpiredPartition {
	readonly table: PartitionedTable;
	readonly partition: string;
	readonly upperBound: string;
}

/**
 * Partitions whose entire range is older than the cutoff.
 *
 * Read from `pg_get_expr` rather than from the name: a name is a label someone could have
 * typed, and dropping the wrong week because a name was mistyped is unrecoverable. The bound
 * is what Postgres will actually enforce.
 */
export async function expiredPartitions(
	pool: Pool,
	opts: { readonly keepDays: number; readonly now?: Date },
): Promise<ExpiredPartition[]> {
	if (opts.keepDays < 1) throw new Error('keepDays must be at least 1');
	const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.keepDays * 86_400_000);

	// The bound is EXTRACTED AND CAST IN SQL, not parsed in JavaScript.
	//
	// `pg_get_expr` renders the upper bound as `2026-06-08 00:00:00+00` — an hour-only UTC
	// offset, which is valid ISO 8601 and which `new Date()` rejects as Invalid Date. Parsing
	// it here silently produced NaN, `NaN < cutoff` is false, and retention therefore found
	// nothing to drop while reporting success: a disk that fills up behind a green job.
	//
	// Letting Postgres cast its own output removes the class of bug rather than the instance.
	// The comparison is `<`, strictly: a partition whose upper bound equals the cutoff still
	// holds rows inside the retention window, and dropping it deletes data a customer is
	// entitled to.
	const { rows } = await pool.query<{ parent: string; child: string; upper: Date }>(
		`SELECT parent.relname AS parent,
		        child.relname  AS child,
		        (regexp_match(
		           pg_get_expr(child.relpartbound, child.oid),
		           'TO \\(''([^'']+)''\\)'
		        ))[1]::timestamptz AS upper
		   FROM pg_inherits
		   JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
		   JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
		  WHERE parent.relname = ANY($1)`,
		[Object.keys(PARTITIONED)],
	);

	return rows
		.filter((r) => r.upper instanceof Date && r.upper.getTime() < cutoff.getTime())
		.map((r) => ({
			table: r.parent as PartitionedTable,
			partition: r.child,
			upperBound: r.upper.toISOString(),
		}))
		.sort((a, b) => a.partition.localeCompare(b.partition));
}

/**
 * Detach and drop every partition older than the retention window.
 *
 * DETACH first, then DROP, in separate statements. Detaching takes a brief lock and removes
 * the partition from the parent's plan; dropping afterwards means the expensive part happens
 * on a table nothing can route to. `DROP TABLE` on an attached partition would hold a lock on
 * the parent for the duration, which on the hot path is an outage.
 */
export async function dropExpiredPartitions(
	pool: Pool,
	opts: { readonly keepDays: number; readonly now?: Date },
): Promise<string[]> {
	const expired = await expiredPartitions(pool, opts);
	const dropped: string[] = [];
	for (const { table, partition } of expired) {
		await pool.query(`ALTER TABLE "${table}" DETACH PARTITION "${partition}"`);
		await pool.query(`DROP TABLE "${partition}"`);
		dropped.push(partition);
	}
	return dropped;
}

/** Attached partitions of a table, oldest first. For diagnostics and for the tests. */
export async function listPartitions(pool: Pool, table: PartitionedTable): Promise<string[]> {
	const { rows } = await pool.query<{ child: string }>(
		`SELECT child.relname AS child
		   FROM pg_inherits
		   JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
		   JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
		  WHERE parent.relname = $1
		  ORDER BY child.relname`,
		[table],
	);
	return rows.map((r) => r.child);
}
