// Point `docker/compose.yml` at the gateway version that was just released.
//
// WHY THIS EXISTS, and it is a deadlock I created. `repo:check` assertion 30 used to accept any
// released version in the compose pin, which let the self-host path sit five minors behind — a
// reader followed the guide, got 0.3.2, then read an API reference describing headers it does not
// emit. Tightening it to require the NEWEST release fixed that and made the changesets release PR
// permanently unmergeable: `changeset version` bumps the gateway and writes its CHANGELOG, the
// assertion reads that CHANGELOG, and the pin cannot be updated by hand in a PR that a bot
// regenerates. Every gateway fix since 0.8.0 sat undeployed behind it.
//
// The pin is DERIVED now, at the moment the version is decided. Run as changesets' `version`
// lifecycle script, so the compose bump lands in the same commit as the bump it refers to and the
// assertion is true by construction rather than by somebody remembering.
//
// Deliberately NOT `:latest`. `operating.md` B8 makes the pin the supported choice; a floating tag
// is the unstable one and would make the assertion meaningless rather than satisfied.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(ROOT, 'docker/compose.yml');
const MANIFEST = join(ROOT, 'apps/gateway/package.json');
const IMAGE = /(image:\s*ghcr\.io\/proxlane\/gateway:)(\S+)/g;

const version = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { version?: string }).version;
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
	process.stderr.write(`apps/gateway/package.json has no usable version: ${String(version)}\n`);
	process.exit(1);
}

const before = readFileSync(COMPOSE, 'utf8');
const after = before.replace(IMAGE, `$1${version}`);

// Non-zero denominator. A rename of the image would otherwise make this a silent no-op, and the
// assertion it feeds would then fail with no clue that its input had stopped matching.
if (!IMAGE.test(before)) {
	process.stderr.write(`${COMPOSE} names no gateway image — this script stopped working\n`);
	process.exit(1);
}

if (after === before) {
	process.stdout.write(`  compose already pins gateway:${version}\n`);
} else {
	writeFileSync(COMPOSE, after);
	process.stdout.write(`  compose now pins gateway:${version}\n`);
}
