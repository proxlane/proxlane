// Automated partition rotation, the second half of `packages/db`'s exit criterion.
//
// Against a real Postgres 17, because every claim here is about what the server enforces:
// that an insert outside every partition is refused, that a detached partition stops being
// visible through the parent, and that a drop reclaims rather than rewrites.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateUp } from './migrate.js';
import {
	addWeeks,
	dropExpiredPartitions,
	ensurePartitions,
	expiredPartitions,
	listPartitions,
	partitionName,
	weekStart,
} from './partitions.js';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'migrations');
let pool: Pool;

beforeAll(() => {
	const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
	if (url === undefined) throw new Error('no TEST_DATABASE_URL — globalSetup did not run');
	pool = new Pool({ connectionString: url });
});

afterAll(async () => {
	await pool?.end();
});

beforeEach(async () => {
	await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
	await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
	await migrateUp(pool, { dir: DIR });
});

describe('week boundaries are UTC', () => {
	it('snaps to Monday 00:00 UTC', () => {
		// Thursday 2026-08-13 -> Monday 2026-08-10
		expect(weekStart(new Date('2026-08-13T15:04:05Z')).toISOString()).toBe(
			'2026-08-10T00:00:00.000Z',
		);
	});

	it('treats Monday as its own week start, not the previous one', () => {
		expect(weekStart(new Date('2026-08-10T00:00:00Z')).toISOString()).toBe(
			'2026-08-10T00:00:00.000Z',
		);
	});

	it('is stable across a DST change, because it never touches local time', () => {
		// Late March and late October, when European clocks move. A boundary computed locally
		// would shift by an hour and leave a gap or an overlap between adjacent partitions.
		for (const iso of ['2026-03-29T01:30:00Z', '2026-10-25T01:30:00Z']) {
			const s = weekStart(new Date(iso));
			expect(s.getUTCHours()).toBe(0);
			expect(s.getUTCDay()).toBe(1);
		}
	});

	it('gives adjacent weeks names that sort in time order', () => {
		const a = partitionName('requests', new Date('2026-08-10T00:00:00Z'));
		const b = partitionName('requests', addWeeks(new Date('2026-08-10T00:00:00Z'), 1));
		expect(a < b).toBe(true);
	});
});

describe('rotation creates partitions ahead of need', () => {
	it('covers this week plus the requested lookahead', async () => {
		const now = new Date('2026-08-13T12:00:00Z');
		const created = await ensurePartitions(pool, { weeksAhead: 4, now });
		// 5 windows (this week + 4) for each of the two tables.
		expect(created).toHaveLength(10);
		expect(await listPartitions(pool, 'requests')).toHaveLength(5);
		expect(await listPartitions(pool, 'request_attempts')).toHaveLength(5);
	});

	it('is idempotent: a second run creates nothing', async () => {
		const now = new Date('2026-08-13T12:00:00Z');
		await ensurePartitions(pool, { weeksAhead: 2, now });
		expect(await ensurePartitions(pool, { weeksAhead: 2, now })).toEqual([]);
	});

	it('refuses a lookahead of zero, which would have no margin at all', async () => {
		await expect(ensurePartitions(pool, { weeksAhead: 0 })).rejects.toThrow(/at least 1/);
	});
});

describe('the partitions actually route rows', () => {
	const now = new Date('2026-08-13T12:00:00Z');

	it('accepts an insert and files it in the right week', async () => {
		await ensurePartitions(pool, { weeksAhead: 1, now });
		await pool.query(
			`INSERT INTO requests (id, org_id, domain, url_hash, outcome, outcome_class, created_at)
			 VALUES ('0199-a', 'org1', 'example.com', 'h', 'OK', 'ok', $1)`,
			[now],
		);
		const { rows } = await pool.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM ${partitionName('requests', weekStart(now))}`,
		);
		expect(rows[0]?.n).toBe('1');
	});

	it('REFUSES a row with no partition, rather than silently dropping it', async () => {
		// The failure mode that matters if rotation stops running. Postgres erroring is the
		// correct behaviour: a row quietly going nowhere would be undetectable.
		await ensurePartitions(pool, { weeksAhead: 1, now });
		await expect(
			pool.query(
				`INSERT INTO requests (id, org_id, domain, url_hash, outcome, outcome_class, created_at)
				 VALUES ('0199-z', 'org1', 'example.com', 'h', 'OK', 'ok', $1)`,
				[addWeeks(now, 40)],
			),
		).rejects.toThrow(/no partition of relation/i);
	});

	it('stores an attempt per provider, which is the logged grain', async () => {
		await ensurePartitions(pool, { weeksAhead: 1, now });
		for (const [seq, provider] of ['scraperapi', 'scrapfly'].entries()) {
			await pool.query(
				`INSERT INTO request_attempts
				   (request_id, seq, provider, outcome, outcome_class, started_at)
				 VALUES ($1, $2, $3, 'SOFT_BLOCK', 'blocked', $4)`,
				['0199-a', seq, provider, now],
			);
		}
		const { rows } = await pool.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM request_attempts WHERE request_id = '0199-a'`,
		);
		expect(rows[0]?.n).toBe('2');
	});
});

describe('retention detaches and drops, never DELETEs', () => {
	const now = new Date('2026-08-13T12:00:00Z');

	/**
	 * Create a partition for a week in the past.
	 *
	 * Raw SQL rather than `ensurePartitions`, deliberately. Rotation only ever creates the
	 * current week forward — it has no reason to backfill, and its `weeksAhead >= 1` guard
	 * exists so a lookahead of zero cannot ship. Reaching through the production function to
	 * set up a past week would mean weakening that guard to make a test convenient.
	 */
	async function backfillWeek(weeksAgo: number): Promise<void> {
		const start = weekStart(addWeeks(now, -weeksAgo));
		const end = addWeeks(start, 1);
		for (const table of ['requests', 'request_attempts'] as const) {
			await pool.query(
				`CREATE TABLE "${partitionName(table, start)}" PARTITION OF "${table}"
				 FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
			);
		}
	}

	it('keeps everything inside the window', async () => {
		await ensurePartitions(pool, { weeksAhead: 1, now });
		expect(await dropExpiredPartitions(pool, { keepDays: 30, now })).toEqual([]);
	});

	it('drops a week that is entirely older than the cutoff', async () => {
		await backfillWeek(10);
		// Current week too, so the assertion is 'dropped the old one', not 'dropped them all'.
		await ensurePartitions(pool, { weeksAhead: 1, now });
		const before = await listPartitions(pool, 'requests');
		const dropped = await dropExpiredPartitions(pool, { keepDays: 30, now });
		expect(dropped.length).toBeGreaterThan(0);
		expect(await listPartitions(pool, 'requests')).toHaveLength(before.length - 1);
	});

	it('keeps a partition whose bound is EXACTLY the cutoff, and drops it one day later', async () => {
		// The off-by-one that silently deletes data a customer is entitled to: a partition whose
		// upper bound equals the cutoff still holds rows inside the retention window.
		//
		// The cutoff must land EXACTLY on the bound or this proves nothing. An earlier version
		// used `Math.round` on keepDays against a midday `now`, so the cutoff was always half a
		// day off the boundary — and mutating `<` to `<=` left the suite green.
		await backfillWeek(5);
		const start = weekStart(addWeeks(now, -5));
		const upper = addWeeks(start, 1);
		const name = partitionName('requests', start);

		// Midnight, so a whole number of days separates it from the bound.
		const at = new Date(Date.UTC(2026, 7, 12));
		const exact = (at.getTime() - upper.getTime()) / 86_400_000;
		expect(Number.isInteger(exact), 'the cutoff must land exactly on the bound').toBe(true);

		expect(
			await dropExpiredPartitions(pool, { keepDays: exact, now: at }),
			'a bound equal to the cutoff is still inside the window',
		).not.toContain(name);

		// One day less retention moves the cutoff past the bound, and now it must go.
		expect(await dropExpiredPartitions(pool, { keepDays: exact - 1, now: at })).toContain(name);
	});

	it('reads the real bound, not the name', async () => {
		// A name is a label; the bound is what Postgres enforces. Dropping by name would delete
		// the wrong week the first time a name was mistyped.
		await backfillWeek(10);
		const [expired] = await expiredPartitions(pool, { keepDays: 30, now });
		expect(expired).toBeDefined();
		expect(new Date(expired?.upperBound ?? 0).getTime()).toBeLessThan(now.getTime());
	});

	it('leaves no rows behind and no orphaned table', async () => {
		await backfillWeek(10);
		const old = weekStart(addWeeks(now, -10));
		await pool.query(
			`INSERT INTO requests (id, org_id, domain, url_hash, outcome, outcome_class, created_at)
			 VALUES ('0199-old', 'org1', 'example.com', 'h', 'OK', 'ok', $1)`,
			[old],
		);
		const dropped = await dropExpiredPartitions(pool, { keepDays: 30, now });
		expect(dropped).toContain(partitionName('requests', old));
		// Detached AND dropped: a detach alone would leave the table on disk, still consuming
		// the space retention exists to reclaim.
		const { rowCount } = await pool.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [
			partitionName('requests', old),
		]);
		expect(rowCount).toBe(0);
	});

	it('is idempotent', async () => {
		await backfillWeek(10);
		await dropExpiredPartitions(pool, { keepDays: 30, now });
		expect(await dropExpiredPartitions(pool, { keepDays: 30, now })).toEqual([]);
	});

	it('refuses keepDays of zero, which would drop the current week', async () => {
		await expect(dropExpiredPartitions(pool, { keepDays: 0 })).rejects.toThrow(/at least 1/);
	});
});
