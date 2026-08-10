// Does this diff need a changeset?
//
// The old check was `grep -qE '^(apps|packages)/'` inline in ci.yml, which fires on ANY
// workspace path. That is wrong in the one direction that matters: `apps/gateway` and
// `apps/web` are `private: true` and can never be published, so there is no version to bump
// and no consumer to inform. Changesets itself refuses to bump a private package, so the
// gate demanded a file that could not meaningfully be written.
//
// A gate that cannot be satisfied gets satisfied dishonestly — with an empty changeset, or
// by someone deleting the job. So it now asks the only question that has an answer: did a
// PUBLISHABLE package change?
//
// It lives here rather than inline so it can be tested. An inline check is one nobody can
// run locally, and this repo has already been bitten twice by exactly that.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Workspace directories whose package is publishable, e.g. `packages/adapters`. */
export function publishableDirs(root: string): string[] {
	const out: string[] = [];
	for (const group of ['packages', 'apps']) {
		const base = join(root, group);
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const manifest = join(base, name, 'package.json');
			if (!existsSync(manifest)) continue;
			const json = JSON.parse(readFileSync(manifest, 'utf8')) as { private?: boolean };
			if (json.private !== true) out.push(`${group}/${name}`);
		}
	}
	return out;
}

export interface Verdict {
	readonly required: boolean;
	/** The publishable paths that triggered it, so the message can name them. */
	readonly touched: string[];
}

export function changesetRequired(
	changed: readonly string[],
	publishable: readonly string[],
): Verdict {
	const touched = changed.filter((f) => {
		const dir = publishable.find((d) => f.startsWith(`${d}/`));
		if (dir === undefined) return false;
		// A test-only change ships no behaviour. Requiring a changeset for one trains people
		// to write empty changesets, which is worse than not asking.
		if (/\.(test|spec)\.[cm]?tsx?$/.test(f)) return false;
		// Fixtures and corpora are recordings, not code. Re-recording after provider drift, or
		// capturing a new block page, changes no published behaviour of ours — and neither
		// directory ships, since `files` is a dist-only allowlist. The corpus exemption was
		// missing and the gate fired on a captured JSON file.
		if (f.includes('/fixtures/') || f.includes('/corpus/')) return false;
		return true;
	});
	return { required: touched.length > 0, touched };
}

if (import.meta.filename === process.argv[1]) {
	const base = process.argv[2];
	if (base === undefined) {
		process.stderr.write('usage: node scripts/changeset-required.ts <base-ref>\n');
		process.exit(2);
	}
	const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean);

	const dirs = publishableDirs(ROOT);
	if (dirs.length === 0) {
		process.stderr.write('no publishable packages found — this check parsed nothing\n');
		process.exit(1);
	}

	const { required, touched } = changesetRequired(changed, dirs);
	if (!required) {
		process.stdout.write(
			'  no publishable package changed — no changeset needed\n' +
				`  (${dirs.length} publishable: ${dirs.join(', ')})\n`,
		);
		process.exit(0);
	}

	const hasChangeset = changed.some((f) => /^\.changeset\/.*\.md$/.test(f));
	if (hasChangeset) {
		process.stdout.write(
			`  changeset present, and ${touched.length} publishable file(s) changed\n`,
		);
		process.exit(0);
	}
	process.stdout.write(
		`::error::a publishable package changed without a changeset. Run \`pnpm changeset\`.\n` +
			touched.map((f) => `  ${f}\n`).join(''),
	);
	process.exit(1);
}
