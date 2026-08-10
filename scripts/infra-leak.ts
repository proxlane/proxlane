// Scans a PR diff for infrastructure that must not enter a public repo.
//
// Extracted from an inline `node -e` block in ci.yml, for the reason this repo keeps
// relearning: a check nobody can run locally is a check nobody has verified. It now has
// unit tests, and the tests break it on purpose.
//
// TWO CLASSES OF PATTERN, and the distinction is the whole design.
//
//   generic  — heuristics like "any RFC1918 literal". They have LEGITIMATE exceptions: a
//              security control whose job is refusing private ranges has to name them. So
//              these honour excludePaths.
//
//   always   — our ACTUAL coordinates: the box address, real hostnames. These have no
//              legitimate use in any file, so they ignore excludePaths entirely.
//              Critically, they are supplied at RUNTIME from a secret and never stored
//              here — writing the box IP into a public patterns file to stop the box IP
//              reaching a public repo is self-defeating, and that is exactly the hole this
//              file used to have.
//
// The split also repairs the path exclusion. Before, excluding a file disabled EVERY
// pattern for it; now it only relaxes the heuristics, and a real coordinate is still caught
// in an excluded file.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface LeakConfig {
	readonly patterns: readonly string[];
	readonly excludePaths: readonly string[];
}

export interface Finding {
	readonly file: string;
	readonly line: string;
	/** 1-indexed within the file's post-image, so a withheld finding is still locatable. */
	readonly lineNumber: number;
	readonly kind: 'generic' | 'always';
}

/**
 * Scan a unified diff. Pure, so it can be tested without a repo, a network or a CI run.
 *
 * Only ADDED lines are considered: this job holds the line forward and cannot see anything
 * already at HEAD, which is stated here because it is the limit people assume away.
 */
export function scanDiff(
	diff: string,
	cfg: LeakConfig,
	alwaysPatterns: readonly string[] = [],
): Finding[] {
	const generic = cfg.patterns.map((p) => new RegExp(p));
	const always = alwaysPatterns.map((p) => new RegExp(p, 'i'));
	const findings: Finding[] = [];
	let file = '';
	let lineNumber = 0;

	for (const raw of diff.split('\n')) {
		const header = /^\+\+\+ b\/(.+)$/.exec(raw);
		if (header) {
			file = header[1] as string;
			lineNumber = 0;
			continue;
		}
		// Track position from the hunk header so a withheld `always` finding is still
		// locatable by file and line.
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (hunk) {
			lineNumber = Number(hunk[1]) - 1;
			continue;
		}
		if (raw.startsWith('-')) continue;
		if (!raw.startsWith('+')) {
			lineNumber++;
			continue;
		}
		if (raw.startsWith('+++')) continue;
		lineNumber++;
		const line = raw.slice(1);

		// Absolute first, and without consulting excludePaths. A path exclusion is a statement
		// about heuristics, never a licence to paste a real address there.
		if (always.some((r) => r.test(line))) {
			findings.push({ file, line, lineNumber, kind: 'always' });
			continue;
		}
		if (cfg.excludePaths.some((p) => file === p || file.startsWith(p))) continue;
		if (generic.some((r) => r.test(line))) {
			findings.push({ file, line, lineNumber, kind: 'generic' });
		}
	}
	return findings;
}

/** Split a secret holding one pattern per line, tolerating blanks and comments. */
export function parseAlwaysPatterns(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s !== '' && !s.startsWith('#'));
}

if (import.meta.filename === process.argv[1]) {
	const diffPath = process.argv[2];
	if (diffPath === undefined || !existsSync(diffPath)) {
		process.stderr.write('usage: node scripts/infra-leak.ts <path-to-diff>\n');
		process.exit(2);
	}
	const cfg = JSON.parse(read('scripts/infra-leak-patterns.json')) as LeakConfig;
	const always = parseAlwaysPatterns(process.env.EXTRA_INFRA_PATTERNS);

	if (always.length === 0) {
		// A warning, not an error. Fork PRs do not receive secrets, and failing here would
		// block every community contribution to prevent a leak a contributor cannot cause.
		// But it is said out loud, because a scan that quietly covers less than it claims is
		// the vacuous pass this repo is arranged against.
		process.stdout.write(
			'::warning title=infra-leak::EXTRA_INFRA_PATTERNS is not set. ' +
				'Scanning with generic patterns only — our own coordinates are NOT covered on this run.\n',
		);
	} else {
		process.stdout.write(`  ${always.length} private pattern(s) loaded from the secret\n`);
	}

	const findings = scanDiff(read(diffPath), cfg, always);
	for (const f of findings) {
		// An `always` finding is NOT echoed. The matched text is the coordinate itself, and
		// this log is public on a public repo — printing it would leak the exact string the
		// job exists to keep out, in the job that caught it.
		//
		// GitHub's own secret masking does not save us here: the secret is a REGEX
		// (`167\.233\.…`) and the matched line has no backslashes, so the strings differ and
		// the mask does not apply. The file and the line number are enough to act on.
		const where = `${f.file}:${f.lineNumber}`;
		process.stdout.write(
			f.kind === 'always'
				? `::error::[always] ${where} matches a private infrastructure pattern. ` +
						'Content withheld — this log is public. Check the line locally.\n'
				: `::error::[generic] ${where}: ${f.line.slice(0, 120)}\n`,
		);
	}
	if (findings.length > 0) {
		process.stdout.write(`\n${findings.length} infrastructure leak(s) in this diff\n`);
		process.exit(1);
	}
	process.stdout.write('  no infrastructure leaked in this diff\n');
}

function read(p: string): string {
	return readFileSync(p.startsWith('/') ? p : join(ROOT, p), 'utf8');
}
