// The changeset gate.
//
// It started as `grep -qE '^(apps|packages)/'` inline in ci.yml, demanding a changeset for
// private packages that Changesets refused to bump — a file that cannot be written. It was
// narrowed to publishable packages, which went too far the other way: `apps/gateway` is what
// self-hosters run, and gateway-only work then needed no changeset at all. Ten of them named
// `@proxlane/shared` instead, describing a package that mostly had not changed, because it
// was the only way to leave a record.
//
// `privatePackages: { version: true, tag: false }` versions private packages without ever
// publishing them, so the gate now asks about VERSIONED packages — and reads the config to
// decide, so turning that setting off narrows it back rather than breaking it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changesetRequired, versionedDirs } from './changeset-required.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = ['packages/adapters', 'packages/cli'];

describe('what actually requires a changeset', () => {
	it('does when a publishable package changes', () => {
		const v = changesetRequired(['packages/adapters/src/index.ts'], PUB);
		expect(v.required).toBe(true);
		expect(v.touched).toEqual(['packages/adapters/src/index.ts']);
	});

	it('does NOT when only a private package changes', () => {
		// The bug this replaced. apps/gateway is private:true — there is no version to bump
		// and no consumer to inform, so the gate demanded a file that could not be written.
		expect(changesetRequired(['apps/gateway/src/app.ts'], PUB).required).toBe(false);
	});

	it('does NOT for docs, CI or scripts', () => {
		expect(
			changesetRequired(['README.md', '.github/workflows/ci.yml', 'scripts/check.ts'], PUB)
				.required,
		).toBe(false);
	});

	it('does NOT for a test-only change inside a publishable package', () => {
		// Requiring one here trains people to write empty changesets, which is worse than
		// not asking.
		expect(
			changesetRequired(['packages/adapters/src/scraperapi/index.unit.test.ts'], PUB).required,
		).toBe(false);
	});

	it('does NOT for re-recorded fixtures', () => {
		// A recording is not our behaviour changing; it is the provider's, captured.
		expect(
			changesetRequired(['packages/adapters/src/scraperapi/fixtures/success-html.json'], PUB)
				.required,
		).toBe(false);
	});

	it('does NOT for a captured corpus file', () => {
		// Same class as a fixture: a recording, not our behaviour, and it does not ship —
		// `files` is a dist-only allowlist. This exemption was missing and the gate fired.
		expect(
			changesetRequired(['packages/detect/corpus/bespoke-block.json'], ['packages/detect'])
				.required,
		).toBe(false);
	});

	it('still fires when a publishable change is mixed in with exempt ones', () => {
		const v = changesetRequired(
			['README.md', 'packages/cli/src/bin.ts', 'packages/cli/src/cli.unit.test.ts'],
			PUB,
		);
		expect(v.required).toBe(true);
		expect(v.touched).toEqual(['packages/cli/src/bin.ts']);
	});
});

describe('versionedDirs, read from the real workspace', () => {
	it('includes the private apps, because Changesets now versions them', () => {
		// `.changeset/config.json` sets `privatePackages: { version: true, tag: false }`, so a
		// private package gets a version bump and a CHANGELOG without ever being published.
		//
		// It did not, and the cost was ten changesets naming `@proxlane/shared` for work that
		// happened entirely in `apps/gateway` — the only way to leave a record when the package
		// that actually changed could not be named. The gateway is what self-hosters run; its
		// behaviour changes are exactly what they need to read.
		const dirs = versionedDirs(ROOT);
		expect(dirs.length).toBeGreaterThan(0);
		expect(dirs).toContain('packages/adapters');
		expect(dirs).toContain('packages/cli');
		expect(dirs).toContain('apps/gateway');
	});

	it('narrows back to publishable packages if privatePackages.version is turned off', () => {
		// The gate reads the config rather than assuming it. Turning the setting off must
		// restore the old behaviour, not leave the gate demanding changesets nothing can bump —
		// which is the failure the narrowing was introduced to fix in the first place.
		const tmp = mkdtempSync(join(tmpdir(), 'proxlane-cs-'));
		mkdirSync(join(tmp, '.changeset'), { recursive: true });
		writeFileSync(
			join(tmp, '.changeset/config.json'),
			JSON.stringify({ privatePackages: { version: false, tag: false } }),
		);
		for (const [dir, priv] of [
			['packages/pub', false],
			['apps/priv', true],
		] as const) {
			mkdirSync(join(tmp, dir), { recursive: true });
			writeFileSync(
				join(tmp, dir, 'package.json'),
				JSON.stringify({ name: `@x/${dir}`, ...(priv ? { private: true } : {}) }),
			);
		}
		const dirs = versionedDirs(tmp);
		expect(dirs).toContain('packages/pub');
		expect(dirs).not.toContain('apps/priv');
		rmSync(tmp, { recursive: true, force: true });
	});

	it('treats a missing config as publishable-only, rather than assuming', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'proxlane-cs-'));
		mkdirSync(join(tmp, 'apps/priv'), { recursive: true });
		writeFileSync(
			join(tmp, 'apps/priv/package.json'),
			JSON.stringify({ name: '@x/priv', private: true }),
		);
		expect(versionedDirs(tmp)).not.toContain('apps/priv');
		rmSync(tmp, { recursive: true, force: true });
	});
});
