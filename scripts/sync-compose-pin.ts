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
// EVERY FILE THAT NAMES THE IMAGE, not just the compose file. `render.yaml` is a one-click
// deploy blueprint, so a stale pin there hands a stranger an old gateway on their very first
// impression — the same failure the compose pin had, on a surface with less forgiving readers.
const PINNED = ['docker/compose.yml', 'render.yaml'];
const MANIFEST = join(ROOT, 'apps/gateway/package.json');
// BOTH SPELLINGS. Compose writes `image: ghcr.io/…`; a Render blueprint nests it as
// `image:\n  url: ghcr.io/…`, so the line reads `url:`. Matching only the first left the
// blueprint silently unpinned — caught by this script's own per-file floor rather than by
// noticing later, which is the point of having one.
const IMAGE = /((?:image|url):\s*ghcr\.io\/proxlane\/gateway:)(\S+)/g;

const version = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { version?: string }).version;
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
	process.stderr.write(`apps/gateway/package.json has no usable version: ${String(version)}\n`);
	process.exit(1);
}

for (const rel of PINNED) {
	const file = join(ROOT, rel);
	const before = readFileSync(file, 'utf8');
	// Non-zero denominator, per file. A rename of the image would otherwise make this a silent
	// no-op, and the assertion it feeds would fail with no clue that its input stopped matching.
	IMAGE.lastIndex = 0;
	if (!IMAGE.test(before)) {
		process.stderr.write(`${rel} names no gateway image — this script stopped working\n`);
		process.exit(1);
	}
	IMAGE.lastIndex = 0;
	const after = before.replace(IMAGE, `$1${version}`);
	if (after === before) {
		process.stdout.write(`  ${rel} already pins gateway:${version}\n`);
	} else {
		writeFileSync(file, after);
		process.stdout.write(`  ${rel} now pins gateway:${version}\n`);
	}
}
