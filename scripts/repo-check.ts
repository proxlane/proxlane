// repo:check — the one exit criterion whose subject already exists on day one.
//
// Zero dependencies: it must run before `pnpm install` has ever succeeded, and it must not
// be able to fail for a reason unrelated to what it is checking.
//
// Every assertion carries a non-zero denominator. A check that examined zero items exits 1
// and says so, because a vacuous pass is the same lie as a zero-exit stub. There are
// exactly two documented exemptions, both marked EXEMPT below.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodeowners, parseTable, ticks } from './codeowners.ts';

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

// -------------------------------------------------------------------------- report

const out = failures.length ? process.stderr : process.stdout;
out.write(`\nrepo:check — ${checked} items across ${notes.length} assertions\n\n`);
out.write(`${notes.join('\n')}\n`);
if (failures.length) {
	out.write(`\n${failures.length} FAILURE(S):\n${failures.join('\n')}\n\n`);
	process.exit(1);
}
out.write('\nall assertions pass\n\n');
