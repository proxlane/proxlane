// pnpm bootstrap — a contributor's first command.
//
// NOT `pnpm setup`: that is a pnpm built-in. pnpm dispatches built-ins before falling
// through to `run`, so a root script named `setup` can never be invoked — what runs instead
// configures PNPM_HOME, appends to the contributor's ~/.zshrc, and exits 0. The first
// command a newcomer types would silently mutate their shell profile, install nothing, and
// report success. repo:check assertion 11 now bans any root-script id that collides with a
// built-in, so this cannot regress.
//
// Zero dependencies, and it cannot use the CLI's renderer: this runs BEFORE install, so
// citty/picocolors/@clack are not on disk. The handful of ANSI codes are hand-rolled behind
// the same NO_COLOR / non-TTY check the CLI uses.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
	dim: (s: string) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
	green: (s: string) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
	red: (s: string) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
	bold: (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
};

function which(cmd: string, args: string[]): string | undefined {
	try {
		return execFileSync(cmd, args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return undefined;
	}
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const wantNode = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
const wantPnpm =
	String(pkg.packageManager ?? '')
		.replace(/^pnpm@/, '')
		.split('+')[0] ?? '';

type Check = {
	label: string;
	got: string | undefined;
	want: string;
	ok: boolean;
	hint: string;
};

const nodeGot = process.version.replace(/^v/, '');
const pnpmGot = which('pnpm', ['--version']);
const dockerGot = which('docker', ['--version'])
	?.replace(/^Docker version /, '')
	.split(',')[0];

const checks: Check[] = [
	{
		label: 'Node',
		got: nodeGot,
		want: wantNode,
		ok: nodeGot.split('.')[0] === wantNode.split('.')[0],
		hint: `n install ${wantNode}   (or fnm/nvm install ${wantNode})`,
	},
	{
		label: 'pnpm',
		got: pnpmGot,
		want: wantPnpm,
		ok: pnpmGot === wantPnpm,
		hint: 'corepack install   (the version is pinned in packageManager)',
	},
	{
		label: 'Docker',
		got: dockerGot,
		want: 'any',
		ok: Boolean(dockerGot),
		hint: 'needed for testcontainers — install Docker Desktop or colima',
	},
];

process.stdout.write(`\n${c.bold('proxlane bootstrap')}\n\n`);
let failed = 0;
for (const ck of checks) {
	const mark = ck.ok ? c.green('ok') : c.red('MISSING');
	const detail = ck.got ?? c.dim('not found');
	process.stdout.write(`  ${ck.label.padEnd(8)} ${String(detail).padEnd(12)} ${mark}\n`);
	if (!ck.ok) {
		process.stdout.write(`  ${' '.repeat(8)} ${c.dim(`want ${ck.want} — ${ck.hint}`)}\n`);
		failed++;
	}
}

if (failed > 0) {
	process.stderr.write(
		`\n${c.red(`${failed} prerequisite(s) missing.`)} Fix the above, then re-run.\n\n`,
	);
	process.exit(1);
}

// Hooks are committed to the repo and enabled here rather than left to a README line.
// Nothing on a free private repo requires a status check, so until the repo is public
// these are the only thing between a red build and `main`.
process.stdout.write(`  ${c.dim('installing git hooks…')}\n`);
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT });

process.stdout.write(`\n  ${c.dim('installing…')}\n`);
try {
	execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: ROOT, stdio: 'inherit' });
} catch {
	process.stdout.write(
		`  ${c.dim('no lockfile yet — installing without --frozen-lockfile')}\n`,
	);
	execFileSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
}
process.stdout.write(`  ${c.dim('building…')}\n`);
execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });

process.stdout.write(
	[
		'',
		`  ${c.green('Ready.')}`,
		'',
		`  ${c.bold('You do NOT need provider API keys to contribute.')}`,
		`  ${c.dim('Contract tests replay recorded fixtures, so an adapter can be written and')}`,
		`  ${c.dim('verified with nothing but Node, pnpm and Docker. The one check that needs')}`,
		`  ${c.dim('real keys is the live canary, which cannot run on a fork PR at all — a')}`,
		`  ${c.dim('maintainer runs it. A skipped canary on your PR is expected, not a failure.')}`,
		'',
		`  Next:  ${c.bold('pnpm new-adapter <id>')}   then   ${c.bold('pnpm conformance')}`,
		'',
	].join('\n'),
);
