// `pnpm release:dry` — would a release work, without doing one.
//
// Three halves, because three different things go wrong.
//
//   changeset status   Are the pending version bumps what you expect? This is the half
//                      that catches "we shipped a breaking change as a patch".
//   pnpm pack          Would each publishable package actually build a tarball, with
//                      its licence, its bin, and no missing file?
//   provenance         Would the registry ACCEPT that tarball? Packing correctly and
//                      publishing successfully are different questions, and 0.1.0 found
//                      the gap between them the hard way. See the block near the checks.
//
// What `npm publish --dry-run` structurally CANNOT catch is the failure that matters most:
// a published package depending on a private one resolves fine in a workspace and 404s for
// the installer. `repo:check` assertion 12 owns that, and this file does not duplicate it.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The repository npm provenance expects every published manifest to point at.
 *
 * Publishing with provenance is a THREE-way agreement: the workflow signs an attestation
 * naming the building repo, the registry verifies it, and the tarball's own
 * `repository.url` must name the same place. Miss the third and the registry rejects the
 * upload with E422 after the attestation is already in the public transparency log.
 */
const CANONICAL_REPO = 'https://github.com/proxlane/proxlane';

/**
 * Reduce the several spellings npm accepts to the one form the registry compares against:
 * `git+https://github.com/o/r.git`, `git://…`, `https://….git` and a bare `o/r` shorthand all
 * mean the same repository.
 */
function normaliseRepoUrl(url: string): string {
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	return url
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/^ssh:\/\/git@/, 'https://')
		.replace(/^git@([^:]+):/, 'https://$1/')
		.replace(/\.git$/, '')
		.replace(/\/$/, '');
}

interface Pkg {
	dir: string;
	name: string;
	private?: boolean;
	version?: string;
}

function workspacePackages(): Pkg[] {
	const out: Pkg[] = [];
	for (const group of ['packages', 'apps']) {
		const base = join(ROOT, group);
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const p = join(base, name, 'package.json');
			if (!existsSync(p)) continue;
			const json = JSON.parse(readFileSync(p, 'utf8')) as Pkg;
			out.push({ ...json, dir: join(base, name) });
		}
	}
	return out;
}

const publishable = workspacePackages().filter((p) => p.private !== true);
const tmp = mkdtempSync(join(tmpdir(), 'proxlane-release-'));

if (publishable.length === 0) {
	// Non-zero denominator. A release rehearsal that rehearsed nothing is not a pass, and
	// this is the exact shape of vacuous green the assertion set exists to refuse.
	process.stderr.write(
		'release:dry found no publishable packages — that is a bug, not a clean release\n',
	);
	process.exit(1);
}

let failed = 0;

process.stdout.write('\n  changesets\n');
try {
	// `changeset status` exits non-zero when there are no changesets, which is the normal
	// state on main and is not a release failure. Report it and carry on.
	const out = execFileSync('pnpm', ['exec', 'changeset', 'status'], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	process.stdout.write(
		out
			.split('\n')
			.filter((l) => l.trim())
			.map((l) => `    ${l}\n`)
			.join(''),
	);
} catch {
	process.stdout.write('    no pending changesets — nothing would be released\n');
}

process.stdout.write(`\n  ${publishable.length} publishable package(s)\n`);
for (const pkg of publishable) {
	process.stdout.write(`    ${pkg.name.padEnd(22)}`);
	try {
		// PNPM pack, not npm. This is not a preference — `npm publish` leaves `workspace:*`
		// verbatim in the published manifest and the package is then UNINSTALLABLE:
		//
		//   npm error code EUNSUPPORTEDPROTOCOL
		//   npm error Unsupported URL Type "workspace:": workspace:*
		//
		// That shipped. proxlane@0.0.0 went to the registry that way, because
		// `npm publish --dry-run` succeeds on it — a dry run that cannot fail on the one
		// thing that breaks installation is not a rehearsal. pnpm rewrites the protocol to a
		// real version, so packing with pnpm is what tells the truth here.
		execFileSync('pnpm', ['pack', '--pack-destination', tmp], {
			cwd: pkg.dir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const tarball = readdirSync(tmp)
			.filter((f) => f.endsWith('.tgz'))
			.map((f) => join(tmp, f))
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] as string;

		const manifest = JSON.parse(
			execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
		) as {
			dependencies?: Record<string, string>;
			repository?: string | { url?: string; directory?: string };
		};

		const unresolved = Object.entries(manifest.dependencies ?? {}).filter(([, v]) =>
			v.startsWith('workspace:'),
		);
		const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });

		const problems: string[] = [];
		for (const [dep, range] of unresolved) {
			problems.push(`${dep} is still "${range}" — the tarball cannot be installed`);
		}
		if (!/package\/LICENSE/.test(files)) {
			problems.push('no LICENSE in the tarball — packaging succeeded, licensing did not');
		}

		// Provenance preconditions, checked against the TARBALL manifest rather than the source
		// one, because the tarball is what the registry validates and pnpm rewrites the manifest
		// on its way there.
		//
		// This check exists because its absence shipped. proxlane 0.1.0's release failed with
		// E422 on all four packages — `"repository.url" is ""` — after `release:dry` had gone
		// green in the same workflow run, minutes earlier. The rehearsal packed the tarball and
		// read its dependencies and licence, then declared "a release would work" about a
		// release that could not. The 0.0.1 placeholders had hidden it by being published
		// without provenance at all, so the field was never required until it suddenly was.
		//
		// The failure is not recoverable by retrying: the signed attestation reaches Sigstore's
		// public transparency log BEFORE the registry rejects the upload.
		{
			const repo = manifest.repository;
			const url = typeof repo === 'string' ? repo : repo?.url;
			if (!url) {
				problems.push(
					'no repository.url in the tarball manifest — npm provenance rejects this with E422',
				);
			} else if (normaliseRepoUrl(url) !== CANONICAL_REPO) {
				problems.push(
					`repository.url is "${url}" (reads as ${normaliseRepoUrl(url)}), ` +
						`but provenance expects ${CANONICAL_REPO}`,
				);
			}
			// `directory` is not required by the registry, but without it every package on npm
			// links to the repo root, which for a monorepo of eleven packages is a dead end.
			const directory = typeof repo === 'object' ? repo?.directory : undefined;
			const expected = pkg.dir.slice(ROOT.length + 1);
			if (url && directory !== expected) {
				problems.push(
					`repository.directory is ${directory === undefined ? 'missing' : `"${directory}"`}, ` +
						`expected "${expected}" so npm links to the package rather than the repo root`,
				);
			}
		}

		if (problems.length === 0) {
			process.stdout.write('ok\n');
		} else {
			process.stdout.write('FAILED\n');
			for (const pr of problems) process.stdout.write(`      ${pr}\n`);
			failed++;
		}
	} catch (err) {
		const e = err as { stderr?: string; stdout?: string };
		process.stdout.write('FAILED\n');
		const detail = `${e.stderr ?? ''}${e.stdout ?? ''}`
			.split('\n')
			.filter((l) => /error|ERR!/i.test(l))
			.slice(0, 3);
		for (const l of detail) process.stdout.write(`      ${l.trim()}\n`);
		failed++;
	}
}

// Publish ORDER, because a scoped dependency must exist on the registry before the package
// that names it. proxlane@0.0.0 depends on @proxlane/adapters, which is not published, so
// even a correctly-packed CLI would 404 for the installer until adapters lands first.
{
	const names = new Set(publishable.map((p) => p.name));
	const deps = new Map(
		publishable.map((p) => [
			p.name,
			Object.keys((p as { dependencies?: Record<string, string> }).dependencies ?? {}).filter(
				(d) => names.has(d),
			),
		]),
	);
	const order: string[] = [];
	const seen = new Set<string>();
	const visit = (n: string): void => {
		if (seen.has(n)) return;
		seen.add(n);
		for (const d of deps.get(n) ?? []) visit(d);
		order.push(n);
	};
	for (const p of publishable) visit(p.name);
	process.stdout.write(`\n  publish in this order:\n    ${order.join('  ->  ')}\n`);
}

if (failed > 0) {
	process.stdout.write(`\n  ${failed} package(s) would not release cleanly\n\n`);
	process.exit(1);
}
process.stdout.write(
	'\n  a release would work. Note this does NOT prove installability:\n' +
		'  a published package depending on a private one resolves here and 404s for the\n' +
		'  installer. repo:check assertion 12 is what covers that.\n\n',
);
