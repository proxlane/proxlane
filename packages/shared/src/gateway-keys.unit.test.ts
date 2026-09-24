import { describe, expect, it } from 'vitest';
import {
	checkKeys,
	isPublishedKey,
	normalizeKey,
	PUBLISHED_KEYS,
	SHORT_KEY_WARNING_LENGTH,
} from './gateway-keys.js';

const GOOD = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

// Every assertion reads `ok` FIRST. An earlier version asserted inside `if (!r.ok)`, so a check
// that wrongly succeeded skipped its own assertion and passed.
function refused(r: ReturnType<typeof checkKeys>): string {
	expect(r.ok).toBe(false);
	return r.ok ? '' : r.message;
}
function started(r: ReturnType<typeof checkKeys>): string[] {
	expect(r.ok).toBe(true);
	return r.ok ? r.warnings : [];
}

describe('checkKeys: the live key', () => {
	it('refuses to start with no key', () => {
		expect(refused(checkKeys(undefined, undefined))).toContain('will not start without one');
	});

	it.each(['', '   ', '\r\n', '​', '""', "''"])('treats %j as no key at all', (key) => {
		// An empty configured key would equal the empty key a keyless request presents.
		expect(refused(checkKeys(key, undefined))).toContain('will not start without one');
	});

	it.each([...PUBLISHED_KEYS])('refuses the published key %s', (key) => {
		expect(refused(checkKeys(key, undefined))).toContain('published');
	});

	it.each([
		['case and whitespace', '  ChangeMe '],
		['a CRLF env file', 'changeme\r'],
		['a non-breaking space', ' changeme '],
		['a zero-width space', 'change​me'],
		['quotes kept by --env-file', '"changeme"'],
		['single quotes', "'changeme'"],
	])('refuses a published key despite %s', (_why, key) => {
		expect(refused(checkKeys(key, undefined))).toContain('published');
	});

	it('refuses the placeholders our own docs print', () => {
		for (const key of ['KEY', 'GATEWAY_KEY', 'GW_KEY']) {
			expect(refused(checkKeys(key, undefined))).toContain('published');
		}
	});

	it('never echoes the refused key', () => {
		expect(refused(checkKeys('manifest-check', undefined))).not.toContain('manifest-check');
	});

	it('starts with a good key and no warnings, and hands the key back', () => {
		const r = checkKeys(GOOD, undefined);
		expect(r).toEqual({ ok: true, apiKey: GOOD, warnings: [] });
	});

	it('warns about a short key but still starts, so an upgrade cannot stop a running box', () => {
		const warnings = started(checkKeys('x'.repeat(SHORT_KEY_WARNING_LENGTH - 1), undefined));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(`${SHORT_KEY_WARNING_LENGTH - 1} characters`);
		expect(started(checkKeys('x'.repeat(SHORT_KEY_WARNING_LENGTH), undefined))).toEqual([]);
	});
});

describe('checkKeys: the sandbox key', () => {
	it('refuses a sandbox key equal to the live key', () => {
		expect(refused(checkKeys(GOOD, GOOD))).toContain('PROXLANE_SANDBOX_KEY equals');
	});

	it('warns, but starts, when the sandbox key is a published value', () => {
		// It cannot spend, so no refusal; but on a reachable server anyone can use it to fill the
		// in-flight ceiling and shed live callers, which SECURITY.md describes.
		const warnings = started(checkKeys(GOOD, 'sandbox'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('GATEWAY_BUSY');
	});

	it('starts quietly with a private sandbox key', () => {
		expect(started(checkKeys(GOOD, OTHER))).toEqual([]);
	});
});

describe('the list', () => {
	it('stores every entry in the form it is compared in', () => {
		for (const k of PUBLISHED_KEYS) expect(k).toBe(normalizeKey(k));
	});

	it('matches only whole values, never a key that merely contains a listed word', () => {
		expect(isPublishedKey(`test-${GOOD}`)).toBe(false);
		expect(isPublishedKey(`${GOOD}secret`)).toBe(false);
	});
});
