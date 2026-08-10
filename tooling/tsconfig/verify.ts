// This package ships JSON, so there is no source to typecheck — but the configs can still
// be wrong. A broken `extends` chain or an unknown compiler option fails here rather than
// mysteriously in whichever package inherits it.

import { spawnSync } from 'node:child_process';

const CONFIGS = ['base', 'node', 'react', 'scripts'];
let failed = 0;

for (const name of CONFIGS) {
	// One command string rather than an args array: with shell:true the array form trips
	// DEP0190, and these arguments are literals we control.
	const r = spawnSync(`tsc --showConfig -p ${name}.json`, {
		encoding: 'utf8',
		shell: true,
	});
	if (r.status !== 0) {
		process.stderr.write(`${name}.json does not resolve:\n${r.stderr}\n`);
		failed++;
	}
}

if (failed > 0) process.exit(1);
process.stdout.write(`${CONFIGS.length} tsconfigs resolve\n`);
