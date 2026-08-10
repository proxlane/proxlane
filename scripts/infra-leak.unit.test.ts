// The infra-leak scanner, tested. It used to be an inline `node -e` block in ci.yml, which
// meant nobody had ever run it except CI — and the defect it hid was not a bug in the regex
// but a gap in the design: our ACTUAL coordinates matched no pattern, and could not be
// added without publishing them.

import { describe, expect, it } from 'vitest';
import { parseAlwaysPatterns, scanDiff } from './infra-leak.ts';

/** A minimal unified diff. */
function diff(file: string, ...added: string[]): string {
	return [
		`diff --git a/${file} b/${file}`,
		`--- a/${file}`,
		`+++ b/${file}`,
		...added.map((l) => `+${l}`),
	].join('\n');
}

const CFG = {
	// Deliberately not the real config: these tests are about the SCANNER, and reading the
	// live file would make them change meaning whenever the pattern list does.
	patterns: ['(^|[^0-9.])(10\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3})', 'farm[.]rip'],
	excludePaths: ['docs/archive', 'packages/shared/src/edge-guard.ts'],
};

describe('generic patterns are heuristics, so they honour excludePaths', () => {
	it('catches an RFC1918 address in ordinary source', () => {
		const f = scanDiff(diff('apps/gateway/src/x.ts', 'const HOST = "10.0.1.42";'), CFG);
		expect(f).toHaveLength(1);
		expect(f[0]?.kind).toBe('generic');
	});

	it('does not fire inside a path that legitimately enumerates ranges', () => {
		// The edge guard's whole job is refusing private ranges; it cannot name them without
		// tripping a scanner that looks for them.
		expect(
			scanDiff(diff('packages/shared/src/edge-guard.ts', 'ip4 10.0.0.0'), CFG),
		).toHaveLength(0);
	});

	it('ignores removed and context lines — this job holds the line forward only', () => {
		const d = [
			'+++ b/docs/operations.md',
			'-the old box at 10.0.1.42',
			' unchanged 10.0.1.42',
		].join('\n');
		expect(scanDiff(d, CFG)).toHaveLength(0);
	});
});

describe('always patterns are absolute, so excludePaths does not apply', () => {
	// This is the repair. Before the split, excluding a path disabled EVERY pattern for it,
	// so a real address pasted into the edge guard would have sailed through.
	const always = ['198\\.51\\.100\\.7', 'box\\.example\\.invalid'];

	it('fires inside an excluded path', () => {
		const f = scanDiff(
			diff('packages/shared/src/edge-guard.ts', '// see 198.51.100.7'),
			CFG,
			always,
		);
		expect(f).toHaveLength(1);
		expect(f[0]?.kind).toBe('always');
	});

	it('fires inside the patterns file itself', () => {
		const f = scanDiff(
			diff('docs/archive/old.md', 'ssh root@box.example.invalid'),
			CFG,
			always,
		);
		expect(f[0]?.kind).toBe('always');
	});

	it('is case-insensitive, because a hostname is', () => {
		expect(scanDiff(diff('README.md', 'BOX.EXAMPLE.INVALID'), CFG, always)).toHaveLength(1);
	});

	it('reports the absolute hit rather than a generic one on the same line', () => {
		// A line matching both should be labelled by the more serious class, or triage reads
		// "someone wrote a private range" when the truth is "someone published our box".
		const f = scanDiff(diff('README.md', '10.0.0.1 and 198.51.100.7'), CFG, always);
		expect(f).toHaveLength(1);
		expect(f[0]?.kind).toBe('always');
	});
});

describe('the secret is parsed forgivingly, because it is edited by hand', () => {
	it('accepts newline or comma separated, and skips blanks and comments', () => {
		expect(parseAlwaysPatterns('a\n\n# note\nb, c')).toEqual(['a', 'b', 'c']);
	});

	it('treats an unset secret as no patterns rather than crashing', () => {
		// Fork PRs receive no secrets. The job warns instead of failing — blocking every
		// community contribution to prevent a leak a contributor cannot cause is the wrong
		// trade, and the warning keeps the reduced coverage visible.
		expect(parseAlwaysPatterns(undefined)).toEqual([]);
	});
});

describe('a withheld finding must still be locatable', () => {
	// An `always` hit is NOT echoed into the log — the matched text is the coordinate, and a
	// public CI log is the last place it should appear. GitHub's masking does not help: the
	// secret is a REGEX and the matched line has no backslashes, so the strings differ. File
	// and line number are therefore the entire report, which makes them load-bearing.
	it('counts from the hunk header, not from the top of the diff', () => {
		const d = [
			'+++ b/docs/notes.md',
			'@@ -40,3 +40,4 @@',
			' context line',
			' another context line',
			'+host 10.0.0.5',
		].join('\n');
		const f = scanDiff(d, CFG);
		expect(f[0]?.lineNumber).toBe(42);
	});

	it('does not let removed lines advance the count', () => {
		// A deletion occupies no line in the post-image. Counting it shifts every later
		// finding by one and sends the reader to the wrong line.
		const d = [
			'+++ b/docs/notes.md',
			'@@ -1,3 +1,2 @@',
			'-deleted line',
			'-another deleted line',
			'+host 10.0.0.5',
		].join('\n');
		expect(scanDiff(d, CFG)[0]?.lineNumber).toBe(1);
	});

	it('restarts the count for each file in a multi-file diff', () => {
		const d = [
			'+++ b/a.md',
			'@@ -1,1 +1,1 @@',
			'+clean',
			'+++ b/b.md',
			'@@ -9,1 +9,1 @@',
			'+host 10.0.0.5',
		].join('\n');
		const f = scanDiff(d, CFG);
		expect(f[0]?.file).toBe('b.md');
		expect(f[0]?.lineNumber).toBe(9);
	});
});

describe('the scanner reports enough to act on', () => {
	it('attributes each finding to the file it came from across a multi-file diff', () => {
		const d = [diff('a/one.ts', 'clean'), diff('b/two.ts', 'host 10.0.0.9')].join('\n');
		const f = scanDiff(d, CFG);
		expect(f).toHaveLength(1);
		expect(f[0]?.file).toBe('b/two.ts');
	});
});
