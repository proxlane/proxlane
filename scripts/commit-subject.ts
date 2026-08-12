// Is this commit subject one that may land on `main`?
//
// The rule is `CLAUDE.md`'s: Conventional Commits, <= 72 chars. Two things make it subtler
// than it reads, and both were learned by shipping the wrong thing.
//
// GitHub appends ` (#N)` on squash, so the budget is 72 MINUS that suffix, not 72. PR #13
// went green on a 63-char title and landed a 79-char subject.
//
// And WHICH string lands depends on the commit count: GitHub defaults a single-commit
// squash to the commit's own subject, and a multi-commit squash to the PR title. So format
// applies to every subject, and the length budget applies only to what actually lands.
//
// THIS LOGIC USED TO BE INLINE BASH IN `pr-title.yml`, which meant the only way to discover
// a too-long subject was to push and wait. `changeset-required.ts` carries the note that an
// inline check is one nobody can run locally, "and this repo has already been bitten twice
// by exactly that". This was the third time. It lives here so `.githooks/commit-msg` can run
// it before the commit exists, and so the cases below are tested rather than asserted.

import { readFileSync } from 'node:fs';

/** `CLAUDE.md`: commit subject, Conventional Commits, <= 72 chars. */
export const LIMIT = 72;

export const TYPES = [
	'feat',
	'fix',
	'docs',
	'chore',
	'refactor',
	'test',
	'perf',
	'build',
	'ci',
	'style',
	'revert',
] as const;

/** Scopes match package names; `!` marks a break, as does a `BREAKING CHANGE` footer. */
export const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9./-]+\\))?!?: .+`);

/**
 * The PR number to assume when there is not one yet.
 *
 * A `commit-msg` hook runs before any PR exists, so it cannot compute the real suffix. Four
 * digits is the worst case this repo will plausibly reach, which makes the hook at most two
 * characters stricter than CI today. Erring the other way would let the hook pass something
 * CI then rejects, which is the whole failure being designed out.
 */
export const ASSUMED_PR = 9999;

export function suffix(pr: number): string {
	return ` (#${pr})`;
}

export function budget(pr: number): number {
	return LIMIT - suffix(pr).length;
}

export interface Problem {
	readonly kind: 'format' | 'length';
	readonly message: string;
}

export function checkSubject(
	what: string,
	subject: string,
	opts: { readonly pr: number; readonly applyLength: boolean },
): Problem[] {
	const problems: Problem[] = [];
	if (!CONVENTIONAL.test(subject)) {
		problems.push({
			kind: 'format',
			message: `${what} is not a Conventional Commit: ${subject}\n  e.g. feat(adapters): add zyte adapter`,
		});
	}
	if (opts.applyLength) {
		const b = budget(opts.pr);
		if (subject.length > b) {
			problems.push({
				kind: 'length',
				message: `${what} is ${subject.length} chars; keep it to ${b} so that with '${suffix(opts.pr)}' it fits ${LIMIT}`,
			});
		}
	}
	return problems;
}

/**
 * Subjects a hook must not judge: git's own scaffolding.
 *
 * A merge subject never lands under squash-only merging, and `fixup!`/`squash!` are consumed
 * by the rebase that follows. Rejecting either would block a legitimate local workflow on a
 * string that reaches nothing.
 */
export function isExempt(subject: string): boolean {
	return /^(Merge |Revert "|fixup!|squash!|amend!)/.test(subject);
}

/** First non-comment, non-blank line of a commit message file. */
export function subjectOf(message: string): string {
	return (
		message
			.split('\n')
			.find((l) => l.trim() !== '' && !l.startsWith('#'))
			?.trim() ?? ''
	);
}

if (import.meta.filename === process.argv[1]) {
	const arg = (name: string): string | undefined => {
		const i = process.argv.indexOf(`--${name}`);
		return i === -1 ? undefined : process.argv[i + 1];
	};

	const problems: Problem[] = [];
	const file = arg('file');

	if (file !== undefined) {
		// Hook mode: one subject, no PR yet, length always applies because CLAUDE.md's rule is
		// unconditional even where CI relaxes it for a multi-commit PR.
		const subject = subjectOf(readFileSync(file, 'utf8'));
		if (subject === '' || isExempt(subject)) process.exit(0);
		problems.push(...checkSubject('commit subject', subject, { pr: ASSUMED_PR, applyLength: true }));
		if (problems.length > 0) {
			process.stderr.write('\n');
			for (const p of problems) process.stderr.write(`  ${p.message}\n`);
			process.stderr.write(
				`\n  Budgeted against ${suffix(ASSUMED_PR)} because there is no PR number yet.\n` +
					'  Amend with:  git commit --amend\n\n',
			);
			process.exit(1);
		}
		process.exit(0);
	}

	// CI mode.
	const title = arg('title');
	const pr = Number(arg('pr'));
	const subjectsRaw = arg('subjects');
	if (title === undefined || !Number.isFinite(pr) || subjectsRaw === undefined) {
		process.stderr.write(
			'usage: commit-subject.ts --file <path>\n' +
				'       commit-subject.ts --title <t> --pr <n> --subjects <newline-separated>\n',
		);
		process.exit(2);
	}

	const subjects = subjectsRaw.split('\n').filter((s) => s.trim() !== '');
	if (subjects.length === 0) {
		// Non-zero denominator: a run that examined no commits has proved nothing.
		process.stderr.write('::error::no commits found — cannot verify what will land\n');
		process.exit(1);
	}

	problems.push(...checkSubject('PR title', title, { pr, applyLength: true }));
	const lands = subjects.length === 1;
	process.stdout.write(
		`${subjects.length} commit subject(s); length budget applies to them: ${lands ? 'yes' : 'no'}\n`,
	);
	for (const s of subjects) {
		problems.push(...checkSubject('commit subject', s, { pr, applyLength: lands }));
	}

	for (const p of problems) process.stdout.write(`::error::${p.message}\n`);
	process.exit(problems.length > 0 ? 1 : 0);
}
