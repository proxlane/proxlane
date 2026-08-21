// repo:check — the one exit criterion whose subject already exists on day one.
//
// Zero dependencies: it must run before `pnpm install` has ever succeeded, and it must not
// be able to fail for a reason unrelated to what it is checking.
//
// Every assertion carries a non-zero denominator. A check that examined zero items exits 1
// and says so, because a vacuous pass is the same lie as a zero-exit stub. There are
// exactly two documented exemptions, both marked EXEMPT below.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodeowners, parseTable, ticks } from './codeowners.ts';
import {
	apply as applyProviders,
	BEGIN as PROVIDERS_BEGIN,
	plannedButShipped,
	registryProviderCount,
} from './readme-providers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const failures: string[] = [];
const notes: string[] = [];
let checked = 0;

function fail(assertion: string, detail: string): void {
	failures.push(`  [${assertion}] ${detail}`);
}
function ok(assertion: string, n: number, what: string): void {
	checked += n;
	notes.push(`  ok  ${assertion.padEnd(3)} ${String(n).padStart(4)} ${what}`);
}
function read(p: string): string {
	return readFileSync(join(ROOT, p), 'utf8');
}
/**
 * Every TypeScript source under a directory, concatenated.
 *
 * Used only to answer "does anything actually read this environment variable". Grepping the
 * built output would miss a variable read at boot in a package that has not been built, and
 * grepping .env.example alone is what let PROXLANE_SHARE_STATS survive: it was in neither.
 */
function tsSources(rel: string): string {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			if (name === 'node_modules' || name === 'dist' || name === '.output') continue;
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name.endsWith('.ts') || name.endsWith('.tsx'))
				out.push(readFileSync(full, 'utf8'));
		}
	};
	walk(join(ROOT, rel));
	return out.join('\n');
}

function has(p: string): boolean {
	return existsSync(join(ROOT, p));
}

// ---------------------------------------------------------------- shared parsing

type Entry = {
	id: string;
	kind: 'root-script' | 'filtered-script' | 'bin';
	owner: string;
	brief: string;
	spec: string;
	subject: string;
	blockedBy?: string[];
	argsRequired?: boolean;
	status: 'implemented' | 'not-implemented';
	gate?: string;
	ci: 'pr' | 'none';
};

const manifest = JSON.parse(read('scripts/commands.json')) as Record<string, Entry | string[]>;
const entries = Object.entries(manifest).filter(([k]) => !k.startsWith('$')) as [
	string,
	Entry,
][];

const rootPkg = JSON.parse(read('package.json'));
const rootScripts: Record<string, string> = rootPkg.scripts ?? {};

const claudeMd = read('CLAUDE.md');

// ------------------------------------------------------- 1. Commands table ⟷ manifest
//
// The count is DERIVED from the parse. Never a literal: the table gained a row for
// `pnpm bootstrap` in this very PR, and a hardcoded number would have made that a refactor.
{
	const rows = parseTable(claudeMd, /^\| Command \| What it gates \|/);
	const tableIds: string[] = [];
	for (const row of rows) {
		const cell = row[0] ?? '';
		for (const tok of ticks(cell)) {
			// `pnpm dev` -> dev ; `pnpm conformance [--adapter=<id>]` -> conformance
			// `pnpm --filter @proxlane/db test` -> --filter @proxlane/db test
			// `proxlane doctor` -> proxlane doctor
			const id = tok
				.replace(/^pnpm\s+/, '')
				.replace(/\s*\[.*?\]\s*$/, '')
				.replace(/\s*<[^>]*>\s*$/, '')
				.replace(/\s+--[\w-]+=?$/, '')
				.trim();
			if (id) tableIds.push(id);
		}
	}

	if (tableIds.length === 0) {
		fail(
			'1',
			'parsed zero commands from the CLAUDE.md Commands table — parser or table is broken',
		);
	} else {
		const manifestIds = new Set(entries.map(([k]) => k));
		const missing = tableIds.filter((id) => !manifestIds.has(id));
		const extra = [...manifestIds].filter((id) => !tableIds.includes(id));
		if (missing.length) fail('1', `in CLAUDE.md but not commands.json: ${missing.join(', ')}`);
		if (extra.length) fail('1', `in commands.json but not CLAUDE.md: ${extra.join(', ')}`);

		for (const [id, e] of entries) {
			if (e.kind === 'root-script') {
				if (!(id in rootScripts))
					fail('1', `${id}: kind=root-script but no root package.json script`);
			} else if (e.kind === 'filtered-script') {
				const m = /^--filter\s+(\S+)\s+(\S+)$/.exec(id);
				if (!m) {
					fail('1', `${id}: kind=filtered-script but id is not "--filter <pkg> <script>"`);
				} else {
					const dir = findWorkspaceDir(m[1] as string);
					if (!dir) fail('1', `${id}: workspace package ${m[1]} not found`);
					else if (!JSON.parse(read(join(dir, 'package.json'))).scripts?.[m[2] as string])
						fail('1', `${id}: ${m[1]} has no "${m[2]}" script`);
				}
			} else if (e.kind === 'bin') {
				// The bin ships standalone and cannot read this manifest at runtime, so it
				// hand-copies the message. Duplication is forced; silent drift is not.
				const binSrc = read('packages/cli/src/bin.ts');
				if (e.status === 'not-implemented') {
					for (const field of ['owner', 'spec', 'subject'] as const) {
						if (!binSrc.includes(e[field]))
							fail(
								'1',
								`${id}: bin.ts does not mention its ${field} "${e[field]}" — the copy has drifted`,
							);
					}
				}
				const binOwner = 'packages/cli';
				const cliPkg = JSON.parse(read(`${binOwner}/package.json`));
				const binName = id.split(' ')[0] as string;
				const bins =
					typeof cliPkg.bin === 'string' ? { [cliPkg.name]: cliPkg.bin } : (cliPkg.bin ?? {});
				if (!(binName in bins)) fail('1', `${id}: ${binOwner} declares no "${binName}" bin`);
				if (!rootPkg.dependencies?.[cliPkg.name])
					fail(
						'1',
						`${id}: root package.json must depend on ${cliPkg.name} so pnpm links its bin`,
					);
			} else {
				fail('1', `${id}: unknown kind "${(e as Entry).kind}"`);
			}
		}
		// The CI matrix invokes `pnpm <id>` bare. A command that requires an argument exits
		// with usage and fails the build — caught the first time `new-adapter` entered the
		// matrix. Its correctness belongs in a unit test instead.
		for (const [id, e] of entries) {
			if (e.argsRequired && e.ci === 'pr')
				fail(
					'1',
					`${id}: argsRequired but ci=pr — the matrix runs it bare and it will exit with usage`,
				);
		}
		ok('1', tableIds.length, 'commands in the table, each resolvable by kind');
	}
}

// ------------------------------------------------------------ 2. Status ⟷ reality
//
// First half (implemented subjects exist) carries the non-zero floor and is NEVER exempt.
// Second half (not-implemented subjects absent) legitimately empties when the last stub
// flips, so it gets the documented exemption.
//
// Only `subject` is asserted. `blockedBy` is documentation for the stub message — asserting
// it would fire a false red the moment the blocking file lands.
{
	const impl = entries.filter(([, e]) => e.status === 'implemented');
	const stubs = entries.filter(([, e]) => e.status === 'not-implemented');

	if (impl.length === 0) fail('2', 'zero implemented commands — cannot be right');
	for (const [id, e] of impl) {
		if (!has(e.subject))
			fail('2', `${id}: status=implemented but subject ${e.subject} does not exist`);
	}
	for (const [id, e] of stubs) {
		if (has(e.subject))
			fail('2', `${id}: subject ${e.subject} now EXISTS — flip status to "implemented"`);
	}
	// Existence of the subject is not reachability of the subject.
	//
	// `new-adapter` and `record` sat at status=implemented with their subjects on disk while
	// `pnpm new-adapter` and `pnpm record` still routed to the stub harness and exited 1. The
	// manifest — the thing that exists so progress "cannot drift the way a status document
	// does" — was wrong about two of its nine implemented commands, and the half of assertion
	// 2 above could not see it, because the file it checks did exist.
	//
	// It went unnoticed because the work was done by running `node scripts/record.ts`
	// directly. The documented interface was broken the entire time.
	const rootScripts = (JSON.parse(read('package.json')) as { scripts?: Record<string, string> })
		.scripts;
	let wired = 0;
	for (const [id, e] of impl) {
		if (e.kind !== 'root-script') continue;
		const script = rootScripts?.[id];
		if (script === undefined) {
			fail('2', `${id}: status=implemented but package.json has no "${id}" script`);
			continue;
		}
		if (script.includes('not-implemented')) {
			fail('2', `${id}: status=implemented but "pnpm ${id}" still runs the stub harness`);
			continue;
		}
		// A root script that neither names its subject nor delegates to a task runner is not
		// obviously reaching the thing the manifest credits it for.
		const delegates = /^(turbo|vitest|biome|tsc|changeset)\b/.test(script.trim());
		if (!delegates && !script.includes(e.subject)) {
			fail('2', `${id}: "pnpm ${id}" does not reference its subject ${e.subject}`);
			continue;
		}
		wired++;
	}
	if (wired === 0) fail('2', 'no implemented root-script resolved to its subject');

	ok('2', impl.length, 'implemented subjects exist (floor, never exempt)');
	ok('2', wired, 'implemented root scripts actually reach their subject, not the stub');
	ok(
		'2',
		stubs.length,
		`not-implemented subjects absent${stubs.length === 0 ? ' — EXEMPT, set is empty' : ''}`,
	);
}

// ------------------------------------------------------------------- workspace scan

function listWorkspaceDirs(): string[] {
	const globs = ['apps', 'packages', 'tooling'];
	const out: string[] = [];
	for (const g of globs) {
		const dir = join(ROOT, g);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory() && existsSync(join(p, 'package.json')))
				out.push(`${g}/${name}`);
		}
	}
	if (existsSync(join(ROOT, 'scripts/package.json'))) out.push('scripts');
	return out;
}
function findWorkspaceDir(pkgName: string): string | undefined {
	return listWorkspaceDirs().find(
		(d) => JSON.parse(read(join(d, 'package.json'))).name === pkgName,
	);
}
const wsDirs = listWorkspaceDirs();
const wsPkgs = wsDirs.map((d) => ({ dir: d, json: JSON.parse(read(join(d, 'package.json'))) }));

// ------------------------------------------------- 3 + 4. CODEOWNERS generated & total
{
	const generated = buildCodeowners(claudeMd);
	if (!has('.github/CODEOWNERS')) {
		fail('3', '.github/CODEOWNERS does not exist — run scripts/codeowners.ts');
	} else if (read('.github/CODEOWNERS') !== generated) {
		fail('3', '.github/CODEOWNERS differs from the ownership table — regenerate it');
	} else {
		ok(
			'3',
			generated.split('\n').filter((l) => l && !l.startsWith('#')).length,
			'CODEOWNERS lines regenerate byte-identical',
		);
	}

	const patterns = generated
		.split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#'))
		.map((l) => l.trim().split(/\s+/)[0] as string);
	// TRACKED PLUS UNTRACKED-AND-NOT-IGNORED. `git ls-files` alone sees only what is already
	// committed, so a brand new file — the exact case where ownership is most likely to be
	// missing — is invisible until after it is staged. That made `pnpm check` green on a
	// working tree that CI would reject, which is precisely the "passes locally, fails in CI"
	// that command exists to prevent. Caught by the pre-push hook on the LICENSE files.
	const listed = (args: string[]) =>
		execFileSync('git', ['ls-files', ...args], { cwd: ROOT, encoding: 'utf8' })
			.split('\n')
			.filter(Boolean);
	const tracked = [...new Set([...listed([]), ...listed(['--others', '--exclude-standard'])])];
	if (tracked.length === 0) fail('4', 'git ls-files returned nothing');
	const unowned = tracked.filter((f) => !patterns.some((p) => matchesOwner(p, f)));
	if (unowned.length) {
		fail(
			'4',
			`${unowned.length} tracked path(s) match no CODEOWNERS pattern, e.g.: ${unowned.slice(0, 6).join(', ')}`,
		);
	}
	ok('4', tracked.length, 'tracked paths, each matching >=1 CODEOWNERS pattern');
}

// ------------------------------------------------------------ 5. package.json shape
{
	if (wsPkgs.length === 0) fail('5', 'no workspace packages found');
	const owned = ownedPathPrefixes(claudeMd);
	for (const { dir, json } of wsPkgs) {
		const isTooling = dir.startsWith('tooling/') || dir === 'scripts';
		if (json.type !== 'module') fail('5', `${dir}: missing "type": "module"`);
		if (!json.scripts?.typecheck)
			fail('5', `${dir}: no typecheck script (tooling is NOT exempt)`);
		if (!isTooling) {
			if (!json.scripts?.build) fail('5', `${dir}: no build script`);
			if (!json.license) fail('5', `${dir}: no license field`);
		} else {
			if (json.private !== true) fail('5', `${dir}: tooling must be private: true`);
			if (json.license) fail('5', `${dir}: tooling must not declare a license`);
		}
		if (!owned.some((p) => dir.startsWith(p))) fail('5', `${dir}: not under any owned path`);
	}
	ok('5', wsPkgs.length, 'workspace packages well-formed');
}

// --------------------------------------------- 6. catalog ⟷ pinned toolchain (npm only)
{
	const rows = parseTable(claudeMd, /^\| Thing \| Kind \| Package \| Pin \| Why this one \|/);
	if (rows.length === 0) fail('6', 'parsed zero rows from the pinned-toolchain table');
	const kinds = new Set(rows.map((r) => (r[1] ?? '').trim()));
	for (const k of kinds) {
		if (!['npm', 'runtime', 'image'].includes(k))
			fail(
				'6',
				`unknown kind "${k}" — exactly three are allowed, each mapped to one assertion`,
			);
	}
	const npmRows = rows
		.filter((r) => (r[1] ?? '').trim() === 'npm')
		.map((r) => ({ pkg: ticks(r[2] ?? '')[0], pin: ticks(r[3] ?? '')[0] }));
	if (npmRows.length < 5) fail('6', `only ${npmRows.length} npm rows — floor is 5`);

	const catalog = parseCatalog(read('pnpm-workspace.yaml'));
	if (Object.keys(catalog).length === 0) fail('6', 'catalog is empty in pnpm-workspace.yaml');
	for (const { pkg, pin } of npmRows) {
		if (!pkg || !pin) {
			fail('6', `a npm row is missing a backticked Package or Pin cell`);
			continue;
		}
		if (!(pkg in catalog)) fail('6', `${pkg} is in the toolchain table but not in catalog:`);
		else if (catalog[pkg] !== pin)
			fail('6', `${pkg}: table says ${pin}, catalog says ${catalog[pkg]}`);
	}
	// inverse: nothing may sit in the catalog unannounced
	for (const key of Object.keys(catalog)) {
		if (!npmRows.some((r) => r.pkg === key))
			fail('6', `${key} is in catalog: but has no npm row in the toolchain table`);
	}
	ok('6', npmRows.length, 'npm pins agree with the catalog, both directions');

	// 7. runtime rows
	const runtime = Object.fromEntries(
		rows
			.filter((r) => (r[1] ?? '').trim() === 'runtime')
			.map((r) => [ticks(r[2] ?? '')[0], ticks(r[3] ?? '')[0]]),
	);
	const nvmrc = read('.nvmrc').trim();
	if (runtime.node && runtime.node !== nvmrc)
		fail('7', `.nvmrc is ${nvmrc}, table says ${runtime.node}`);
	if (!/^\d+\.\d+\.\d+$/.test(nvmrc))
		fail('7', `.nvmrc must be a full version, got "${nvmrc}"`);
	const engines = String(rootPkg.engines?.node ?? '');
	const major = nvmrc.split('.')[0];
	if (!engines.includes(`>=${major}.`) || !engines.includes(`<${Number(major) + 1}`))
		fail('7', `engines.node "${engines}" does not bracket .nvmrc major ${major}`);
	const pm = String(rootPkg.packageManager ?? '');
	if (!/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{100,}$/.test(pm))
		fail('7', 'packageManager must carry a full sha512 integrity hash');
	if (runtime.pnpm && !pm.startsWith(`pnpm@${runtime.pnpm}+`))
		fail('7', `packageManager is ${pm.split('+')[0]}, table says pnpm@${runtime.pnpm}`);
	ok('7', Object.keys(runtime).length, 'runtime pins agree with .nvmrc / packageManager');

	// 8. image rows
	const imageRows = rows
		.filter((r) => (r[1] ?? '').trim() === 'image')
		.map((r) => `${ticks(r[2] ?? '')[0]}:${ticks(r[3] ?? '')[0]}`);
	if (imageRows.length === 0) fail('8', 'no image rows in the toolchain table');
	const constants = read('tooling/containers/images.ts');
	const composeText = read('docker/compose.dev.yml');
	for (const img of imageRows) {
		if (!constants.includes(`'${img}'`))
			fail('8', `${img} is in the table but not in images.ts`);
		if (!composeText.includes(img))
			fail('8', `${img} is in the table but not in compose.dev.yml`);
	}
	const composeImages = [...composeText.matchAll(/^\s*image:\s*(\S+)/gm)].map(
		(m) => m[1] as string,
	);
	for (const img of composeImages) {
		if (!imageRows.includes(img))
			fail('8', `compose.dev.yml uses ${img}, which is not a table row`);
	}
	ok('8', imageRows.length, 'image tags agree across table, images.ts and compose');
}

// ------------------------------------------------- 9. no live tests in the PR-path projects
{
	const vitest = read('vitest.config.ts');
	const liveGlobs = [...vitest.matchAll(/name:\s*'(\w+)'[\s\S]*?include:\s*\[([^\]]*)\]/g)].map(
		(m) => ({ name: m[1] as string, include: m[2] as string }),
	);
	// The old form was `!== 4`, a magic number standing in for "did the regex parse
	// everything?". It answered that question badly: adding the `ssrf` project made it fail
	// while nothing was actually wrong, and it would equally have passed if the regex broke
	// in a way that happened to still yield four. Count the declarations directly instead —
	// same guard, no literal to update, and it says what it means.
	const declared = [...vitest.matchAll(/^\s*name:\s*'(\w+)'/gm)].length;
	if (declared === 0)
		fail('9', 'parsed zero vitest projects — the config or this regex is broken');
	if (liveGlobs.length !== declared)
		fail(
			'9',
			`${declared} project(s) declared but only ${liveGlobs.length} parsed with an include`,
		);
	// The four PR-path and scheduled projects the command manifest depends on must exist.
	for (const required of ['unit', 'contract', 'e2e', 'live']) {
		if (!liveGlobs.some((p) => p.name === required))
			fail('9', `no "${required}" vitest project — a test command has nothing to run`);
	}
	for (const p of liveGlobs) {
		if (p.name !== 'live' && p.include.includes('live.test')) {
			fail(
				'9',
				`project "${p.name}" would match *.live.test.ts — real provider keys on a fork PR`,
			);
		}
	}
	const liveProject = liveGlobs.find((p) => p.name === 'live');
	if (!liveProject)
		fail('9', 'no "live" vitest project — live tests would fall into another project');
	ok('9', liveGlobs.length, 'vitest projects, live isolated by filename');
}

// ----------------------------------------------- 10 + 12. licence and publish-set integrity
{
	const byName = new Map(wsPkgs.map((p) => [p.json.name as string, p]));
	const isAgpl = (n: string) => byName.get(n)?.json.license === 'AGPL-3.0-only';
	const isApache = (n: string) => byName.get(n)?.json.license === 'Apache-2.0';
	const isPublishable = (n: string) => byName.get(n)?.json.private !== true;

	let pairs = 0;
	// Was `const … = 0`, never incremented — so assertion 12 reported "0 edges exist, nothing
	// to check" no matter what the workspace graph said. Two real edges existed by then
	// (cli -> adapters, shared -> adapters) and it still claimed none. A denominator that
	// cannot move is not a denominator; it is a sentence.
	let publishRuntimeEdges = 0;
	for (const { dir, json } of wsPkgs) {
		const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
		for (const dep of Object.keys(deps)) {
			if (!byName.has(dep)) continue;
			pairs++;
			if (isApache(json.name) && isAgpl(dep))
				fail(
					'10',
					`${dir} (Apache-2.0) depends on ${dep} (AGPL-3.0-only) — publishing it would relicense`,
				);
			// 12: a published package depending on a private one resolves locally and 404s for
			// the installer. `npm publish --dry-run` cannot catch this.
			if (isPublishable(json.name) && json.dependencies?.[dep] !== undefined) {
				// A RUNTIME dep of a publishable package — the edge that reaches an installer.
				// devDependencies never ship, so they are not counted and not checked.
				publishRuntimeEdges++;
				if (!isPublishable(dep))
					fail('12', `${dir} is publishable but depends on private ${dep}`);
			}
		}
	}
	ok('10', pairs, 'internal dependency edges checked for licence compatibility');

	// Reported separately from 10, because a licence edge and an installability edge are
	// different questions over the same graph.
	if (publishRuntimeEdges === 0) {
		// EXEMPT, and genuinely so: with no publishable package depending on another, there is
		// nothing an installer could fail to resolve. Distinct from the old behaviour, which
		// printed this unconditionally.
		notes.push('  --  12       0 publishable->workspace runtime deps — EXEMPT, none exist');
	} else {
		ok('12', publishRuntimeEdges, 'publishable runtime deps are themselves publishable');
	}
}

// ---------------------------------------- 11. the Base UI trap, and pnpm built-in collisions
{
	let scanned = 0;
	for (const { dir, json } of [...wsPkgs, { dir: '.', json: rootPkg }]) {
		scanned++;
		const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
		if ('@base-ui-components/react' in deps)
			fail(
				'11',
				`${dir} names @base-ui-components/react — abandoned at 1.0.0-rc.0, use @base-ui/react`,
			);
		for (const [name, range] of Object.entries(deps)) {
			if (name.startsWith('@proxlane/') || name === 'proxlane') continue;
			if (range === 'catalog:' || String(range).startsWith('workspace:')) continue;
			fail(
				'11',
				`${dir}: ${name}@${range} is a literal — every npm dependency routes through catalog:`,
			);
		}
	}
	// A root script whose name shadows a pnpm built-in can never be invoked. `pnpm setup`
	// would silently run pnpm's own command, append to the contributor's shell profile, and
	// exit 0 — the exit-0 failure this whole design exists to prevent.
	const PNPM_BUILTINS = new Set([
		'add',
		'audit',
		'bin',
		'config',
		'create',
		'dedupe',
		'deploy',
		'dlx',
		'doctor',
		'env',
		'exec',
		'fetch',
		'import',
		'init',
		'install',
		'link',
		'licenses',
		'list',
		'outdated',
		'pack',
		'patch',
		'prune',
		'publish',
		'rebuild',
		'remove',
		'root',
		'run',
		'server',
		'setup',
		'start',
		'store',
		'test',
		'unlink',
		'update',
		'why',
	]);
	for (const [id, e] of entries) {
		if (e.kind === 'root-script' && PNPM_BUILTINS.has(id))
			fail(
				'11',
				`"${id}" collides with a pnpm built-in — it can never be invoked as "pnpm ${id}"`,
			);
	}
	ok('11', scanned, 'package.json files free of the Base UI trap and version literals');
}

// ------------------------------------------------------- 15. B6 coverage
//
// operating.md B6 lists ten every-PR blocking jobs. Four are NOT Commands-table entries,
// so a matrix generated from the manifest alone drops them permanently and CI looks
// complete while missing them. This asserts the union of (manifest, named CI jobs) covers
// the list. It lives here rather than in PR 1 because PR 1 shipped no workflows and could
// not have satisfied it.
{
	const b6 = [
		'typecheck',
		'lint',
		'test:unit',
		'test:contract',
		'test:e2e',
		'conformance',
		'changeset',
		'secrets',
		'build:docker',
		'security-review',
	];
	const ciPath = '.github/workflows/ci.yml';
	if (!has(ciPath)) {
		fail('15', `${ciPath} does not exist, so B6 cannot be covered`);
	} else {
		const ci = read(ciPath);
		// A job id in the workflow, or a manifest entry the generated matrix will emit.
		const jobIds = [...ci.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1] as string);
		const manifestIds = new Set(entries.map(([k]) => k));
		const uncovered = b6.filter((row) => {
			const asJob = row.replace(/[:]/g, '-');
			return !manifestIds.has(row) && !jobIds.includes(asJob) && !jobIds.includes(row);
		});
		if (uncovered.length) {
			fail(
				'15',
				`B6 rows covered by neither the manifest nor a named CI job: ${uncovered.join(', ')}`,
			);
		}
		// The ruleset requires ONE check. Requiring B6's ten by name leaves every PR
		// permanently pending — six report under different names, four never report.
		if (!jobIds.includes('ci-complete')) {
			fail('15', 'ci.yml has no `ci-complete` gate job for the branch ruleset to require');
		}
		ok('15', b6.length, 'B6 rows covered by the manifest or a named CI job');
	}
}

// ------------------------------------------ 13 + 14. self-imposed limits, and the hooks
//
// Rules the repo states about itself and then breaks. state.md declared a 50-line cap and
// exceeded it twice in one afternoon; committed hooks do nothing unless core.hooksPath
// points at them.
{
	const stateText = read('docs/state.md');
	const stateLines = stateText.split('\n').length;
	const declared = /under (\d+) lines/i.exec(stateText);
	const cap = declared ? Number(declared[1]) : 50;
	if (stateLines > cap) {
		fail('13', `docs/state.md is ${stateLines} lines against its own ${cap}-line cap`);
	} else {
		ok('13', 1, `state.md within its self-declared ${cap}-line cap (${stateLines} lines)`);
	}

	const hooks = ['pre-commit', 'pre-push'];
	for (const h of hooks) {
		if (!has(`.githooks/${h}`)) fail('14', `.githooks/${h} is missing`);
	}
	ok('14', hooks.length, 'git hooks present; bootstrap points core.hooksPath at them');
}

// ------------------------------------- 16. dev adapters stay out of the product surface
//
// `_dev/` holds keyless adapters that exist to exercise the recorder and the conformance
// harness. They are NOT providers. The router, the /providers pages, the docs generator and
// the scoreboard all render from REGISTRY, so a dev entry reaching it would advertise a
// test service as supported — a lie shipped to the marketing site.
//
// Two ways that leak has already been attempted in one sitting: importing into registry.ts,
// and the recorder writing fixtures to `packages/adapters/src/<id>/` where they are
// indistinguishable from a real adapter's. Both are checked.
{
	const devDir = 'packages/adapters/src/_dev';
	// Own copy: assertion 4's `tracked` is block-scoped to it.
	// Filtered to what is actually on disk. `git ls-files` still reports a tracked file whose
	// deletion is not yet staged, and reading one throws ENOENT — which makes repo:check
	// CRASH mid-run rather than report. A check that dies is worse than one that fails: it
	// takes every later assertion down with it and the output blames the wrong thing.
	const trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
		.split('\n')
		.filter((f) => f !== '' && has(f));
	const devAdapters = trackedFiles.filter((f) => f.startsWith(`${devDir}/`));
	const devIds = [
		...new Set(
			devAdapters
				.map((f) => f.slice(devDir.length + 1).split('/')[0])
				.filter((id): id is string => id !== undefined),
		),
	];

	if (devIds.length === 0) {
		// Non-zero denominator: the assertion is meaningless with nothing to protect, and a
		// silently vacuous check is the defect this whole file exists against.
		fail('16', `${devDir} holds no adapters — delete assertion 16 or restore them`);
	} else {
		// Anything importing from _dev/ other than the dev registry itself is the leak.
		const importers = trackedFiles.filter(
			(f) =>
				f.endsWith('.ts') &&
				!f.startsWith(`${devDir}/`) &&
				f !== 'packages/adapters/src/dev-registry.ts' &&
				// An IMPORT specifier, not any mention of the string. repo-check.ts and
				// record.ts both name the directory legitimately — one checks it, one writes
				// fixtures into it — and an exemption list for those two is exactly what later
				// swallows a real leak. Match the vector instead of naming the innocents.
				/(?:from|import)\s*\(?\s*["'][^"']*_dev\//.test(read(f)),
		);
		for (const f of importers) {
			fail('16', `${f} references _dev/ — only dev-registry.ts may, or the leak reopens`);
		}

		// A dev id must not also exist as a real adapter directory, or `record` and the
		// router would disagree about which one `--adapter=<id>` means.
		for (const id of devIds) {
			if (trackedFiles.some((f) => f.startsWith(`packages/adapters/src/${id}/`))) {
				fail('16', `${id} exists as both a dev adapter and a real one`);
			}
		}

		if (has('packages/adapters/src/registry.ts')) {
			const registry = read('packages/adapters/src/registry.ts');
			for (const id of devIds) {
				if (registry.includes(id)) fail('16', `REGISTRY names the dev adapter ${id}`);
			}
		}

		// The door the source-level checks above do not watch, and the one the leak actually
		// came through: @proxlane/adapters publishes under Apache-2.0 with `files: ["dist"]`,
		// so re-exporting DEV_REGISTRY from src/index.ts put r.jina.ai in the published
		// bundle and DEV_REGISTRY in the public .d.mts. Source was clean; the artifact was not.
		//
		// Only checkable after a build. Skipped rather than failed when dist is absent —
		// `pnpm build` runs before `repo:check` in CI and in the pre-push hook, so the check
		// is live where it matters, and a clean clone must not fail for not having built yet.
		const distDir = 'packages/adapters/dist';
		if (has(distDir)) {
			for (const id of devIds) {
				const hits = readdirSync(join(ROOT, distDir)).filter((f) => {
					if (!/\.(mjs|d\.mts)$/.test(f)) return false;
					return read(`${distDir}/${f}`).includes(id);
				});
				for (const f of hits) {
					fail('16', `${distDir}/${f} contains the dev adapter ${id} — it would publish`);
				}
			}
			if (read(`${distDir}/index.d.mts`).includes('DEV_REGISTRY')) {
				fail('16', 'DEV_REGISTRY is public API in dist/index.d.mts — build to dev-dist/');
			}
		}

		// `files` is an allowlist, so keeping dev output outside it is what makes publication
		// impossible rather than merely checked. Assert the allowlist still says that.
		const pkg = JSON.parse(read('packages/adapters/package.json')) as { files?: string[] };
		if ((pkg.files ?? []).some((f) => f.replace(/\/$/, '') === 'dev-dist')) {
			fail('16', 'packages/adapters files[] includes dev-dist — dev adapters would publish');
		}

		ok(
			'16',
			devIds.length,
			`dev adapters isolated from REGISTRY and dist: ${devIds.join(', ')}`,
		);
	}
}

// ------------------------------------- 17. an adapter's Zod schema is used, or is absent
//
// `pnpm new-adapter` scaffolds `schema.ts` containing `z.object({})`, which validates
// successfully against ANY object. Two of the first three adapters carried that stub
// unimported: harmless while unused, and actively misleading the moment someone wires it
// up, because it reads as validation while checking nothing.
//
// The contract says a provider payload is parsed with a Zod schema and a failure is
// PROVIDER_DRIFT, never a cast. So the rule is: have a real schema and use it, or delete
// the file and say why. Not every provider has an envelope worth modelling — scraperapi
// genuinely has none — and "no schema, stated" is honest where an empty one is not.
{
	const adapterRoot = 'packages/adapters/src';
	const schemas = execFileSync('git', ['ls-files', `${adapterRoot}/**/schema.ts`], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		// `git ls-files` reports a tracked file whose deletion is not yet staged, so filter on
		// what is actually on disk. Without this, deleting a schema makes repo:check CRASH
		// rather than report — a check that dies is worse than one that fails.
		.filter((f) => f !== '' && has(f));

	const adapterDirs = execFileSync('git', ['ls-files', `${adapterRoot}`], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((f) => f.endsWith('/index.ts') && f !== `${adapterRoot}/index.ts`);
	if (adapterDirs.length === 0) fail('17', 'no adapters found — assertion 17 is vacuous');

	for (const schema of schemas) {
		const dir = schema.slice(0, -'/schema.ts'.length);
		if (!has(`${dir}/index.ts`)) continue;
		if (!read(`${dir}/index.ts`).includes('./schema.js')) {
			fail('17', `${schema} is never imported by ${dir}/index.ts — use it or delete it`);
		}
		// An object schema with no keys accepts everything. If it is worth keeping, it is
		// worth having at least one field.
		if (/z\s*\.\s*object\s*\(\s*\{\s*\}\s*\)/.test(read(schema))) {
			fail('17', `${schema} declares z.object({}), which validates any object at all`);
		}
	}
	ok(
		'17',
		adapterDirs.length,
		`adapter schemas are used or absent (${schemas.length} present)`,
	);
}

// ----------------------------------- 18. the licence TEXT matches the licence DECLARED
//
// A `license` field is metadata; the LICENSE file is the grant. When they disagree the file
// wins in court and the field wins in every tool, which is the worst possible split — and
// it is an easy mistake to make, because these six files are copies of two texts and
// nothing about copying them says which package gets which.
//
// The direction that matters: an Apache-2.0 package shipping AGPL text would relicense
// exactly the packages we most want strangers to build on. Assertion 10 already stops an
// Apache package DEPENDING on an AGPL one; this stops it DECLARING one thing and shipping
// another.
{
	const families: Record<string, RegExp> = {
		'AGPL-3.0-only': /GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]*Version 3/,
		'Apache-2.0': /Apache License[\s\S]*Version 2\.0/,
	};

	// The root grant covers everything without a package of its own.
	if (!has('LICENSE')) {
		fail('18', 'no root LICENSE — the repo declares AGPL-3.0-only and grants nothing');
	} else if (!(families['AGPL-3.0-only'] as RegExp).test(read('LICENSE'))) {
		fail('18', 'root LICENSE is not the AGPL-3.0 text');
	}

	let checked18 = 1;
	for (const pkg of wsPkgs) {
		const declared = pkg.json.license as string | undefined;
		// tooling/* are private and deliberately declare none; assertion 5 owns that rule.
		if (declared === undefined || pkg.json.private === true) continue;
		checked18++;
		const licPath = `${pkg.dir}/LICENSE`;
		if (!has(licPath)) {
			fail('18', `${pkg.json.name} declares ${declared} but ships no LICENSE file`);
			continue;
		}
		const expected = families[declared];
		if (expected === undefined) {
			fail('18', `${pkg.json.name} declares "${declared}", which is not a licence we use`);
			continue;
		}
		if (!expected.test(read(licPath))) {
			fail('18', `${pkg.json.name} declares ${declared} but ${licPath} is a different licence`);
		}
	}
	if (checked18 <= 1) fail('18', 'no publishable package was checked — the scan found nothing');
	ok('18', checked18, 'licence text matches the declared licence, root and per package');
}

// ------------------------------- 19. the Dockerfile pins the same Node as everything else
//
// Node is pinned in .nvmrc and in engines.node, and assertion 7 keeps those two together.
// The Dockerfile is a THIRD place, and the one that decides what actually runs in
// production. A Dockerfile on Node 22 while the repo targets 24 does not fail the build —
// it fails at runtime, on syntax the older runtime cannot parse, in the deployed image.
{
	if (!has('Dockerfile')) {
		fail('19', 'no Dockerfile — docker/compose.yml builds from one');
	} else {
		const nvmrc = read('.nvmrc').trim();
		const bases = [...read('Dockerfile').matchAll(/^FROM\s+node:(\S+?)(?:-\S+)?\s/gm)].map(
			(m) => m[1] as string,
		);
		if (bases.length === 0) {
			fail('19', 'Dockerfile has no `FROM node:` line — this check parsed nothing');
		}
		for (const b of bases) {
			if (b !== nvmrc) {
				fail('19', `Dockerfile uses node:${b} but .nvmrc pins ${nvmrc}`);
			}
		}
		ok('19', bases.length, `Dockerfile Node stages pinned to .nvmrc (${nvmrc})`);
	}
}

// ------------------------------- 20. the internal dependency graph is a layered DAG
//
// This exists because the graph was upside down and nothing noticed. `packages/shared` — the
// base layer, per CLAUDE.md's own description — depended on `packages/adapters`, a leaf,
// purely to name the `Outcome` type. Consequences, all real:
//
//   - `adapters` could never import `shared`; it would have been a cycle. Adapters are the
//     package strangers are most invited to write, and it was the one cut off from the base.
//   - CODEOWNERS handed the outcome taxonomy to adapter-engineer, when it drives failover,
//     cooldowns, HTTP status and health, which belong to platform-engineer.
//   - `turbo` only complains once the cycle is COMPLETE. A one-way inversion builds fine and
//     is invisible until someone adds the import that closes it, at which point the fix is a
//     refactor rather than a deletion.
//
// So the direction is declared, not inferred. A package may depend on a STRICTLY lower layer
// and nothing else.
{
	// Layer 0 is config with no dependencies at all; each layer may only reach strictly
	// downward. The numbers have gaps in meaning rather than in value: what matters is that
	// `shared` sits below `adapters`, and that test tooling sits above the packages it
	// replays, not beside them.
	const LAYERS: Record<string, number> = {
		// 0 — pure config, depends on nothing.
		'@proxlane/tsconfig': 0,
		// 1 — the base. No knowledge of providers, of HTTP, or of the gateway.
		'@proxlane/shared': 1,
		'@proxlane/containers': 1,
		// 2 — provider knowledge. `adapters` depends on `shared`, which is the direction this
		// whole assertion exists to hold.
		'@proxlane/adapters': 2,
		'@proxlane/detect': 2,
		// 3 — things built on provider knowledge, including the test tooling that replays
		// recorded adapter traffic and the operator CLI.
		'@proxlane/api': 3,
		'@proxlane/db': 3,
		'@proxlane/sdk': 3,
		'@proxlane/ui': 3,
		'@proxlane/vitest-config': 3,
		'@proxlane/scripts': 3,
		proxlane: 3,
		// 4 — composed UI.
		'@proxlane/route-viz': 4,
		// 5 — the deployables. Everything may point at them; they point at everything.
		'@proxlane/gateway': 5,
		'@proxlane/web': 5,
	};

	let edges = 0;
	const internal = new Set(wsPkgs.map((p) => p.json.name as string));
	for (const pkg of wsPkgs) {
		const name = pkg.json.name as string;
		const mine = LAYERS[name];
		if (mine === undefined) {
			fail('20', `${name} has no layer in repo-check assertion 20 — add one and say why`);
			continue;
		}
		const deps = {
			...(pkg.json.dependencies ?? {}),
			...(pkg.json.devDependencies ?? {}),
		} as Record<string, string>;
		for (const dep of Object.keys(deps)) {
			if (!internal.has(dep)) continue;
			edges++;
			const theirs = LAYERS[dep];
			if (theirs === undefined) {
				fail('20', `${name} depends on ${dep}, which has no layer`);
			} else if (theirs >= mine) {
				fail(
					'20',
					`${name} (layer ${mine}) depends on ${dep} (layer ${theirs}). ` +
						'A package may only depend on a strictly lower layer',
				);
			}
		}
	}
	if (edges === 0) {
		fail('20', 'zero internal dependency edges found — this assertion parsed nothing');
	}
	ok('20', edges, 'internal dependency edges each point down a layer');
}

// ------------------------------- 21. published health figures match the simulation
//
// Every numeric claim about the health detector drifted from the code that produced it. The
// sharpest: the published detection delay was the REJECTED plain-rate estimator's result,
// carried forward verbatim into two files as a claim about the shipped Wilson system — under
// a sentence reading "measured, not chosen. Do not edit one without rerunning the sim."
//
// The sim is deterministic and seeded, so every one of those was a one-command check nobody
// ran. This makes not running it a red build: `scripts/health-sim.ts` writes the figures it
// measured to `health-numbers.json`, and the docs must contain those exact strings.
//
// It does NOT run the simulation — that takes minutes and `repo:check` is on the hot path of
// every commit. It checks agreement between the last recorded run and the prose, which is
// the property that actually failed.
{
	const numbersPath = 'scripts/health-numbers.json';
	if (!has(numbersPath)) {
		fail('21', `${numbersPath} is missing — run \`node scripts/health-sim.ts\``);
	} else {
		const nums = JSON.parse(read(numbersPath)) as Record<string, number>;

		/**
		 * Every figure the prose quotes, and where.
		 *
		 * A verification panel got past the first version of this three ways, so all three are
		 * closed here:
		 *
		 *   - Editing a figure the map did not cover. The map now spans every key the sim
		 *     writes, and `unquoted` below fails on a key no document mentions, so adding a
		 *     figure to the sim without publishing it is also a red build.
		 *   - Wiping the file. A missing key rendered as `(undefined ?? 0).toFixed(1)` = "0.0%",
		 *     which appears in the prose, so an EMPTY file passed while reporting two checks.
		 *     Rendering is now strict: a missing or non-numeric value fails.
		 *   - Editing the code that produces the figures. Closed by the staleness check below:
		 *     the recording must be newer than the script and the module it measures.
		 *
		 * WHAT THIS STILL CANNOT DO, and it is the honest limit rather than an oversight: it
		 * checks AGREEMENT, not PROVENANCE. `health-numbers.json` is a tracked, hand-editable
		 * file, so restating a remembered figure in both it and the prose passes here. Running
		 * the simulation is the only thing that closes that, and it takes minutes, which does
		 * not belong on every commit. The weekly `health-sim` job in `scheduled.yml` reruns it
		 * and fails if the recording does not reproduce.
		 *
		 * Figures from designs that no longer exist — the ~430 bootstrap result, the plain-rate
		 * range — cannot be regenerated and so are not covered by anything. They are labelled
		 * as historical where they appear.
		 */
		const render = (key: string, fmt: (v: number) => string): string => {
			const v = nums[key];
			if (typeof v !== 'number' || !Number.isFinite(v)) return '';
			return fmt(v);
		};
		const asPct = (v: number) => `${v.toFixed(1)}%`;
		const asInt = (v: number) => v.toLocaleString('en-US');

		const SPEC = 'docs/integrations.md';
		const quoted: [string, string, string][] = [
			['incident_demote_median', render('incident_demote_median', asInt), SPEC],
			['incident_step_median', render('incident_step_median', asInt), SPEC],
			['demoted@20k_at_0.04', render('demoted@20k_at_0.04', asPct), SPEC],
			['demoted@20k_at_0.2', render('demoted@20k_at_0.2', asPct), SPEC],
			['iid_share_demoted', render('iid_share_demoted', asPct), SPEC],
			['share_demoted_dwell_2000', render('share_demoted_dwell_2000', asPct), SPEC],
			['share_demoted_dwell_20000', render('share_demoted_dwell_20000', asPct), SPEC],
			[
				'iid_demotions_per_provider',
				render('iid_demotions_per_provider', (v) => v.toFixed(2)),
				SPEC,
			],
		];
		const covered = new Set(quoted.map(([k]) => k));

		let checked21 = 0;
		for (const [key, rendered, file] of quoted) {
			if (rendered === '') {
				fail('21', `${key} is missing or not a number in ${numbersPath}; rerun the simulation`);
				continue;
			}
			checked21++;
			if (!read(file).includes(rendered)) {
				fail(
					'21',
					`${file} does not quote ${key} = ${rendered}. Rerun ` +
						'`node scripts/health-sim.ts` and update the prose from its output, rather ' +
						'than restating a remembered figure.',
				);
			}
		}

		// A figure the sim measures and nobody publishes is a figure that can rot unnoticed.
		const unquoted = Object.keys(nums).filter(
			(k) =>
				!covered.has(k) &&
				k !== 'measuredAgainst' &&
				!k.startsWith('degraded@') &&
				!k.startsWith('demoted@'),
		);
		for (const k of unquoted) {
			fail('21', `${numbersPath} records ${k}, which no document quotes — add it to this map`);
		}

		// The recording must describe the CURRENT behaviour. Compared by fingerprint rather
		// than mtime: mtime demanded a three-minute rerun for a comment edit, which is how a
		// check gets deleted. The fingerprint covers the constants and the four functions that
		// determine the numbers, with comments and whitespace stripped.
		const health = read('packages/shared/src/health.ts');
		const parts = [
			/export const HEALTH = \{[\s\S]*?\} as const;/,
			/export function increments\([\s\S]*?\n\}/,
			/export function observe\([\s\S]*?\n\}/,
			/export function observeProbe\([\s\S]*?\n\}/,
			/export function wilsonUpper\([\s\S]*?\n\}/,
		].map((re) => {
			const m = re.exec(health);
			if (m === null) {
				fail('21', `packages/shared/src/health.ts no longer matches ${String(re)}`);
				return '';
			}
			return m[0]
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/[^\n]*/g, '')
				.replace(/\s+/g, '');
		});
		const expectedPrint = createHash('sha256')
			.update(parts.join('|'))
			.digest('hex')
			.slice(0, 16);
		if ((nums as unknown as { measuredAgainst?: string }).measuredAgainst !== expectedPrint) {
			fail(
				'21',
				'the health statistic has changed since these figures were measured — rerun ' +
					'`node scripts/health-sim.ts`. (Comments and formatting are ignored, so this ' +
					'only fires on a real behaviour change.)',
			);
		}

		// Retired figures, banned by value, everywhere rather than in one document. Each was
		// published and wrong, and `877` outlived the first ban by living in a test comment.
		for (const stale of ['877', '~54M', '2.9 years']) {
			for (const file of [SPEC, 'packages/shared/src/health.ts']) {
				if (read(file).includes(stale)) {
					fail('21', `${file} still contains the retired figure "${stale}"`);
				}
			}
		}

		if (checked21 === 0) {
			fail('21', 'no health figures were checked — this assertion parsed nothing');
		} else {
			ok('21', checked21, 'published health figures agree with the recorded simulation');
		}
	}
}

// ------------------------------------------------------------------------ helpers

function parseCatalog(yaml: string): Record<string, string> {
	const out: Record<string, string> = {};
	const lines = yaml.split('\n');
	const start = lines.findIndex((l) => /^catalog:\s*$/.test(l));
	if (start === -1) return out;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '' || line.trim().startsWith('#')) continue;
		if (!/^\s+/.test(line)) break; // dedent ends the block
		const m = /^\s+'?([^':]+)'?:\s*(.+?)\s*$/.exec(line);
		if (!m) {
			failures.push(`  [6] unparseable catalog line: ${JSON.stringify(line)}`);
			continue;
		}
		out[(m[1] as string).replace(/^'|'$/g, '')] = (m[2] as string).replace(/^'|'$/g, '');
	}
	return out;
}

function ownedPathPrefixes(md: string): string[] {
	const rows = parseTable(md, /^\| Path \| What \| Owner \|/);
	return rows
		.flatMap((r) => ticks(r[0] ?? ''))
		.map((p) => p.replace(/\*+$/, '').replace(/\/$/, ''))
		.filter(Boolean);
}

function matchesOwner(pattern: string, file: string): boolean {
	let p = pattern.replace(/^\//, '');
	if (p.endsWith('/**')) p = p.slice(0, -3);
	else if (p.endsWith('/*')) p = p.slice(0, -2);
	if (p === '**' || p === '') return true;

	if (!p.includes('*')) return file === p || file.startsWith(`${p}/`);

	// Tokenise rather than substituting placeholders: a sentinel character is how a NUL
	// byte ends up in a regex literal, and `**` must be consumed before `*` can be.
	let rx = '';
	for (let i = 0; i < p.length; i++) {
		if (p[i] === '*') {
			if (p[i + 1] === '*') {
				rx += '.*';
				i++;
			} else {
				rx += '[^/]*';
			}
		} else {
			rx += (p[i] as string).replace(/[.+^${}()|[\]\\?]/, '\\$&');
		}
	}
	return new RegExp(`^${rx}`).test(file);
}

// ------------------------------- 22. every owned file that names itself actually exists
//
// `CLAUDE.md`'s ownership table carried a row for `.github/workflows/release.yml` from the
// scaffold onward. The file was never written. `operating.md` B8 described its behaviour in
// the present tense, 22 changesets accumulated behind it, and nothing failed — because
// assertion 4 checks that every tracked file has an owner, which is the opposite direction.
//
// A row naming a SPECIFIC file is a claim that the file exists. Globs are not: `docs/**`
// says nothing about any particular path. So this checks only the literal rows, which is
// also what keeps it from firing on a package that has not been created yet.
{
	// Scoped to the ownership section. The Commands table also has backticked first cells,
	// and matching the whole file reported `pnpm repo:check` as a missing path — a check
	// whose own error message is nonsense teaches people to ignore it.
	const claude = read('CLAUDE.md');
	const from = claude.indexOf('## Target layout and ownership');
	const to = claude.indexOf('\n## ', from + 1);
	if (from === -1 || to === -1) {
		fail('22', 'could not locate the ownership table in CLAUDE.md');
	}
	const section = claude.slice(from, to === -1 ? undefined : to);
	const rows = [...section.matchAll(/^\|\s*`([^`]+)`/gm)]
		.map((m) => (m[1] as string).trim())
		.filter((p) => !p.includes('*') && p !== '');
	if (rows.length === 0) {
		fail('22', 'parsed zero literal paths from the ownership table — this checked nothing');
	}
	let checked22 = 0;
	for (const row of rows) {
		const rel = row.startsWith('/') ? row.slice(1) : row;
		checked22++;
		if (!has(rel)) {
			fail(
				'22',
				`CLAUDE.md owns ${row}, which does not exist. Either write it or drop the row — ` +
					'an owner for a file nobody wrote reads as a thing that got built.',
			);
		}
	}
	ok('22', checked22, 'literally-named owned paths exist');
}

// ------------------------------------------------------------------ 23, 24, 25: the docs
//
// THREE ASSERTIONS, ONE PER BUG FOUND BY ACTUALLY RUNNING THE README. Writing
// `docs/self-hosting.md` meant executing every command against a fresh clone, and all three of
// these had been wrong for some time while every check stayed green:
//
//   the quickstart could not work      `docker compose up` from the root exits "no
//                                      configuration file provided", and the -f form silently
//                                      reads docker/.env rather than the .env you just made
//   PROXLANE_SHARE_STATS did not exist the README documented an opt-in telemetry flag that
//                                      appears nowhere in the code
//   a command that had been renamed    nothing tied prose to package.json
//
// Prose is the one part of this repo nothing executed. These do not make the docs correct —
// only running them does — but they close the three ways they were provably wrong.
{
	const DOCS = ['README.md', 'docs/self-hosting.md'];
	const present = DOCS.filter((d) => has(d));
	if (present.length === 0) fail('23', 'no user-facing docs found to check');

	const scripts = Object.keys(
		(JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {},
	);
	// pnpm built-ins and bins, which are not root scripts and never will be.
	const NOT_SCRIPTS = new Set([
		'install',
		'add',
		'remove',
		'exec',
		'dlx',
		'why',
		'run',
		'changeset',
		'create',
		'init',
		'update',
		'list',
		'outdated',
		'publish',
		'store',
		'setup',
		'link',
		'test',
	]);

	let checked23 = 0;
	let checked24 = 0;
	let checked25 = 0;

	// The env vars the code or the shipped config actually knows about.
	const knownEnv = [
		read('.env.example'),
		has('docker/compose.yml') ? read('docker/compose.yml') : '',
		has('docker/compose.dev.yml') ? read('docker/compose.dev.yml') : '',
		...['apps', 'packages'].flatMap((d) => (has(d) ? [tsSources(d)] : [])),
	].join('\n');

	for (const doc of present) {
		const text = read(doc);

		// 23. A `pnpm <script>` in prose is a promise the root package.json has to keep.
		for (const m of text.matchAll(/\bpnpm (?:run )?([a-z][a-z0-9:-]*)/g)) {
			const name = m[1];
			if (name === undefined || NOT_SCRIPTS.has(name)) continue;
			checked23++;
			if (!scripts.includes(name))
				fail(
					'23',
					`${doc} tells the reader to run \`pnpm ${name}\`, which is not a root script`,
				);
		}

		// 24. An env var in prose is a promise something reads it.
		for (const m of text.matchAll(
			/\b(PROXLANE_[A-Z0-9_]+|SCRAPERAPI_KEY|SCRAPINGBEE_KEY|SCRAPFLY_KEY|DATABASE_URL|VALKEY_URL|MAX_INFLIGHT|BODY_CAP_MB)\b/g,
		)) {
			const name = m[1];
			if (name === undefined) continue;
			checked24++;
			if (!knownEnv.includes(name))
				fail(
					'24',
					`${doc} documents ${name}, which appears in no config and no source. ` +
						'PROXLANE_SHARE_STATS was documented as an opt-in telemetry flag for months ' +
						'and never existed.',
				);
		}

		// 25. Compose derives its project directory from the first -f file, so an invocation
		//     naming docker/compose.yml reads docker/.env and ignores the root .env the reader
		//     was just told to create. It fails on the PROXLANE_API_KEY interpolation.
		for (const line of text.split('\n')) {
			if (!/docker compose\b/.test(line) || !/-f docker\//.test(line)) continue;
			checked25++;
			if (!/--env-file|--project-directory/.test(line))
				fail(
					'25',
					`${doc} runs \`docker compose -f docker/...\` without --env-file or ` +
						'--project-directory, so the root .env is never read and the gateway refuses ' +
						`to boot:\n      ${line.trim()}`,
				);
		}
	}

	if (checked23 === 0)
		fail('23', 'no `pnpm <script>` found in the docs — the scan matched nothing');
	if (checked24 === 0)
		fail('24', 'no environment variable found in the docs — the scan matched nothing');
	if (checked25 === 0)
		fail('25', 'no compose invocation found in the docs — the scan matched nothing');
	ok('23', checked23, 'documented pnpm scripts exist');
	ok('24', checked24, 'documented environment variables are read by something');
	ok('25', checked25, 'documented compose invocations can find the root .env');
}

// ------------------------------------------------------------- 26: the landing page's count
//
// The landing page states how many outcomes and classes the taxonomy has, and `apps/web`
// DELIBERATELY does not import `@proxlane/shared` to find out — the page copies the four
// labels it renders rather than taking a runtime dependency on the taxonomy, and that
// decision is documented at the copy site. The cost of it is a hand-typed number that goes
// stale the moment a member lands, on the one page every visitor reads.
//
// `GATEWAY_BUSY` is what proved it: adding it made the page's "Seventeen outcomes" wrong,
// and the sentence it appears in is specifically the promise that adding an outcome breaks
// nothing. Nothing would have caught it. This binds the claim to the arrays without binding
// the bundle to the package.
{
	const PAGE = 'apps/web/src/routes/index.tsx';
	const TAXONOMY = 'packages/shared/src/outcome.ts';

	// Counts the quoted members of `export const NAME = [ ... ] as const`. Parsed rather than
	// imported for the same reason the page does not import: this script is zero-dependency
	// and runs before anything is built.
	const countMembers = (src: string, name: string): number => {
		const block = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src);
		if (block === null) return 0;
		// Both cases: outcomes are SCREAMING_CASE, classes are lowercase. Matching only the
		// former is what the zero-denominator guard below caught on the first run.
		return (block[1]?.match(/'[a-zA-Z_]+'/g) ?? []).length;
	};

	if (!has(PAGE) || !has(TAXONOMY)) {
		fail('26', `${PAGE} or ${TAXONOMY} is missing, so the taxonomy claim cannot be checked`);
	} else {
		const taxonomy = read(TAXONOMY);
		const outcomes = countMembers(taxonomy, 'OUTCOMES');
		const classes = countMembers(taxonomy, 'OUTCOME_CLASSES');
		// Non-zero denominator: a regex that silently matched nothing would make this assertion
		// pass by comparing 0 to 0 forever.
		if (outcomes === 0 || classes === 0) {
			fail(
				'26',
				`could not parse OUTCOMES (${outcomes}) or OUTCOME_CLASSES (${classes}) from ` +
					`${TAXONOMY} — the array shape changed and this check stopped checking`,
			);
		} else {
			const claim = /(\d+) outcomes, (\d+) classes/.exec(read(PAGE));
			if (claim === null) {
				fail(
					'26',
					`${PAGE} no longer states "<n> outcomes, <n> classes". If the sentence was ` +
						'reworded, reword this assertion with it rather than deleting it.',
				);
			} else if (Number(claim[1]) !== outcomes || Number(claim[2]) !== classes) {
				fail(
					'26',
					`${PAGE} claims ${claim[1]} outcomes and ${claim[2]} classes; ` +
						`${TAXONOMY} has ${outcomes} and ${classes}. ` +
						'Owner: design-engineer for the copy, platform-engineer for the taxonomy.',
				);
			} else {
				ok('26', outcomes + classes, 'the landing page’s taxonomy count is true');
			}
		}
	}
}

// ------------------------------------- 27: no script runs bare node on `src/**` TypeScript
//
// THIS SHIPPED BROKEN AND NOTHING NOTICED. `apps/gateway`'s dev script was
// `node --watch src/index.ts`, and `pnpm dev` is a Commands-table entry marked implemented.
// It could never have worked: application source uses the TypeScript emit convention, where
// a sibling import is written `./app.js`, and Node's type stripping does NOT rewrite that to
// `./app.ts`. The gateway crashed on its first import, every time.
//
// It went unseen because `pnpm dev` is `turbo run dev --parallel` with persistent tasks — the
// web app starts, the gateway dies, and the command keeps running. The one thing that would
// have caught it is starting the gateway, which no check does.
//
// `scripts/` and `test/k6` are exempt by construction: they import with explicit `.ts`
// extensions and are compiled with `allowImportingTsExtensions`, which is the other valid
// convention. The rule is only about `src/**`.
{
	const offenders: string[] = [];
	let scanned = 0;
	for (const dir of listWorkspaceDirs()) {
		const manifestPath = join(dir, 'package.json');
		if (!has(manifestPath)) continue;
		const scripts: Record<string, string> = JSON.parse(read(manifestPath)).scripts ?? {};
		for (const [name, body] of Object.entries(scripts)) {
			scanned += 1;
			// `node …  src/anything.ts`, with or without flags between.
			if (/\bnode\b[^&|]*\bsrc\/[^\s]*\.ts\b/.test(body)) {
				offenders.push(`${dir}/package.json "${name}": ${body}`);
			}
		}
	}
	if (scanned === 0) fail('27', 'found no package scripts to check — the scan matched nothing');
	for (const o of offenders) {
		fail(
			'27',
			`${o}\n      bare node cannot load src/**: those files import siblings as \`./x.js\`, ` +
				'and type stripping does not rewrite that to `.ts`. Build first, or run the output.',
		);
	}
	ok('27', scanned, 'package scripts do not run bare node on src TypeScript');
}

// ------------------------------- 28: the marketing site counts the providers that exist
//
// A COUNT IN PROSE GOES STALE SILENTLY, which assertion 26 already learned about the outcome
// taxonomy. The fourth adapter landed and the landing page still said "Three providers, three
// lines", listed three rows in the capability table, and printed a boot banner with three
// names in it — a transcript of a gateway that no longer exists. Nothing was red.
//
// Checks the two claims a reader can verify at a glance: the row count in `LAUNCH_LINES`, and
// that no visible sentence names a provider count other than the real one.
{
	const PAGE = 'apps/web/src/routes/index.tsx';
	const REG = 'packages/adapters/src/registry.ts';
	if (!has(PAGE) || !has(REG)) {
		fail('28', `${PAGE} or ${REG} is missing, so the provider count cannot be checked`);
	} else {
		// The registry's keys are the shipped set. `_dev/` entries are deliberately excluded from
		// REGISTRY, so parsing it rather than the directory listing counts what actually routes.
		const reg = read(REG);
		const ids = [...reg.matchAll(/^\t'?([a-z][a-z0-9-]*)'?:/gm)].map((m) => m[1] as string);
		const page = read(PAGE);
		// THE ROW COUNT IS NO LONGER A CLAIM. `LAUNCH_LINES` is derived from `CAPABILITIES`
		// (assertion 32 holds it that way), so it cannot list a different number of providers
		// than ship. What could never be derived is a SENTENCE, and a sentence is what went
		// stale the last time an adapter landed.
		if (ids.length === 0) {
			fail('28', `parsed 0 registry ids from ${REG} — this check stopped checking`);
		} else {
			const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
			const right = WORDS[ids.length - 1];
			const wrong = WORDS.filter((w) => w !== right)
				.map((w) => new RegExp(`${w} providers`, 'i'))
				.filter((re) => re.test(page))
				.map((re) => re.source);
			if (wrong.length > 0) {
				fail(
					'28',
					`${PAGE} says "${wrong.join('", "')}" while ${ids.length} ship. ` +
						`It should read "${right} providers". Owner: design-engineer.`,
				);
			} else {
				ok('28', ids.length, 'the landing page counts the providers that ship');
			}
		}
	}
}

// -------------------- 29: the README describes what ships, and links to hosts that exist
//
// THE FRONT DOOR WAS WRONG IN BOTH DIRECTIONS AT ONCE. Its Quickstart told every visitor to
// `curl https://api.proxlane.dev/v1?...` — a hostname with no DNS record, for a hosted service
// that does not exist and is phase 3. Its "Full parameter reference" linked to
// `docs.proxlane.dev`, also no record, while the whole docs site was live at the apex. And the
// Providers table marked all four shipped adapters `planned`, directly under a sentence
// promising it would be generated "once adapters ship".
//
// House rule: the README describes shipped behaviour only. Three parts to holding it:
//
//   the providers table is generated, and asserted byte-identical here
//   no tracked doc names a hostname we know has no DNS record
//   the counts the README states are the counts the repo has
//
// The hostname list is a STATIC ban, not a lookup. Resolving DNS in `repo:check` would make a
// clean clone on a plane fail, and CI would be asserting that a registrar works — the same
// reason `k6` has no row in the toolchain table.
//
// "DELETE AN ENTRY THE DAY IT RESOLVES" WAS THE WRONG RULE, and `api.proxlane.dev` resolves
// today. It is not a public endpoint: hosted credits are phase 3, and the README's own first
// paragraph says there is no hosted endpoint. Pointing a reader at a hostname that answers is
// worse than pointing them at one that does not — a 401 reads as "I set it up wrong", where
// NXDOMAIN reads as "this does not exist yet", which is the truth. So the ban is on hostnames
// this project does not offer readers, and resolving is not what lifts it. Shipping the hosted
// endpoint is.
{
	const DEAD_HOSTS = ['api.proxlane.dev', 'docs.proxlane.dev'];
	const readme = has('README.md') ? read('README.md') : '';
	if (readme === '') {
		fail('29', 'README.md is missing');
	} else {
		let checkedHere = 0;

		// a. the generated providers table
		if (readme.includes(PROVIDERS_BEGIN)) {
			// CAUGHT, because the generator is allowed to refuse. It throws rather than writing a
			// number it could not read — "0 regions" and "?×" both shipped that way — and an
			// uncaught throw here killed the whole run with a stack trace, taking every other
			// assertion's result with it. One unreadable capability file must cost one named
			// failure, not the report.
			let regenerated: string;
			try {
				regenerated = applyProviders(readme);
			} catch (e) {
				fail(
					'29',
					`the providers table cannot be generated: ${e instanceof Error ? e.message : String(e)}`,
				);
				regenerated = readme;
			}
			if (regenerated !== readme) {
				fail(
					'29',
					'the README providers table is stale — run `node scripts/readme-providers.ts`. ' +
						'Owner: oss-maintainer for the prose, adapter-engineer for the capabilities.',
				);
			} else checkedHere += 1;
			const doubled = plannedButShipped();
			if (doubled.length > 0) {
				fail('29', `listed as both shipped and planned: ${doubled.join(', ')}`);
			}
		} else {
			fail(
				'29',
				`README.md lost the ${PROVIDERS_BEGIN} fence, so the table is hand-written again`,
			);
		}

		// b. no dead hostnames, anywhere a reader can reach
		// EVERY SURFACE A READER REACHES, not three markdown files. The scan covered the README,
		// the self-hosting guide and CONTRIBUTING — and not the landing page, the docs site or
		// the agent-facing summaries, which is where a hostname is most likely to be typed and
		// most likely to be read.
		const docs = [
			...['README.md', 'docs/self-hosting.md', 'CONTRIBUTING.md'],
			...execFileSync(
				'git',
				['ls-files', 'apps/web/content/**/*.md', 'apps/web/public/llms*.txt'],
				{
					cwd: ROOT,
					encoding: 'utf8',
				},
			)
				.split('\n')
				.filter(Boolean),
		].filter(has);
		if (docs.length < 3) {
			fail(
				'29',
				`found only ${docs.length} docs to scan for dead hostnames — this stopped checking`,
			);
		}
		for (const file of docs) {
			const body = read(file);
			for (const host of DEAD_HOSTS) {
				if (body.includes(host)) {
					fail(
						'29',
						`${file} names ${host}, which this project does not offer readers. Point at ` +
							'proxlane.dev. Remove it from DEAD_HOSTS when the endpoint actually ships, ' +
							'not when the DNS record appears.',
					);
				}
			}
			checkedHere += 1;
		}

		// c. the counts, derived rather than trusted
		const adapters = registryProviderCount();
		const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
		const claimed = /\*\*(One|Two|Three|Four|Five|Six|Seven|Eight) adapters?\*\*/.exec(readme);
		if (claimed === null) {
			fail(
				'29',
				'README.md no longer states "**<n> adapters**"; reword this assertion with it',
			);
		} else if (claimed[1]?.toLowerCase() !== words[adapters - 1]) {
			fail('29', `README.md says "${claimed[1]} adapters" and the registry ships ${adapters}`);
		} else checkedHere += 1;

		// `$comment` IS NOT A COMMAND. Counting `Object.keys` made this assertion agree with a
		// README that advertised 28 commands where 27 exist — the check and the claim were both
		// derived from the same wrong denominator, so they matched each other and not reality.
		const cmds = Object.keys(
			JSON.parse(read('scripts/commands.json')) as Record<string, unknown>,
		).filter((k) => !k.startsWith('$')).length;
		const cmdClaim = /(\d+) commands are real/.exec(readme);
		if (cmdClaim === null) {
			fail('29', 'README.md no longer states "<n> commands are real"');
		} else if (Number(cmdClaim[1]) !== cmds) {
			fail('29', `README.md says ${cmdClaim[1]} commands; commands.json has ${cmds}`);
		} else checkedHere += 1;

		if (checkedHere > 0) ok('29', checkedHere, 'the README describes what ships');
	}
}

// ------------------- 30: the self-host compose file pins a released version
//
// `operating.md` B8 says "the self-host compose file pins a version. `:latest` exists but is
// documented as the unstable choice" — and the file said `:latest` for as long as that sentence
// existed. A document asserting something about a file the file contradicts is the exact shape
// assertions 23–25 and 29 were added for, so this is the fourth instance of one lesson.
//
// Not cosmetic. `:latest` moves, so `docker compose pull` could change a self-hoster's running
// gateway without them choosing to — and for a while it moved to builds that were never
// released, because the release tagged images with the version changesets had staged rather than
// the one it shipped.
//
// A pin that LAGS the newest release is deliberately allowed: a self-hoster wants a version
// somebody has run, and bumping it should mean reading a changelog first. So this asserts two
// things only — that it is a concrete version, and that the version was actually released.
{
	const COMPOSE = 'docker/compose.yml';
	const CHANGELOG = 'apps/gateway/CHANGELOG.md';
	if (!has(COMPOSE) || !has(CHANGELOG)) {
		fail('30', `${COMPOSE} or ${CHANGELOG} is missing`);
	} else {
		const pins = [...read(COMPOSE).matchAll(/image:\s*ghcr\.io\/proxlane\/gateway:(\S+)/g)].map(
			(m) => m[1] as string,
		);
		if (pins.length === 0) {
			fail('30', `${COMPOSE} no longer names a gateway image — this check stopped checking`);
		} else {
			// Every released version, parsed from the changelog changesets generates. Reading the
			// registry instead would need the network, which would fail a clean clone offline.
			const released = new Set(
				[...read(CHANGELOG).matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map((m) => m[1] as string),
			);
			if (released.size === 0) {
				fail('30', `parsed no released versions from ${CHANGELOG}`);
			} else {
				// THE LATEST RELEASE, NOT MERELY A RELEASE. Pinning `a` released version stops a
				// tag that never shipped and nothing else — the file sat on 0.3.2 while the
				// gateway reached 0.8.0, so a reader following the self-hosting guide verbatim
				// got a gateway five minors old and then read `api.md`, which opens with
				// "Everything here is implemented", and found none of the headers it describes.
				// The first `##` heading in a changeset-written CHANGELOG is the newest release.
				const latest = /^## (\d+\.\d+\.\d+)$/m.exec(read(CHANGELOG))?.[1];
				if (latest === undefined) {
					fail('30', `could not read the newest release from ${CHANGELOG}`);
				} else {
					for (const pin of pins) {
						if (pin !== 'latest' && pin !== latest) {
							fail(
								'30',
								`${COMPOSE} pins gateway:${pin}; the newest release is ${latest}. A ` +
									'self-hoster following the guide gets that version and the docs describe ' +
									'this one. Owner: release-manager.',
							);
						}
					}
				}
				for (const pin of pins) {
					if (!/^\d+\.\d+\.\d+$/.test(pin)) {
						fail(
							'30',
							`${COMPOSE} pins \`${pin}\`. operating.md B8 says this file pins a version; ` +
								"a moving tag can change a self-hoster's gateway without them choosing to.",
						);
					} else if (!released.has(pin)) {
						fail(
							'30',
							`${COMPOSE} pins ${pin}, which has no entry in ${CHANGELOG} — it was never ` +
								'released, so there may be no such image.',
						);
					}
				}
				ok('30', pins.length, 'the compose file pins a released gateway version');
			}
		}
	}
}

// ------------------- 31: every TypeScript file a package owns is actually typechecked

// A tsconfig `include` is a claim about coverage, and nothing checked it. `packages/adapters`
// said `include: ["src"]` while the conformance harness — the thing that decides whether an
// adapter is honest about its capabilities — sat in `conformance/`, outside it. That harness
// shipped with an undeclared variable in a template literal for as long as the gap existed:
// `tsc` never looked at the file, `biome` does not do type analysis, and the harness runs from
// its BUILT output, so the only way to notice was to read it. `packages/db` had the same hole
// over `scripts/` and `test/`.
//
// This is the fourth "a document asserts something about a file the file contradicts" — except
// here the document is a config, which is worse, because a config that under-claims produces a
// green build rather than a red one. There is no failure to investigate.
//
// The matcher is deliberately small: it understands a bare directory name and a top-level
// `*.ext` glob, which is every pattern this repo uses. Anything else — `exclude`, `**`, a
// negation — makes the check fail rather than guess, because a matcher that silently
// mis-parses a pattern reports full coverage over files it never considered, which is exactly
// the failure being fixed.
{
	const configs = execFileSync('git', ['ls-files', '*/tsconfig.json'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((f) => f && has(f));
	// The root solution file has no `include` and owns nothing directly; per-package configs are
	// what `turbo run typecheck` actually invokes.
	const sources = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((f) => f && has(f));
	if (configs.length === 0 || sources.length === 0) {
		fail('31', 'found no tsconfigs or no TypeScript sources — this check stopped checking');
	} else {
		// Each config is parsed and validated ONCE, before any file is matched against it. Doing it
		// per-file reported the same unreadable pattern once for every source in the package,
		// which buries the one line that says what to fix under fifty identical ones.
		const READABLE = new Map<string, string[]>();
		for (const cfg of configs) {
			const dir = cfg.slice(0, -'/tsconfig.json'.length);
			const parsed = JSON.parse(read(cfg).replace(/^\s*\/\/.*$/gm, '')) as {
				include?: string[];
				exclude?: string[];
			};
			if (parsed.exclude !== undefined) {
				fail(
					'31',
					`${cfg} grew an \`exclude\` — this matcher does not read one, so it would ` +
						'report coverage it has not checked. Teach it, or drop the exclude.',
				);
				continue;
			}
			if (parsed.include === undefined) {
				fail('31', `${cfg} has no \`include\`, so what it covers cannot be checked`);
				continue;
			}
			const bad = parsed.include.filter(
				(pat) => pat.includes('*') && !/^\*\.[a-z]+$/.test(pat),
			);
			if (bad.length > 0) {
				fail('31', `${cfg} uses the glob(s) ${bad.join(', ')}, which this matcher cannot read`);
				continue;
			}
			READABLE.set(dir, parsed.include);
		}
		// Longest prefix wins: `packages/adapters/src/x.ts` belongs to `packages/adapters`, not to
		// a shorter config that happens to sit above it.
		const dirs = [...READABLE.keys()].sort((a, b) => b.length - a.length);
		let checked31 = 0;
		for (const file of sources) {
			const dir = dirs.find((d) => file.startsWith(`${d}/`));
			if (dir === undefined) continue; // the root config's, or a config that already failed above
			const patterns = READABLE.get(dir) as string[];
			const rel = file.slice(dir.length + 1);
			const covered = patterns.some((pat) =>
				pat.startsWith('*.')
					? !rel.includes('/') && rel.endsWith(pat.slice(1))
					: rel === pat || rel.startsWith(`${pat}/`),
			);
			if (!covered) {
				fail(
					'31',
					`${file} is not covered by ${dir}/tsconfig.json's include [${patterns.join(', ')}], ` +
						'so `pnpm typecheck` never reads it. Add its directory, or delete the file.',
				);
			}
			checked31 += 1;
		}
		if (checked31 > 0)
			ok('31', checked31, 'TypeScript sources covered by their package tsconfig');
	}
}

// ------------------- 32: the homepage transcript is a transcript, not an impression
//
// The landing page prints terminal output — a boot banner, a curl response — as though it were
// pasted from a real run. Three things in it had gone stale and nothing could see any of them:
//
//   the banner listed the providers in the wrong ORDER (scrapfly and scrapingbee swapped),
//   the banner had no VERSION at all, while the real one has printed one since 0.5.0,
//   the response was missing `x-chain` and `x-cost-unit`, both of which the gateway sends.
//
// Assertion 28 already counts the providers on this page, so the count was right the whole time
// while the order beside it was wrong. A count is the easy half.
//
// The order is now derived from `LAUNCH_LINES` in the page itself, so the banner cannot disagree
// with the capability table below it. What is left to check is that `LAUNCH_LINES` agrees with
// the registry, that no header on the page is one the gateway does not send, and that the
// version named is one that actually shipped.
{
	const PAGE = 'apps/web/src/routes/index.tsx';
	const REG = 'packages/adapters/src/registry.ts';
	const APP = 'apps/gateway/src/app.ts';
	const CHANGELOG = 'apps/gateway/CHANGELOG.md';
	if (!has(PAGE) || !has(REG) || !has(APP) || !has(CHANGELOG)) {
		fail('32', 'a file this check reads is missing, so the homepage transcript is unchecked');
	} else {
		const page = read(PAGE);
		let checked32 = 0;

		// 1. THE TABLE IS DERIVED, NOT RETYPED. This used to assert that a hand-written
		//    `LAUNCH_LINES` matched the registry's order, on the stated grounds that "the
		//    homepage banner renders this order as the routing order". It does not, and never
		//    did — the gateway routes `DEFAULT_PROVIDER_ORDER`, which puts Scrapfly ahead of
		//    ScrapingBee. So the check was pinned to a file that cannot be wrong about the thing
		//    it was checking, and stayed green while the homepage advertised the wrong order.
		//    Assertion 44 now compares the banner against the gateway's own constant.
		//
		//    What is left here is the property that makes the rest unnecessary: the table is
		//    built from `CAPABILITIES` rather than typed out. Two of its cells were wrong before
		//    it was — ScrapingBee's "7 regions" against 42 country codes, Scrapfly's 5x against
		//    its own 1 + 5 = 6 — and a row-count check reads no cell.
		if (!/const LAUNCH_LINES = \[\.\.\.CAPABILITIES\]/.test(page)) {
			fail(
				'32',
				`${PAGE} no longer derives LAUNCH_LINES from CAPABILITIES. A hand-written table ` +
					'drifts cell by cell, and nothing here reads a cell. Owner: design-engineer.',
			);
		} else {
			checked32 += 1;
		}

		// 2. No header on the page that the gateway does not actually send. Same parse as
		//    docs:check assertion 4, so the two cannot drift apart on what a header is called.
		const real = new Set(
			[...read(APP).matchAll(/'(X-[A-Za-z-]+|Retry-After|Server-Timing)':/g)].map((m) =>
				(m[1] as string).toLowerCase(),
			),
		);
		const shown = new Set(
			[...page.matchAll(/^\s{2}(x-[a-z-]+)\s{2,}/gm)].map((m) => m[1] as string),
		);
		for (const [, h] of page.matchAll(/\['(x-[a-z-]+)',/g)) shown.add(h as string);
		if (real.size === 0 || shown.size === 0) {
			fail('32', 'parsed no headers from the gateway or none from the page');
		} else {
			for (const h of shown) {
				if (!real.has(h)) {
					fail(
						'32',
						`${PAGE} shows \`${h}\`, which ${APP} never sets. Owner: design-engineer.`,
					);
				}
			}
			checked32 += shown.size;
		}

		// 2b. THE PANEL THAT SHOWS THEM MUST SURVIVE THE LONGEST ONE.
		//
		// `x-chain` is far longer than any other header value on this page, and adding it broke the
		// layout in two places at once: a `1fr` grid track carries `min-width: auto`, so it refused
		// to shrink below the chain, took the width out of the name column beside it, and left the
		// header NAMES breaking mid-word — `x-` / `outcome-` / `class` — while the chain itself
		// still overflowed and clipped.
		//
		// This guards the mechanism rather than the appearance, which is the honest limit of a
		// check that cannot lay out a page: the value track must be allowed to shrink, and a
		// header name must never wrap. Both are one-line properties of the grid that renders them.
		if (/'x-chain'/.test(page)) {
			const grid = /<dl className="grid ([^"]*)"/.exec(page)?.[1] ?? '';
			if (grid === '') {
				fail(
					'32',
					`${PAGE} no longer renders the headers in a <dl> grid — this check stopped checking`,
				);
			} else {
				if (!grid.includes('minmax(0,')) {
					fail(
						'32',
						`${PAGE} shows x-chain in a grid whose value track cannot shrink (${grid}). ` +
							'A bare `1fr` has min-width:auto, so the longest value squeezes the name ' +
							'column until header names break mid-word. Use minmax(0,1fr).',
					);
				}
				if (!/<dt className="whitespace-nowrap/.test(page)) {
					fail(
						'32',
						`${PAGE} lets header NAMES wrap. A name broken across lines is not a name.`,
					);
				}
			}
			checked32 += 1;
		}

		// 2c. THE SCENARIO BAR MUST NOT WRAP, for the same reason and on the same page.
		//
		// The `chain` label used to float loose above the figure, reading as a fourth tab. It was
		// moved INTO the bar, which fixed it on a desktop and reintroduced it on a phone: the bar
		// was `flex-wrap`, so at 390px the label took row one alone and the four tabs took row two.
		// Identical symptom, same element, one breakpoint away.
		//
		// Mechanism, not appearance, exactly like 2b. Four one-line properties decide it: the bar
		// does not wrap, the tab track may shrink and scrolls, and a tab label does not break. Miss
		// the last one and the wrap just moves down into the button.
		{
			const bar =
				/<div className="(flex [^"]*)">\s*<span className="[^"]*">\s*chain\s*<\/span>/.exec(
					page,
				)?.[1];
			if (bar === undefined) {
				fail(
					'32',
					`${PAGE} no longer renders the \`chain\` label inside a flex bar — this check stopped checking`,
				);
			} else {
				if (bar.includes('flex-wrap')) {
					fail(
						'32',
						`${PAGE} lets the scenario bar wrap (${bar}). At 390px that puts \`chain\` on ` +
							'its own row above the tabs, which is the floating label the bar exists to fix.',
					);
				}
				const track = /<div className="(flex [^"]*)">\s*\{SCENARIOS\.map/.exec(page)?.[1] ?? '';
				if (track === '') {
					fail('32', `${PAGE} no longer renders the scenario tabs in their own track`);
				} else {
					// A flex child defaults to min-width:auto, so without this the track refuses to
					// shrink below its content and pushes the bar wider than the phone instead.
					if (!track.includes('min-w-0')) {
						fail(
							'32',
							`${PAGE} gives the tab track no min-w-0 (${track}), so it cannot shrink and ` +
								'overflows the card rather than scrolling inside it.',
						);
					}
					if (!track.includes('overflow-x-auto')) {
						fail(
							'32',
							`${PAGE} does not scroll the scenario tabs, so the last one is unreachable.`,
						);
					}
				}
				if (!/className=\{`inline-flex [^`]*whitespace-nowrap/.test(page)) {
					fail(
						'32',
						`${PAGE} lets a scenario tab LABEL wrap. "first hop" then breaks over two lines ` +
							'inside its own button and doubles the bar height — the wrap moved, not went away.',
					);
				}
			}
			checked32 += 1;
		}

		// 3. The version in the banner actually shipped. Allowed to LAG — a transcript is a record
		//    of one run — so this is assertion 30's position, not "must be newest".
		const named = /const BANNER_VERSION = '([^']+)'/.exec(page)?.[1];
		if (named === undefined) {
			fail(
				'32',
				`${PAGE} no longer names a BANNER_VERSION — the banner check stopped checking`,
			);
		} else {
			const released = new Set(
				[...read(CHANGELOG).matchAll(/^## (\d+\.\d+\.\d+)$/gm)].map((m) => m[1] as string),
			);
			if (released.size === 0) fail('32', `parsed no released versions from ${CHANGELOG}`);
			else if (!released.has(named)) {
				fail(
					'32',
					`the homepage banner says gateway ${named}, which has no entry in ${CHANGELOG} — ` +
						'it was never released, so nobody ever saw that banner.',
				);
			}
			checked32 += 1;
		}

		if (checked32 > 0) ok('32', checked32, 'the homepage transcript matches the gateway');
	}
}

// ------------------- 33: the social card has a source, and the source is current
//
// `og.png` was committed as bytes on 2026-08-14 with no source and never touched again. Within
// three days it was wrong twice: it drew the raspberry-ring `o` that #108 retired, and its
// footer read "3 providers" while four shipped. Assertion 28 counts providers on the landing
// page and saw none of it, because a PNG is bytes and no assertion can read one.
//
// So the card is drawn in `og-card.svg` and the PNG is rendered from it by `pnpm og:render`,
// which records the SVG's digest beside the PNG. Three things follow, and each maps to one of
// the two ways this went wrong:
//
//   the digest must match, or the drawing changed and nobody re-rendered  (bytes went stale)
//   the provider count must match the registry                            (the "3 providers")
//   the accent must not appear                                            (the retired ring)
//
// The accent check is the sharpest of the three and worth stating plainly: `--color-accent` is
// the product's own colour, and the retired wordmark borrowed it for a letterform. A line colour
// identifies a provider; the accent identifies us. Nothing on this card should be wearing it.
{
	const SVG = 'apps/web/src/og-card.svg';
	const PNG = 'apps/web/public/og.png';
	const SHA = 'apps/web/public/og.png.sha';
	const REG = 'packages/adapters/src/registry.ts';
	if (!has(SVG) || !has(PNG) || !has(SHA) || !has(REG)) {
		const missing = [SVG, PNG, SHA, REG].filter((f) => !has(f));
		fail('33', `missing ${missing.join(', ')} — run \`pnpm og:render\``);
	} else {
		const svg = read(SVG);
		let checked33 = 0;

		// 1. The PNG came from THIS revision of the SVG.
		const want = createHash('sha256').update(svg).digest('hex');
		const got = read(SHA).trim();
		if (got !== want) {
			fail(
				'33',
				`${SVG} has changed since ${PNG} was rendered from it. Run \`pnpm og:render\`. ` +
					'A social card nobody can see going stale is how the last one lasted six days wrong.',
			);
		}
		checked33 += 1;

		// 2. The count in the footer is the registry's count. The DRAWING is three lanes and that
		//    is deliberate — it is one request that failed over twice, not an inventory — so this
		//    reads the footer claim, never the geometry.
		const regIds = [...read(REG).matchAll(/^\t'?([a-z][a-z0-9-]*)'?:/gm)].map(
			(m) => m[1] as string,
		);
		const claim = /<tspan[^>]*>(\d+)<\/tspan><tspan[^>]*>providers<\/tspan>/.exec(
			svg.replace(/\s+/g, ' '),
		);
		if (regIds.length === 0) {
			fail('33', 'parsed no registry ids — this check stopped checking');
		} else if (claim === null) {
			fail('33', `${SVG} no longer states a provider count in the shape this check reads`);
		} else if (Number(claim[1]) !== regIds.length) {
			fail(
				'33',
				`the social card says ${claim[1]} providers; the registry ships ${regIds.length} ` +
					`(${regIds.join(', ')}). Fix ${SVG}, then \`pnpm og:render\`.`,
			);
		}
		checked33 += 1;

		// 3. The retired ring cannot come back. It was `--color-accent` on a letterform.
		if (/#c2255c/i.test(svg)) {
			fail(
				'33',
				`${SVG} uses the accent (#c2255c). The wordmark's ring was retired in #108 for ` +
					'borrowing it: a line colour identifies a provider, the accent identifies us.',
			);
		}
		checked33 += 1;

		ok('33', checked33, 'the social card is rendered from a current source');
	}
}

// ------------------- 34: a documented default is the default the gateway ships
//
// `operations.md` recorded a decision to raise the global deadline to 120s, explained why, and
// called 90s "the old default". `integrations.md` wrote its budget arithmetic against the 120.
// The gateway shipped 90 the whole time, and so did `.env.example`, the compose file and the
// self-hosting table. Nobody was lying; the decision was written down and never implemented,
// and no check could tell the difference between "documented" and "shipped".
//
// It was not cosmetic. At 90s a three-hop chain gave the terminal provider 38s of its 70s cap,
// because `hopBudget` reserves for every hop still to come. The hop that exists to rescue a
// failing request was the one being cut short, which is the failure `operations.md` had already
// described and believed fixed.
//
// So every place that states a default value for an environment variable must agree with the
// fallback the code actually uses. Assertion 24 already checks a documented variable is READ by
// something; this checks the VALUE beside it is true.
{
	const SOURCES: ReadonlyArray<readonly [file: string, pattern: RegExp]> = [
		// `| \`VAR\` | \`value\` | ... |` in the self-hosting table
		['docs/self-hosting.md', /\|\s*`(PROXLANE_[A-Z_]+)`\s*\|\s*`([^`]+)`\s*\|/g],
		// `.env.example` IS DELIBERATELY NOT HERE. Its commented lines show the value you would
		// SET to change behaviour, not the value you get if you set nothing: `# PROXLANE_HEALTH=on`
		// sits under prose reading "off by default", and `# PROXLANE_COOLDOWNS=off` under "ON by
		// default". Reading those as default claims made this check report three failures on a
		// correct file the first time it ran. The defaults there live in prose, which is a harder
		// check and not this one.
		// `VAR: ${VAR:-value}` in compose
		['docker/compose.yml', /(PROXLANE_[A-Z_]+):\s*\$\{\1:-([^}]+)\}/g],
	];
	const GATEWAY = 'apps/gateway/src/index.ts';
	if (!has(GATEWAY)) {
		fail('34', `${GATEWAY} is missing, so documented defaults cannot be checked`);
	} else {
		const src = read(GATEWAY);
		// `env('VAR') ?? fallback`, with the underscores numeric literals may carry.
		const shipped = new Map<string, string>();
		for (const m of src.matchAll(/env\('(PROXLANE_[A-Z_]+)'\)\s*\?\?\s*([0-9_]+|'[^']*')/g)) {
			shipped.set(m[1] as string, (m[2] as string).replace(/[_']/g, ''));
		}
		if (shipped.size === 0) {
			fail('34', `parsed no defaults out of ${GATEWAY} — this check stopped checking`);
		} else {
			let checked34 = 0;
			for (const [file, pattern] of SOURCES) {
				if (!has(file)) continue;
				for (const m of read(file).matchAll(pattern)) {
					const name = m[1] as string;
					const documented = (m[2] as string).trim().replace(/[_']/g, '');
					const real = shipped.get(name);
					// Only variables whose default this file can see. A documented variable read
					// somewhere else is assertion 24's business, not this one.
					if (real === undefined) continue;
					checked34 += 1;
					if (documented !== real) {
						fail(
							'34',
							`${file} says ${name} defaults to ${documented}; ${GATEWAY} ships ${real}. ` +
								'A decision recorded and not implemented reads exactly like one that was.',
						);
					}
				}
			}
			if (checked34 === 0) {
				fail(
					'34',
					'matched no documented defaults — the table shapes changed and this stopped checking',
				);
			} else {
				ok('34', checked34, 'documented defaults match what the gateway ships');
			}
		}
	}
}

// ------------------- 35: the browser bundle never imports a Node builtin by accident
//
// `@proxlane/shared`'s barrel re-exports `id.ts`, which imports `node:crypto`. Import the
// barrel from anything the browser loads and the builtin comes with it. Vite externalises it
// and the page throws on load, which does not break that route: it kills HYDRATION FOR THE
// WHOLE SITE, because one thrown module takes the client bundle with it.
//
// It cost an afternoon. The sticky header stopped reacting to scroll, the header looked wrong,
// and the cause was a `policyFor` import three files away in a route nobody was looking at.
// Nothing failed. `pnpm check` was green, the pages served, the markup was correct, and only a
// real browser noticed.
//
// The subpath `@proxlane/shared/outcome` exists precisely for this and was already used
// correctly by the docs page next door, which is what makes the barrel import a slip rather
// than a missing capability.
{
	const WEB = 'apps/web/src';
	const BARREL = /from '@proxlane\/shared'/;
	if (!has(WEB)) {
		fail('35', `${WEB} is missing`);
	} else {
		let scanned = 0;
		const walk = (dir: string): void => {
			for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
				const rel = `${dir}/${entry.name}`;
				if (entry.isDirectory()) {
					walk(rel);
				} else if (/\.tsx?$/.test(entry.name)) {
					scanned += 1;
					const src = read(rel);
					// Comments mention the package by name constantly; only a real import counts.
					for (const line of src.split('\n')) {
						if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
						if (BARREL.test(line)) {
							fail(
								'35',
								`${rel} imports the \`@proxlane/shared\` barrel, which pulls node:crypto into ` +
									'the browser and kills hydration site-wide. Use `@proxlane/shared/outcome`.',
							);
						}
					}
				}
			}
		};
		walk(WEB);

		// AND EVERY HOP AFTER THE FIRST, because banning the barrel here only bans it HERE. It
		// happened again the moment `apps/web` took a dependency on `@proxlane/adapters`:
		// `contract.ts` imported the shared barrel, so the browser got `node:crypto` through a
		// package that never mentions it. This assertion was green throughout. Hydration was
		// dead, the page server-rendered perfectly, and the only symptom was a control that
		// would not click.
		//
		// So the graph is walked instead of the directory. Static imports only — a dynamic
		// `import()` is a separate chunk that never executes unless something calls it, which is
		// exactly how `REGISTRY` keeps four adapters out of the eager bundle.
		const BUILTIN = /from '(node:[a-z_/]+)'/;
		const seen = new Set<string>();
		const trail = new Map<string, string>();

		/** `@proxlane/x` -> packages/x/src/index.ts, `@proxlane/x/y` -> packages/x/src/y.ts. */
		const resolve = (spec: string, fromFile: string): string | undefined => {
			if (spec.startsWith('.')) {
				const base = join(dirname(fromFile), spec).replace(/\.js$/, '');
				for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
					if (has(c)) return c;
				}
				return undefined;
			}
			const m = /^@proxlane\/([a-z-]+)(?:\/(.+))?$/.exec(spec);
			if (m === null) return undefined;
			const sub = (m[2] ?? 'index').replace(/\.js$/, '');
			for (const c of [
				`packages/${m[1]}/src/${sub}.ts`,
				`packages/${m[1]}/src/${sub}/index.ts`,
			]) {
				if (has(c)) return c;
			}
			return undefined;
		};

		const follow = (file: string, from: string): void => {
			if (seen.has(file)) return;
			seen.add(file);
			trail.set(file, from);
			for (const line of read(file).split('\n')) {
				const t = line.trimStart();
				if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
				// `import(` is lazy and does not reach the eager bundle.
				if (/\bimport\(/.test(t)) continue;
				// `import type` is ERASED — `verbatimModuleSyntax` guarantees it — so it carries
				// nothing into the bundle. Following it reported `node:fs` reaching the browser
				// through a Vite plugin that a route imports two interfaces from. A whole-line
				// form only: `import { type A, b }` still emits a value import for `b`.
				if (/^(?:import|export) type\b/.test(t)) continue;
				const builtin = BUILTIN.exec(t);
				if (builtin !== null) {
					// Reconstruct how the browser got here — the useful half of the message.
					const path: string[] = [];
					for (let n: string | undefined = file; n !== undefined; n = trail.get(n)) {
						path.unshift(n);
						if (path.length > 8) break;
					}
					fail(
						'35',
						`${builtin[1]} reaches the browser bundle via ${path.join(' -> ')}. One thrown ` +
							'module kills hydration site-wide. Import by a subpath that does not carry it.',
					);
					continue;
				}
				const spec = /from '([^']+)'/.exec(t)?.[1];
				if (spec === undefined) continue;
				const next = resolve(spec, file);
				if (next !== undefined) follow(next, file);
			}
		};

		// Every web source is an entry: the router loads all of them.
		const entries: string[] = [];
		const collect = (dir: string): void => {
			for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
				const rel = `${dir}/${e.name}`;
				if (e.isDirectory()) collect(rel);
				else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) entries.push(rel);
			}
		};
		collect(WEB);
		for (const e of entries) follow(e, '');

		if (scanned === 0) fail('35', 'scanned no web sources — this check stopped checking');
		else if (seen.size <= entries.length) {
			// The walk must actually leave `apps/web`, or it is checking the same thing twice.
			fail('35', 'the import walk never reached a workspace package — it stopped checking');
		} else ok('35', seen.size, 'no Node builtin is reachable from a web source');
	}
}

// ------------------ 36: the analyser reads the policy table rather than quoting it
//
// The page at /block-page-detector tells a visitor what the gateway would do with the response
// they pasted: the status it returns, whether it fails over, whether it arms a cooldown. Its
// entire value is that those are the gateway's real answers.
//
// A UNIT TEST CANNOT CATCH THE DRIFT, which is why this exists. `expect(a.httpStatus).toBe(
// policyFor('SOFT_BLOCK').httpStatus)` passes just as happily when the analyser has `502` typed
// into it — verified by mutation, both directions green. The test proves the two agree today;
// only a ban on the literals stops one of them going stale while still agreeing with itself.
//
// So: the analyser may name the policy fields, and may not carry their values.
{
	const SRC = 'apps/web/src/lib/analyse.ts';
	if (!has(SRC)) {
		fail('36', `${SRC} is missing, and the detector page depends on it`);
	} else {
		const src = read(SRC);
		if (!src.includes('policyFor')) {
			fail(
				'36',
				`${SRC} no longer calls policyFor, so it is describing the gateway from memory. ` +
					'Every consequence it shows must come out of FAILOVER.',
			);
		}
		// One entry per field the page prints. The pattern is the field name followed by a
		// literal rather than a lookup, which is exactly the shape a copy takes.
		const banned: ReadonlyArray<readonly [string, RegExp]> = [
			['httpStatus', /httpStatus:\s*(?:\d|'upstream')/],
			['failover', /failover:\s*(?:true|false|'once')/],
			['cooldown', /cooldown:\s*'/],
			['chargeable', /chargeable:\s*(?:true|false|')/],
			['class', /\bclass:\s*'/],
			['meaning', /meaning:\s*'/],
		];
		for (const [field, re] of banned) {
			if (re.test(src)) {
				fail(
					'36',
					`${SRC} writes a literal ${field}. Read it from policyFor(outcome) instead — a ` +
						'copied value keeps agreeing with the test long after it stops agreeing with ' +
						'the gateway.',
				);
			}
		}
		// The vacuity guard. Without it, deleting the analyser's body passes every line above.
		if (!/readonly httpStatus:/.test(src) || !/readonly failover:/.test(src)) {
			fail('36', `${SRC} no longer surfaces the policy fields — this check stopped checking`);
		}
		ok('36', banned.length + 1, 'the detector page reads its policy rather than quoting it');
	}
}

// ------------------ 37: every price has a source, and somebody read it this year
//
// THE HOLE THIS FILLS, and it is worth being exact about what it cannot do. On 2026-08-21 all
// four cost tables were checked against the vendors' own pages and three were wrong — Scrapfly by
// 4.17x, because `CostTable` modelled cost as a product and Scrapfly is additive. Not one test
// could have caught it. Fixtures record what a provider RETURNS; conformance replays fixtures;
// nothing anywhere had ever compared our numbers to the vendor's published numbers.
//
// NOTHING HERE VERIFIES A PRICE EITHER, and it must not try. Fetching four pricing pages in CI
// would fail on a clean clone offline and make the build depend on a vendor's marketing site
// staying up — `scraperapi.com` returned 403 to a plain curl twice during that research. It is
// the same reason `k6` has no toolchain row and assertion 29 bans hostnames statically rather
// than resolving DNS.
//
// So this checks the things that make a wrong price FINDABLE and SHORT-LIVED: every number says
// where it came from, every table says when a human last read that page, and the age is printed
// on every run so it is visible long before it fails. That is the same discipline the pinned
// toolchain table already runs on — "Verified 2026-08-06. Do not invent versions" — applied to
// the one table nobody was checking.
{
	const ADAPTER_SRC = 'packages/adapters/src';
	const STALE_DAYS = 365;
	const NAG_DAYS = 180;
	let checked37 = 0;
	let oldest = { id: '', days: -1 };
	const seenUrls = new Map<string, string>();

	const ids = existsSync(join(ROOT, ADAPTER_SRC))
		? readdirSync(join(ROOT, ADAPTER_SRC), { withFileTypes: true })
				.filter((e) => e.isDirectory() && !e.name.startsWith('_'))
				.map((e) => e.name)
				.filter((n) => has(`${ADAPTER_SRC}/${n}/capabilities.ts`))
		: [];

	if (ids.length === 0) {
		fail(
			'37',
			`found no adapter capabilities under ${ADAPTER_SRC} — this check stopped checking`,
		);
	}

	for (const id of ids) {
		const path = `${ADAPTER_SRC}/${id}/capabilities.ts`;
		const src = read(path);

		// --- provenance
		const url = /sourceUrl: '([^']*)'/.exec(src)?.[1];
		if (url === undefined || !url.startsWith('https://') || /TODO/i.test(url)) {
			fail('37', `${path}: sourceUrl is missing, not https, or still the scaffold's TODO.`);
		} else {
			// Copy-paste is how a table gets attributed to a page that never held it. Two
			// providers cannot have read their prices off one URL.
			const other = seenUrls.get(url);
			if (other !== undefined) {
				fail('37', `${path}: sourceUrl is the same page as ${other}. One of them is wrong.`);
			}
			seenUrls.set(url, id);
		}

		// --- freshness
		const date = /effectiveDate: '(\d{4}-\d{2}-\d{2})'/.exec(src)?.[1];
		if (date === undefined) {
			fail('37', `${path}: no effectiveDate. A price with no read-date cannot be trusted.`);
		} else {
			const days = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
			if (Number.isNaN(days)) {
				fail('37', `${path}: effectiveDate ${date} is not a date.`);
			} else if (days < 0) {
				// A future date reads as fresher than anything and is always a typo.
				fail('37', `${path}: effectiveDate ${date} is in the future.`);
			} else if (days > STALE_DAYS) {
				fail(
					'37',
					`${path}: nobody has read ${url ?? 'the source'} in ${days} days. Re-read it, ` +
						'correct the matrix if it moved, and set effectiveDate to today.',
				);
			}
			if (days > oldest.days) oldest = { id, days };
		}

		// --- the scaffold's placeholder cannot ship
		const cells = [...src.matchAll(/(?:plain|rendered): (\d[\d_]*|null)/g)].map(
			(m) => m[1] as string,
		);
		if (cells.length === 0) {
			fail(
				'37',
				`${path}: no cost matrix cells found — this check stopped checking for ${id}.`,
			);
		} else if (cells.every((c) => c === '0' || c === 'null')) {
			// `new-adapter` writes six zeroes and a TODO. Shipping them advertises a free provider.
			fail(
				'37',
				`${path}: every matrix cell is still 0 or null. Read the provider's price page and ` +
					'fill it in; the scaffold does not know what anything costs.',
			);
		}

		// --- a country list `Set` would silently dedupe
		const countries = /countryCodes: new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1];
		if (countries !== undefined) {
			const codes = [...countries.matchAll(/'([a-z]{2})'/g)].map((m) => m[1] as string);
			const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
			if (dupes.length > 0) {
				// `new Set` swallows these at construction, so the runtime value is simply one
				// short and no test can see it. Only the source can.
				fail(
					'37',
					`${path}: country list repeats ${[...new Set(dupes)].join(', ')}. new Set() hides ` +
						'this at runtime, so the list is quietly shorter than it looks.',
				);
			}
		}

		checked37 += 1;
	}

	if (checked37 > 0) {
		// Printed every run, so the number creeps into view long before it fails the build.
		const nag =
			oldest.days > NAG_DAYS ? ` — oldest ${oldest.id} at ${oldest.days}d, re-read it` : '';
		ok('37', checked37, `cost tables carry a source and a read-date${nag}`);
	}
}

// ------------- 38: a rule is confirmed by a capture, never by somebody typing it
//
// `packages/detect/src/verified.ts` says which detection rules a real block page has confirmed,
// and the website prints it. It replaced a hand-set boolean on each rule — false on all six, and
// changeable to true in one keystroke with nothing behind it.
//
// CI CANNOT REGENERATE IT and must not pretend otherwise. Most captures live outside this
// repository because `plan.md` section 19 keeps captures of named targets out of it, so there is
// nothing here to recompute against. Same shape as the cost tables: unverifiable in CI, so the
// discipline is provenance.
//
// What is checkable is that the table cannot degrade into the thing it replaced: every entry
// names a real rule, cites at least one capture digest, and reports classes rather than names.
{
	const SRC = 'packages/detect/src/verified.ts';
	const RULES_SRC = 'packages/detect/src/index.ts';
	if (!has(SRC) || !has(RULES_SRC)) {
		fail('38', `${SRC} or ${RULES_SRC} is missing`);
	} else {
		const src = read(SRC);
		const ruleIds = new Set(
			[...read(RULES_SRC).matchAll(/^\t\tid: '([a-z0-9-]+)',$/gm)].map((m) => m[1] as string),
		);
		if (ruleIds.size === 0) {
			fail('38', `parsed no rule ids from ${RULES_SRC} — this check stopped checking`);
		}

		// The boolean must not come back. It is the whole reason this file exists.
		// A DECLARATION, not the word. The file explains at length why the field is gone, so a
		// substring test flags the comment that documents the fix. Same trap as the line-colour
		// ban, which failed on the paragraph forbidding line colours.
		if (/verifiedAgainstRealCapture\s*[?]?\s*:/.test(read(RULES_SRC))) {
			fail(
				'38',
				`${RULES_SRC} declares verifiedAgainstRealCapture again. That field was a claim ` +
					'anybody could type; the table is generated from captures instead.',
			);
		}

		const entries = [...src.matchAll(/^\t'([a-z0-9-]+)': \{([\s\S]*?)^\t\},$/gm)];
		let checked38 = 0;
		for (const [, id, body] of entries) {
			const name = id as string;
			if (!ruleIds.has(name)) {
				fail('38', `${SRC} claims a capture confirmed \`${name}\`, which is not a rule.`);
			}
			const captures = Number(/captures: (\d+)/.exec(body as string)?.[1] ?? '0');
			const digests = [...(body as string).matchAll(/'([0-9a-f]{8,})'/g)].length;
			// FROM THE `classes` ARRAY, not from every quoted token in the entry. Scanning the whole
			// body swept up `lastVerified: '2026-08-21'` as a class — dates match `[a-z0-9-]+` —
			// so a hostname could be planted in `classes` and the count still looked healthy.
			// Verified by mutation: `classes: ['nowsecure.nl']` passed.
			const classList = /classes: \[([^\]]*)\]/.exec(body as string)?.[1] ?? '';
			const classes = [...classList.matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
			if (captures < 1) fail('38', `${SRC}: ${name} is verified by ${captures} captures.`);
			if (digests < 1) {
				// A claim with no artefact behind it is the boolean wearing a table.
				fail('38', `${SRC}: ${name} cites no capture digest, so nothing backs the claim.`);
			}
			if (classes.length === 0) fail('38', `${SRC}: ${name} names no target class.`);
			for (const c of classes) {
				// Section 19: classes of target, never names. A dot is the tell for a hostname.
				if (c.includes('.'))
					fail('38', `${SRC}: ${name} names a host (\`${c}\`), not a class.`);
			}
			checked38 += 1;
		}
		// A table with no entries is the honest starting state and must not fail — but the file
		// still has to exist and still has to export the shape, or nothing reads it.
		if (!src.includes('export const VERIFIED')) {
			fail('38', `${SRC} no longer exports VERIFIED — this check stopped checking`);
		}
		ok('38', checked38 + 1, 'verified rules cite a capture, and name classes not hosts');
	}
}

// ------------------------------------------------- assertion 39: fixtures have a shelf life
//
// `recordedAt` WAS WRITTEN TWICE AND READ NOWHERE. Every fixture has carried one since the day
// `record.ts` was written, and nothing in the repository had ever looked at it — so a recording
// of a provider API as it behaved a year ago was indistinguishable from one taken this morning,
// and the contract suite would go on replaying it either way. A field nobody reads is a field
// that can say anything.
//
// THE WINDOW IS DELIBERATELY WIDE, and the reason matters more than the number. `record --diff`
// re-records weekly and stamps the date forward when the bytes are identical, so a fixture under
// an adapter with a key in CI never approaches this. Crossing it therefore does not mean "old",
// it means NOTHING HAS SUCCESSFULLY RE-RECORDED THIS IN FOUR MONTHS — the weekly job is dormant
// for want of a key, or it has been failing, or this adapter was never in the matrix. That is a
// finding about the drift detector, not a mandate to re-record on a schedule.
{
	const MAX_AGE_DAYS = 120;
	const now = Date.now();
	let checked39 = 0;
	const stale: string[] = [];
	const undated: string[] = [];

	const fixtures = execFileSync('git', ['ls-files', '*/fixtures/*.json'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean);

	for (const f of fixtures) {
		let at: unknown;
		try {
			at = (JSON.parse(readFileSync(join(ROOT, f), 'utf8')) as Record<string, unknown>)
				.recordedAt;
		} catch {
			fail('39', `${f} is not readable JSON`);
			continue;
		}
		checked39 += 1;
		const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
		if (!Number.isFinite(ms)) {
			undated.push(f);
			continue;
		}
		const days = Math.floor((now - ms) / 86_400_000);
		if (days > MAX_AGE_DAYS) stale.push(`${f} (${days}d)`);
	}

	// Non-zero denominator. Every claim above is vacuous over an empty fixture corpus, and the
	// corpus is exactly the thing that would go missing without anybody noticing.
	if (checked39 === 0) {
		fail('39', 'no fixtures found at all — the contract suite is replaying nothing');
	}
	for (const f of undated) {
		fail('39', `${f} has no parseable recordedAt, so its age cannot be known`);
	}
	if (stale.length > 0) {
		fail(
			'39',
			`${stale.length} fixture(s) have not re-recorded in ${MAX_AGE_DAYS} days, which means ` +
				`the weekly record-diff job is not covering them: ${stale.slice(0, 4).join(', ')}` +
				`${stale.length > 4 ? ` and ${stale.length - 4} more` : ''}`,
		);
	}
	ok('39', checked39, `fixtures re-recorded within ${MAX_AGE_DAYS} days`);
}

// --------------------------------------- assertion 40: a label named is a label that exists
//
// THE CANARY'S ONLY ALARM COULD NOT RING FOR ELEVEN WEEKS. Its failure step is
// `gh issue create --label "flag:provider-drift"`, that label had never been created, and
// `gh` resolves label names server-side and errors when one is missing. The step ended in
// `|| echo "::warning::…"`, and the step above it is `continue-on-error: true` by design —
// the issue was meant to BE the signal. So a provider changing its response shape produced a
// green scheduled run, no issue, and one annotation inside a log nobody opens.
//
// `.github/labels.json` is now the checked-in set and this holds every reference to it.
// WHAT IT CANNOT CHECK, stated plainly because the gap is the whole story: GitHub is the
// authority, and nothing offline proves the manifest and the repository agree. A network call
// here would fail `repo:check` from a clean clone, the same reason `k6` has no toolchain row
// and `DEAD_HOSTS` is a static list rather than a lookup. The second guard is that the
// canary's `|| echo` is gone, so an undeliverable alert now goes red at the moment it matters.
{
	const MANIFEST = '.github/labels.json';
	let known: Set<string>;
	try {
		const raw = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8')) as {
			labels?: { name?: string }[];
		};
		// Read the `labels` ARRAY, never the object's keys — assertion 29 derived a command
		// count from `Object.keys(commands.json)` and counted the `$comment` block as a
		// command, which is how the README came to advertise 28 of them where 27 exist.
		known = new Set((raw.labels ?? []).map((l) => String(l.name)));
	} catch {
		fail('40', `${MANIFEST} is missing or not JSON — nothing holds workflow labels to reality`);
		known = new Set();
	}
	if (known.size === 0) fail('40', `${MANIFEST} declares no labels`);

	const refs: { label: string; where: string }[] = [];
	const ghFiles = execFileSync('git', ['ls-files', '.github/*.yml', '.github/**/*.yml'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean);

	for (const f of ghFiles) {
		const src = readFileSync(join(ROOT, f), 'utf8');
		// `--label "x"` / `--label x` in a workflow step.
		for (const m of src.matchAll(/--label[= ]+["']?([^"'\s\\]+)/g)) {
			if (m[1]) refs.push({ label: m[1], where: f });
		}
		// `labels: [a, b]` in an issue-template front matter.
		for (const m of src.matchAll(/^labels:\s*\[([^\]]+)\]/gm)) {
			for (const l of (m[1] ?? '').split(',')) {
				const name = l.trim().replace(/^["']|["']$/g, '');
				if (name) refs.push({ label: name, where: f });
			}
		}
	}

	// Non-zero denominator. The canary and two issue templates reference labels; a run that
	// found none has stopped reading the files rather than found them clean.
	if (refs.length === 0) {
		fail('40', 'no label references found in .github — this check stopped checking');
	}
	for (const r of refs) {
		if (!known.has(r.label)) {
			fail('40', `${r.where} names label "${r.label}", absent from ${MANIFEST}`);
		}
	}
	ok('40', refs.length, `label references resolve to a declared label`);
}

// ------------------ assertion 41: every adapter's key reaches every place that must pass it
//
// THE FOURTH ADAPTER WAS ADDED TO `REGISTRY` AND NOTHING DERIVED FROM `REGISTRY`. The gateway
// builds each provider's variable at `apps/gateway/src/index.ts` by uppercasing the registry
// id — so Bright Data has always read `BRIGHTDATA_KEY` — while `docker/compose.yml` and
// `.env.example` were hand-maintained lists that stopped at three. A self-hoster read the env
// table, set the variable, ran the documented compose command, and Bright Data was silently
// absent from the chain with no error anywhere: compose does not forward an unlisted variable,
// and the gateway's own "no key, not in the chain" behaviour is indistinguishable from it.
//
// The same omission ran through CI: the weekly canary passed three keys, so it generated zero
// tests for the fourth adapter and went green anyway.
//
// This is the derivation, so adapter five costs one edit rather than five.
{
	const REG = 'packages/adapters/src/registry.ts';
	const src = existsSync(join(ROOT, REG)) ? readFileSync(join(ROOT, REG), 'utf8') : '';
	// The object literal's keys, which is exactly what the gateway iterates.
	const body = /export const REGISTRY[\s\S]*?=\s*\{\n([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
	const ids = [...body.matchAll(/^\t([a-z][a-z0-9_]*)\s*:/gm)].map((m) => m[1] as string);

	// Non-zero denominator, and a floor that matches the launch set. A regex that silently
	// stopped matching would otherwise make this assertion pass over an empty list.
	if (ids.length < 3) {
		fail(
			'41',
			`parsed ${ids.length} adapter ids from ${REG}; expected at least the 3 launch adapters`,
		);
	}

	const envVar = (id: string) => `${id.toUpperCase().replace(/-/g, '_')}_KEY`;
	// Each consumer, and what it would cost the reader to have it missing.
	const consumers: { file: string; why: string }[] = [
		{ file: 'docker/compose.yml', why: 'compose does not forward a variable it does not list' },
		{ file: '.env.example', why: 'this is where a self-hoster reads which variable to set' },
		{
			file: '.github/workflows/scheduled.yml',
			why: 'the canary and record-diff generate no coverage for a key they never pass',
		},
	];

	let checked41 = 0;
	for (const c of consumers) {
		if (!existsSync(join(ROOT, c.file))) {
			fail('41', `${c.file} does not exist, so nothing holds it to the registry`);
			continue;
		}
		const text = readFileSync(join(ROOT, c.file), 'utf8');
		for (const id of ids) {
			checked41 += 1;
			if (!text.includes(envVar(id))) {
				fail('41', `${c.file} never names ${envVar(id)} — ${c.why}`);
			}
		}
	}
	ok('41', checked41, 'adapter keys reach compose, .env.example and the scheduled jobs');
}

// ------------------------- assertion 42: a surface that names providers names all of them
//
// FOUR PUBLIC SURFACES SAID "ScraperAPI, ScrapingBee and Scrapfly" for as long as the fourth
// adapter had been shipping: the OpenAPI summary a client generator reads, the docs quickstart,
// the site's own meta description, and the docs index. Each was a sentence somebody typed once,
// and nothing derived it — the same root cause as assertion 41, in prose instead of plumbing.
//
// Scoped to files that describe WHAT THE GATEWAY ROUTES ACROSS, deliberately. `CLAUDE.md`'s
// "Launch adapters: ScraperAPI, ScrapingBee, Scrapfly" is a historical decision and is still
// true; a blanket ban on naming a subset anywhere would fail on it and on every changelog entry.
{
	const NAMED_SURFACES = [
		'scripts/openapi.ts',
		'apps/web/content/docs/quickstart.md',
		'apps/web/src/routes/__root.tsx',
		'apps/web/src/routes/docs/index.tsx',
	];
	// The display names the README table already generates from, so there is one list.
	const namesSrc = read('scripts/readme-providers.ts');
	const mapOf = (which: string): Record<string, string> => {
		const b = new RegExp(
			`export const ${which}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`,
		).exec(namesSrc)?.[1];
		return Object.fromEntries(
			[...(b ?? '').matchAll(/^\t([a-z0-9_]+): '([^']+)'/gm)].map((m) => [
				m[1] as string,
				m[2] as string,
			]),
		);
	};
	const products = mapOf('NAMES');
	const prose = mapOf('PROSE');
	const names = Object.values(prose);

	if (names.length < 3) {
		fail(
			'42',
			`parsed ${names.length} prose names from readme-providers.ts; expected at least 3`,
		);
	}
	// The two maps cannot drift: same ids, and the prose form must be a prefix of the product
	// form, so "Bright Data" and "Bright Data Web Unlocker" stay the same provider.
	for (const id of new Set([...Object.keys(products), ...Object.keys(prose)])) {
		const pr = products[id];
		const ps = prose[id];
		if (pr === undefined) fail('42', `PROSE names "${id}" and NAMES does not`);
		else if (ps === undefined) fail('42', `NAMES names "${id}" and PROSE does not`);
		else if (!pr.startsWith(ps))
			fail('42', `PROSE "${ps}" is not a prefix of NAMES "${pr}" for ${id}`);
	}
	let checked42 = 0;
	for (const f of NAMED_SURFACES) {
		if (!has(f)) {
			fail('42', `${f} is gone — reword this assertion rather than letting it pass`);
			continue;
		}
		// WHITESPACE COLLAPSED, because prose wraps. Prettier reflowed the docs index so that
		// "Bright Data" spanned a line break as `Bright\n\t\t\t\t\tData`, and a literal
		// substring test called a correct sentence a violation. A name split by a newline is
		// still the name to every reader of the rendered page.
		const text = read(f).replace(/\s+/g, ' ');
		// Only a surface that already names SOME provider is held to naming them all. A file
		// that stops describing the chain entirely is a different change, and this should not
		// be the thing that blocks it.
		const mentions = names.filter((n) => text.includes(n));
		if (mentions.length === 0) continue;
		checked42 += 1;
		const missing = names.filter((n) => !text.includes(n));
		if (missing.length > 0) {
			fail(
				'42',
				`${f} names ${mentions.length} of ${names.length} providers, omitting ${missing.join(', ')}`,
			);
		}
	}
	if (checked42 === 0) {
		fail('42', 'no surface names any provider — this check stopped checking');
	}
	ok('42', checked42, 'surfaces describing the chain name every shipped provider');
}

// ------------------------------------- assertion 43: a retracted claim stays retracted
//
// `repo:check` bans retired FIGURES — a stale command count, a stale adapter count, a hostname
// with no DNS record. Nothing banned a retired SENTENCE, and one sat in `health.ts` for as long
// as the function existed: "the terminal hop is the least-degraded member of the chain". Best
// first means worst last, so it was never true in any configuration. `integrations.md` section
// 5 was corrected; the docstring and the test named after it were not, and the test asserted
// the negation of its own title while passing.
//
// It is not cosmetic. Section 5 gives the terminal hop 75s against everyone else's 22s, so a
// cap chosen by position hands the worst provider 3.4x the budget. `chain.ts` keys the cap off
// health to avoid that, and anyone "fixing" `orderChain` to match its own docstring would
// reopen the defect.
//
// ONE EXEMPTION, NAMED: the paragraph in `integrations.md` that records the retraction has to
// be able to quote the claim it is retracting. Everything else is banned. This is the third
// time a ban has had to exempt the text explaining the ban — see the `--color-line-` and
// `verifiedAgainstRealCapture` assertions, which both fired on their own comments first.
{
	const RETRACTED = [
		{
			// Matched on the CLAIM FORM, not on the words. "terminal hop" appears legitimately all
			// over `chain.ts` and section 5; only the assertion that it holds the healthiest
			// member is retired.
			pattern:
				/terminal hop (?:is|holds|gets)[^.]{0,40}(least-degraded|healthiest|most healthy)/i,
			what: 'the terminal hop holds the least-degraded member',
			why: 'best first means worst last; integrations.md section 5 records the retraction',
		},
	];
	// The one place allowed to quote a retracted claim, because its job is to retract it.
	const EXEMPT = new Set(['docs/integrations.md', 'scripts/repo-check.ts']);

	const scanned = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.md'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean)
		.filter((f) => !EXEMPT.has(f) && !f.includes('/dist/') && !f.includes('CHANGELOG'));

	// Non-zero denominator, and a real floor: this walks most of the repository, so a glob that
	// silently stopped matching would otherwise report a clean scan of nothing.
	if (scanned.length < 50) {
		fail('43', `scanned only ${scanned.length} files; the glob has stopped matching`);
	}
	let checked43 = 0;
	for (const f of scanned) {
		const text = readFileSync(join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
		for (const r of RETRACTED) {
			checked43 += 1;
			if (r.pattern.test(text)) {
				fail('43', `${f} still claims ${r.what} — ${r.why}`);
			}
		}
	}
	ok('43', checked43, 'files checked for a retracted claim');
}

// ----------------- assertion 46: the deploy filter lists every package the site builds from
//
// A PATH FILTER IS A NARROWING, NOT A DESCRIPTION — the workflow's own comment says so, and then
// the list named `ui` and `route-viz` and stopped. `apps/web` also depends on `adapters`,
// `detect` and `shared`, so correcting a cost table or a detect rule landed on `main` and the
// live site went on serving the old figure with no error anywhere. The landing page's provider
// table is now built from `CAPABILITIES`, which turns that gap from theoretical into the normal
// case.
//
// DERIVED FROM THE MANIFEST, because that is the only list that cannot be forgotten: adding a
// workspace dependency to `apps/web` is what makes the site depend on it.
{
	const WF = '.github/workflows/deploy-web.yml';
	const MANIFEST = 'apps/web/package.json';
	if (!has(WF) || !has(MANIFEST)) {
		fail('46', `${WF} or ${MANIFEST} is missing, so the deploy filter cannot be checked`);
	} else {
		const pkg = JSON.parse(read(MANIFEST)) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const names = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
			.filter(([, v]) => String(v).startsWith('workspace:'))
			.map(([k]) => k);

		// Map each package name to its directory by reading the manifests, rather than assuming
		// the directory matches the scoped name — `proxlane` lives in `packages/cli`.
		const dirs = new Map<string, string>();
		for (const f of execFileSync('git', ['ls-files', 'packages/*/package.json'], {
			cwd: ROOT,
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean)) {
			const name = (JSON.parse(readFileSync(join(ROOT, f), 'utf8')) as { name?: string }).name;
			if (name !== undefined) dirs.set(name, f.replace(/\/package\.json$/, ''));
		}

		const wf = read(WF);
		const needed = names.map((n) => dirs.get(n)).filter((d): d is string => d !== undefined);
		// Non-zero denominator. `tooling/*` packages have no `packages/` directory and drop out
		// here, so an empty list means the manifest parse broke rather than that nothing is needed.
		if (needed.length === 0) {
			fail(
				'46',
				`parsed no workspace package directories from ${MANIFEST} — this stopped checking`,
			);
		} else {
			const missing = needed.filter((d) => !wf.includes(`'${d}/**'`));
			if (missing.length > 0) {
				fail(
					'46',
					`${WF} does not deploy on changes to ${missing.join(', ')}, which ${MANIFEST} ` +
						'depends on. A change there lands on main and the live site stays stale.',
				);
			}
			ok('46', needed.length, 'the web deploy filter covers every package the site imports');
		}
	}
}

// ------------------ assertion 44: the homepage banner prints the order the gateway routes in
//
// THE HOMEPAGE ADVERTISED A ROUTING ORDER THE PRODUCT DOES NOT HAVE. Its boot-banner transcript
// printed the provider table's order followed by the words "(in order)", while
// `DEFAULT_PROVIDER_ORDER` in `apps/gateway/src/index.ts` puts Scrapfly ahead of ScrapingBee.
// A visitor reading the banner as ground truth — which provider gets tried, and paid, first —
// got the wrong answer, on the page the product leads with.
//
// The check that was supposed to keep the transcript honest compared it against the landing
// page's own `LAUNCH_LINES`, which does not decide routing. So changing the real order left it
// green: it was pinned to a file that cannot be wrong about the thing being checked.
//
// A LITERAL ON EACH SIDE, ASSERTED EQUAL, because `apps/web` and `apps/gateway` are separate
// deployables and neither may import the other — the same shape as the compose-tags assertion
// against `tooling/containers/images.ts`.
{
	const PAGE = 'apps/web/src/routes/index.tsx';
	const GATEWAY = 'apps/gateway/src/index.ts';
	if (!has(PAGE) || !has(GATEWAY)) {
		fail('44', `${PAGE} or ${GATEWAY} is missing, so the banner cannot be checked`);
	} else {
		const list = (src: string, name: string): string[] => {
			const body = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src)?.[1] ?? '';
			return [...body.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1] as string);
		};
		const routed = list(read(GATEWAY), 'DEFAULT_PROVIDER_ORDER');
		const shown = list(read(PAGE), 'ROUTING_ORDER');

		// Non-zero denominators on both sides. A regex that stopped matching would otherwise
		// compare two empty lists and report agreement.
		if (routed.length === 0 || shown.length === 0) {
			fail(
				'44',
				`parsed ${routed.length} routed and ${shown.length} shown providers — one of the ` +
					'two shapes changed and this check stopped checking',
			);
		} else if (shown.slice(0, routed.length).join(',') !== routed.join(',')) {
			// PREFIX, not equality. `providerOrder()` puts anything omitted from
			// DEFAULT_PROVIDER_ORDER behind those named, keeping its registry position — so the
			// page may name more providers than the constant does, but never in a different
			// order for the ones it does name.
			fail(
				'44',
				`${PAGE} shows "${shown.join(' > ')}" as the routing order; ${GATEWAY} routes ` +
					`"${routed.join(' > ')}". Owner: design-engineer.`,
			);
		} else {
			ok('44', shown.length, 'the homepage banner prints the gateway’s routing order');
		}
	}
}

// ---------------------- assertion 45: the README does not deny a release that has happened
//
// THE FRONT DOOR'S FIRST PARAGRAPH SAID "No packages are published yet" while `proxlane` was at
// 0.4.0 across eleven versions and four scoped packages were on npm — and the same README
// instructs the reader to run `npx proxlane`. Under-claiming rather than over-claiming, but it
// tells every visitor that the CLI they are about to be told to run does not exist.
//
// DERIVED FROM THE CHANGELOGS, NOT FROM npm. A network call would fail `repo:check` from a
// clean clone and make CI assert that a registry is up — the same reason `DEAD_HOSTS` is a
// static list and `k6` has no toolchain row. A released version heading in a publishable
// package's CHANGELOG is written by `changeset version` at release time, so it is the local
// record of the thing being claimed.
{
	const README = 'README.md';
	const DENIALS = [/no packages are published/i, /nothing is published (?:to )?(?:npm )?yet/i];

	const changelogs = execFileSync('git', ['ls-files', 'packages/*/CHANGELOG.md'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean);

	// A `## 1.2.3` heading is what `changeset version` writes when a release is cut.
	const released = changelogs.filter((f) =>
		/^## \d+\.\d+\.\d+/m.test(readFileSync(join(ROOT, f), 'utf8')),
	);

	if (!has(README)) {
		fail('45', 'README.md is missing');
	} else if (changelogs.length === 0) {
		// Non-zero denominator. No changelogs means the glob stopped matching, not that nothing
		// has shipped — and reporting "nothing published" from that would be the same lie.
		fail('45', 'found no package CHANGELOGs — this check stopped checking');
	} else {
		// BLOCKQUOTE MARKERS STRIPPED FIRST. The claim lives inside a `>` block, so collapsing
		// whitespace alone leaves "No packages are > published yet" and the pattern misses it —
		// which it did, silently, on the first run of this assertion.
		const readme = read(README)
			.replace(/^\s*>\s?/gm, '')
			.replace(/\s+/g, ' ');
		const denied = DENIALS.filter((re) => re.test(readme));
		if (released.length > 0 && denied.length > 0) {
			fail(
				'45',
				`${README} says nothing is published while ${released.length} package(s) have a ` +
					`released version in their CHANGELOG (${released.slice(0, 3).join(', ')}). ` +
					'Owner: oss-maintainer.',
			);
		}
		ok('45', changelogs.length, 'the README does not deny a release that has happened');
	}
}

// -------------------------------------------------------------------------- report

const out = failures.length ? process.stderr : process.stdout;
out.write(`\nrepo:check — ${checked} items across ${notes.length} assertions\n\n`);
out.write(`${notes.join('\n')}\n`);
if (failures.length) {
	out.write(`\n${failures.length} FAILURE(S):\n${failures.join('\n')}\n\n`);
	process.exit(1);
}
out.write('\nall assertions pass\n\n');
