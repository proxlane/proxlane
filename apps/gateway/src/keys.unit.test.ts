import { describe, expect, it } from 'vitest';
import { checkKeys, PUBLISHED_LIVE_KEYS, SHORT_KEY_WARNING_LENGTH } from './keys.js';

const GOOD = 'a'.repeat(64);

describe('checkKeys', () => {
	it('refuses to start with no key', () => {
		const r = checkKeys(undefined, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('will not start without one');
	});

	it.each([...PUBLISHED_LIVE_KEYS])('refuses the published key %s', (key) => {
		const r = checkKeys(key, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('published');
	});

	it('refuses a published key whatever its case or surrounding space', () => {
		expect(checkKeys('  ChangeMe ', undefined).ok).toBe(false);
	});

	it('never echoes the refused key', () => {
		const r = checkKeys('manifest-check', undefined);
		if (!r.ok) expect(r.message).not.toContain('manifest-check');
	});

	it('refuses a sandbox key equal to the live key', () => {
		const r = checkKeys(GOOD, GOOD);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('PROXLANE_SANDBOX_KEY equals');
	});

	it('lets a published value serve as the SANDBOX key, which cannot spend', () => {
		// The "Try it in 60 seconds" page prints `sandbox` as its sandbox key, on purpose.
		expect(checkKeys(GOOD, 'sandbox')).toEqual({ ok: true, apiKey: GOOD, warnings: [] });
	});

	it('starts with a good key and no warnings', () => {
		expect(checkKeys(GOOD, undefined)).toEqual({ ok: true, apiKey: GOOD, warnings: [] });
	});

	it('warns about a short key but still starts, so an upgrade cannot stop a running box', () => {
		const r = checkKeys('x'.repeat(SHORT_KEY_WARNING_LENGTH - 1), undefined);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.warnings).toHaveLength(1);
		const ok = checkKeys('x'.repeat(SHORT_KEY_WARNING_LENGTH), undefined);
		if (ok.ok) expect(ok.warnings).toHaveLength(0);
	});

	it('lists keys in the lowercase form it compares against', () => {
		for (const k of PUBLISHED_LIVE_KEYS) expect(k).toBe(k.trim().toLowerCase());
	});
});
