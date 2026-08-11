// Does this diff need a changeset?
//
// The original check was `grep -qE '^(apps|packages)/'` inline in ci.yml, which fired on any
// workspace path including packages Changesets refused to bump — a gate that cannot be
// satisfied gets satisfied dishonestly. It was narrowed to publishable packages only.
//
// THAT WAS TOO NARROW, and the evidence is ten changesets. `apps/gateway` is `private: true`,
// so gateway-only work needed no changeset — but the gateway is what self-hosters actually
// run, and its behaviour changes are exactly what they need to read. Every one of those ten
// therefore named `@proxlane/shared` instead, describing a package that in most cases had not
// changed at all, because that was the only way to leave a record.
//
// `.changeset/config.json` now sets `privatePackages: { version: true, tag: false }`, so
// private packages are versioned and get a CHANGELOG without ever being published. Every
// workspace package is therefore VERSIONED, and this gate asks about that rather than about
// publishability.
//
// It lives here rather than inline so it can be tested. An inline check is one nobody can
// run locally, and this repo has already been bitten twice by exactly that.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Workspace directories whose package Changesets versions, e.g. `packages/adapters`.
 *
 * With `privatePackages.version` on that is all of them, so this reads the config rather than
 * assuming: turning the setting off must narrow the gate back to publishable packages, not
 * leave it demanding changesets nothing can bump.
 */
export function versionedDirs(root: string): string[] {
	let versionsPrivate = false;
	const configPath = join(root, '.changeset/config.json');
	if (existsSync(configPath)) {
		const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as {
			privatePackages?: { version?: boolean } | boolean;
		};
		const pp = cfg.privatePackages;
		versionsPrivate = pp === true || (typeof pp === 'object' && pp?.version === true);
	}
	const out: string[] = [];
	for (const group of ['packages', 'apps']) {
		const base = join(root, group);
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const manifest = join(base, name, 'package.json');
			if (!existsSync(manifest)) continue;
			const json = JSON.parse(readFileSync(manifest, 'utf8')) as { private?: boolean };
			if (json.private !== true || versionsPrivate) out.push(`${group}/${name}`);
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
	versioned: readonly string[],
): Verdict {
	const touched = changed.filter((f) => {
		const dir = versioned.find((d) => f.startsWith(`${d}/`));
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

	const dirs = versionedDirs(ROOT);
	if (dirs.length === 0) {
		process.stderr.write('no versioned packages found — this check parsed nothing\n');
		process.exit(1);
	}

	const { required, touched } = changesetRequired(changed, dirs);
	if (!required) {
		process.stdout.write(
			'  no versioned package changed — no changeset needed\n' +
				`  (${dirs.length} versioned: ${dirs.join(', ')})\n`,
		);
		process.exit(0);
	}

	const hasChangeset = changed.some((f) => /^\.changeset\/.*\.md$/.test(f));
	if (hasChangeset) {
		process.stdout.write(
			`  changeset present, and ${touched.length} versioned file(s) changed\n`,
		);
		process.exit(0);
	}
	process.stdout.write(
		'::error::a versioned package changed without a changeset. Run `pnpm changeset`.\n' +
			touched.map((f) => `  ${f}\n`).join(''),
	);
	process.exit(1);
}
