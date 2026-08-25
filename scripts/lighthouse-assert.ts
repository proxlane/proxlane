// `pnpm lighthouse:assert` — the design quality floor, run against a real production build.
//
// AGAINST THE BUILD, NEVER THE DEV SERVER. A dev bundle is unminified, unsplit and served
// through a transform pipeline, so its performance number describes Vite rather than the page.
// Accessibility would survive the swap; nothing else would, and a floor that only half means
// what it says is the kind of green this repo is arranged against.
//
// The manifest gate said "one blank route passes everything, so this is meaningless until the
// marketing site exists". It exists now, so this is wired to fail on a page that regresses
// rather than to certify an empty one — see the non-zero-denominator checks below.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');
/**
 * Passed on the command line rather than hardcoded.
 *
 * `repo:check` assertion 2 requires a command to REFERENCE its declared subject, which is the
 * rule that stops the manifest pointing at a file the command never opens. Naming the config
 * in `package.json` satisfies it honestly instead of by renaming the subject to whatever the
 * script happened to be called.
 */
const CONFIG_FLAG = process.argv.find((a) => a.startsWith('--config='))?.slice(9);
const CONFIG = join(ROOT, CONFIG_FLAG ?? 'tooling/lighthouse/lighthouserc.json');
/** Not 3000 or 5173: a preview server fighting a dev server for a port fails as a timeout. */
const PORT = 4317;
/**
 * Fetched at run time, not installed — see `tooling/lighthouse/README.md`.
 *
 * PINNED, because `pnpm dlx @lhci/cli` with no version silently tracks latest, and a quality
 * gate whose thresholds were measured against one version should not quietly move to another.
 * Bump it here and in that README together.
 */
const LHCI = '@lhci/cli@0.15.1';
const URL = `http://localhost:${PORT}/`;

function fail(message: string): never {
	process.stderr.write(`\n  lighthouse:assert failed — ${message}\n\n`);
	process.exit(1);
}

function run(cmd: string, args: readonly string[], cwd: string): number {
	const r = spawnSync(cmd, [...args], { cwd, stdio: 'inherit', env: process.env });
	return r.status ?? 1;
}

if (!existsSync(CONFIG)) fail(`no config at ${CONFIG}`);

process.stdout.write('\n  building apps/web…\n');
if (run('pnpm', ['--filter', '@proxlane/web', 'build'], ROOT) !== 0)
	fail('the build did not succeed');

// The built client AND the server bundle. `vite preview` will happily serve a stale or partial
// output, and a Lighthouse run against a shell is the exact false green the gate warns about.
// `dist/server/index.js`, not `server.js`. The guard named a file the build has not emitted
// for some time, so this command failed on its own precondition before Lighthouse ever ran —
// a gate that cannot open is indistinguishable from one nobody is failing.
for (const artifact of ['dist/index.html', 'dist/server/index.js']) {
	if (!existsSync(join(WEB, artifact))) fail(`build produced no ${artifact}`);
}

process.stdout.write(`  serving the build on ${URL}\n`);
const server = spawn(
	'pnpm',
	['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
	{
		cwd: WEB,
		stdio: 'ignore',
		env: process.env,
	},
);
const stop = (): void => {
	if (!server.killed) server.kill('SIGTERM');
};
process.on('exit', stop);
process.on('SIGINT', () => {
	stop();
	process.exit(130);
});

/** Poll rather than parse the banner: the ready line has moved between Vite majors. */
async function waitForServer(): Promise<void> {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(URL, { signal: AbortSignal.timeout(1500) });
			if (res.ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	fail('the preview server never answered');
}

await waitForServer();

// The page must be SERVER-RENDERED before it is audited. `vite preview` on an SSR app can serve
// a client shell, and a shell scores well on everything by having nothing in it — precisely the
// blank-route pass this command exists to rule out.
const html = await (await fetch(URL)).text();
if (!html.includes('Your request, rerouted')) {
	fail('the served HTML has no rendered hero — auditing a shell would certify nothing');
}
process.stdout.write(`  server-rendered HTML confirmed (${html.length} bytes)\n\n`);

process.stdout.write(`  fetching ${LHCI} (not a dependency of this repo)\n`);
const collected = run(
	'pnpm',
	['dlx', LHCI, 'collect', `--config=${CONFIG}`, `--url=${URL}`],
	ROOT,
);
stop();
if (collected !== 0) {
	fail(
		'lighthouse could not collect a run.\n' +
			'  It needs a local Chrome and a network fetch of the CLI on first use.\n' +
			'  See tooling/lighthouse/README.md.',
	);
}

const asserted = run('pnpm', ['dlx', LHCI, 'assert', `--config=${CONFIG}`], ROOT);
if (asserted !== 0) fail('the page is below the design quality floor');

process.stdout.write('\n  lighthouse ok — accessibility 100, and the floor holds\n\n');
