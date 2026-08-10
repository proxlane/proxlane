// The changeset gate. It used to be `grep -qE '^(apps|packages)/'` inline in ci.yml, which
// demanded a changeset for changes to private packages — a file that cannot meaningfully be
// written, because changesets refuses to bump a private package.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { changesetRequired, publishableDirs } from './changeset-required.ts';

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

	it('still fires when a publishable change is mixed in with exempt ones', () => {
		const v = changesetRequired(
			['README.md', 'packages/cli/src/bin.ts', 'packages/cli/src/cli.unit.test.ts'],
			PUB,
		);
		expect(v.required).toBe(true);
		expect(v.touched).toEqual(['packages/cli/src/bin.ts']);
	});
});

describe('publishableDirs, read from the real workspace', () => {
	it('finds the publishable packages and excludes the private ones', () => {
		const dirs = publishableDirs(ROOT);
		expect(dirs.length).toBeGreaterThan(0);
		expect(dirs).toContain('packages/adapters');
		expect(dirs).toContain('packages/cli');
		// The two apps are private and must never appear, or the gate reverts to demanding
		// changesets nobody can write.
		expect(dirs).not.toContain('apps/gateway');
		expect(dirs).not.toContain('apps/web');
	});
});
