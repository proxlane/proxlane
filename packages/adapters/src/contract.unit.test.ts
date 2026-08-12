// The taxonomy is transcribed from a markdown table in integrations.md section 3. A
// transcription is exactly the kind of thing that is right on the day and wrong six months
// later, so this parses the table and diffs it rather than trusting the copy.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAILOVER, MICROCREDITS_PER_CREDIT, OUTCOMES, type Outcome } from './contract.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const spec = readFileSync(join(ROOT, 'docs/integrations.md'), 'utf8');

/** Section 3: | Outcome | Class | Meaning | HTTP | Charge | Failover | Cooldown | Page | */
function specRows(): {
	outcome: string;
	class: string;
	http: string;
	charge: string;
	failover: string;
	cooldown: string;
	pages: string;
}[] {
	const lines = spec.split('\n');
	const start = lines.findIndex((l) => l.startsWith('| Outcome | Class | Meaning |'));
	expect(start, 'section 3 outcome table not found').toBeGreaterThan(-1);
	const rows: ReturnType<typeof specRows> = [];
	for (let i = start + 2; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (!line.startsWith('|')) break;
		const c = line
			.split('|')
			.slice(1, -1)
			.map((x) => x.trim());
		const outcome = (c[0] ?? '').replace(/`/g, '');
		if (!outcome) continue;
		rows.push({
			outcome,
			class: (c[1] ?? '').replace(/`/g, ''),
			http: c[3] ?? '',
			charge: c[4] ?? '',
			failover: c[5] ?? '',
			cooldown: c[6] ?? '',
			pages: c[7] ?? '',
		});
	}
	return rows;
}

const rows = specRows();
const strip = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

describe('the outcome taxonomy matches integrations.md section 3', () => {
	it('has the same outcomes, in the same order', () => {
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.map((r) => r.outcome)).toEqual([...OUTCOMES]);
	});

	it.each(rows)('$outcome: the published class matches the code', (row) => {
		// The class is a stability promise made in public. A doc saying one thing while the
		// gateway sends another is worse than no promise.
		expect(FAILOVER[row.outcome as Outcome]?.class).toBe(strip(row.class));
	});

	it.each(rows)('$outcome: failover, cooldown and paging agree with the spec', (row) => {
		const policy = FAILOVER[row.outcome as Outcome];
		expect(policy, `${row.outcome} has no policy`).toBeDefined();

		const failover = strip(row.failover).toLowerCase();
		const expected = failover.startsWith('yes, once')
			? 'once'
			: failover.startsWith('yes')
				? true
				: false;
		expect(policy.failover, `${row.outcome} failover`).toBe(expected);

		// The Cooldown cell carries prose after the namespace ("acct, short",
		// "acct; mark key unhealthy"), so match the leading token only.
		const cd = strip(row.cooldown).toLowerCase();
		const expectedScope = cd.startsWith('blk')
			? 'blk'
			: cd.startsWith('acct')
				? 'acct'
				: 'none';
		expect(policy.cooldown, `${row.outcome} cooldown`).toBe(expectedScope);

		expect(policy.pages, `${row.outcome} paging`).toBe(
			strip(row.pages).toLowerCase() === 'yes',
		);
	});

	it.each(rows)('$outcome: the client-facing status agrees with the spec', (row) => {
		const policy = FAILOVER[row.outcome as Outcome];
		const cell = strip(row.http).toLowerCase();
		if (cell.startsWith('upstream')) {
			expect(policy.httpStatus).toBe('upstream');
		} else {
			// "429 + Retry-After" -> 429
			expect(policy.httpStatus).toBe(Number(/^\d+/.exec(cell)?.[0]));
		}
	});
});

describe('invariants the router depends on', () => {
	it('only OK is chargeable outright', () => {
		// Hosted billing charges on OK and nothing else. A second `true` here would be a
		// billing bug that no test downstream would catch.
		const chargeable = OUTCOMES.filter((o) => FAILOVER[o].chargeable === true);
		expect(chargeable).toEqual(['OK']);
	});

	it('never fails over on a fact that would be identical at the next provider', () => {
		// A real 404 is a real 404 everywhere, and retrying it burns money.
		for (const o of ['TARGET_NOT_FOUND', 'BAD_REQUEST', 'TARGET_FORBIDDEN'] as const) {
			expect(FAILOVER[o].failover, o).toBe(false);
		}
	});

	it('pages only for our bugs and provider contract breaks', () => {
		expect(OUTCOMES.filter((o) => FAILOVER[o].pages)).toEqual([
			'PROVIDER_DRIFT',
			'INVALID_REQUEST',
		]);
	});

	it('keeps block facts shared and account facts private', () => {
		// Keying every cooldown (provider, domain) makes one org's account problems
		// everyone else's; keying them all per-org throws away the shared block signal.
		expect(FAILOVER.SOFT_BLOCK.cooldown).toBe('blk');
		expect(FAILOVER.HARD_BLOCK.cooldown).toBe('blk');
		expect(FAILOVER.RATE_LIMITED.cooldown).toBe('acct');
		expect(FAILOVER.AUTH_FAILED.cooldown).toBe('acct');
	});

	it('uses integer microcredits', () => {
		expect(MICROCREDITS_PER_CREDIT).toBe(1_000_000);
		expect(Number.isInteger(MICROCREDITS_PER_CREDIT)).toBe(true);
	});
});
