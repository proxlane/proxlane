// The cases here are all regressions. Every one of them shipped or blocked something.

import { describe, expect, it } from 'vitest';
import {
	ASSUMED_PR,
	budget,
	checkSubject,
	isExempt,
	LIMIT,
	subjectOf,
	suffix,
} from './commit-subject.js';

const kinds = (ps: ReturnType<typeof checkSubject>) => ps.map((p) => p.kind);

describe('the budget accounts for the suffix GitHub appends', () => {
	it('subtracts " (#13)" rather than allowing the full 72', () => {
		// PR #13 went green on a 63-char title and landed a 79-char subject, because the old
		// check compared against 72 and ignored the suffix entirely.
		expect(budget(13)).toBe(LIMIT - ' (#13)'.length);
		expect(budget(13)).toBeLessThan(LIMIT);
	});

	it('shrinks as PR numbers grow', () => {
		expect(budget(9999)).toBeLessThan(budget(31));
	});

	it('accepts a subject exactly at the budget and rejects one past it', () => {
		const at = `docs: ${'x'.repeat(budget(31) - 6)}`;
		expect(at.length).toBe(budget(31));
		expect(checkSubject('t', at, { pr: 31, applyLength: true })).toEqual([]);
		expect(kinds(checkSubject('t', `${at}y`, { pr: 31, applyLength: true }))).toEqual(['length']);
	});

	it('rejects the 68-char subject that failed twice while shipping 0.1.0', () => {
		// Trimmed to 72 on the first attempt, which still failed: the cap is 66 at PR #31.
		const s = 'docs(release): what 0.1.0 cost, and why the pnpm pin is load-bearing';
		expect(s.length).toBe(68);
		expect(kinds(checkSubject('t', s, { pr: 31, applyLength: true }))).toEqual(['length']);
	});
});

describe('length applies only to what actually lands', () => {
	const long = `chore: ${'x'.repeat(90)}`;

	it('is enforced for a single-commit PR, whose own subject is squashed', () => {
		expect(kinds(checkSubject('t', long, { pr: 31, applyLength: true }))).toContain('length');
	});

	it('is not enforced for a multi-commit PR, where only the title lands', () => {
		expect(kinds(checkSubject('t', long, { pr: 31, applyLength: false }))).toEqual([]);
	});

	it('still enforces FORMAT when length does not apply', () => {
		// Format is unconditional. Relaxing both was the bug the "lands" split had to avoid.
		expect(kinds(checkSubject('t', 'no type here at all', { pr: 31, applyLength: false }))).toEqual(
			['format'],
		);
	});
});

describe('conventional commit format', () => {
	it.each([
		'feat(adapters): add zyte adapter',
		'fix: repair the thing',
		'feat!: drop a parameter',
		'docs(route-viz): note the lane colours',
		'chore(deps-dev): bump vitest',
	])('accepts %s', (s) => {
		expect(kinds(checkSubject('t', s, { pr: 31, applyLength: false }))).toEqual([]);
	});

	it.each([
		'added a thing',
		'Feat: capitalised type',
		'feat:missing space',
		'feat(Adapters): uppercase scope',
		'wip: not a conventional type',
	])('rejects %s', (s) => {
		expect(kinds(checkSubject('t', s, { pr: 31, applyLength: false }))).toEqual(['format']);
	});
});

describe('the hook does not judge git scaffolding', () => {
	it.each(['Merge branch main into x', 'fixup! feat: earlier', 'squash! fix: earlier'])(
		'exempts %s',
		(s) => {
			expect(isExempt(s)).toBe(true);
		},
	);

	it('does not exempt an ordinary subject', () => {
		expect(isExempt('feat: a real change')).toBe(false);
	});
});

describe('reading a commit message file', () => {
	it('skips comment lines git adds below the subject', () => {
		expect(subjectOf('feat: a thing\n\n# Please enter the commit message\n# On branch main\n')).toBe(
			'feat: a thing',
		);
	});

	it('skips leading blank lines', () => {
		expect(subjectOf('\n\nfix: later subject\n')).toBe('fix: later subject');
	});

	it('returns empty for a message that is only comments, so the hook stays out of the way', () => {
		expect(subjectOf('# nothing here\n#\n')).toBe('');
	});
});

describe('the hook is stricter than CI, never looser', () => {
	it('assumes a four-digit PR so it cannot pass what CI would reject', () => {
		expect(budget(ASSUMED_PR)).toBeLessThanOrEqual(budget(31));
		expect(suffix(ASSUMED_PR)).toBe(' (#9999)');
	});
});
