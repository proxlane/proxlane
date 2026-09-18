import { carriesBody, FAILOVER, type GatewayRequest, OUTCOMES } from '@proxlane/adapters';
import { RULES } from '@proxlane/detect';
import { describe, expect, it } from 'vitest';
import { parseSimulate, simulate } from './simulate.js';

const REQ: GatewayRequest = {
	// A query string with `&`, so the page has something to escape once the guard has
	// normalised the URL — it percent-encodes `<` before the body ever sees it.
	url: 'https://example.com/?a=1&b=<x>',
	method: 'GET',
	renderJs: false,
	premium: 'none',
	deadlineMs: 30_000,
};
const IDS = ['scraperapi', 'scrapingbee', 'scrapfly'];

describe('parseSimulate', () => {
	it('defaults to OK, so a sandbox key alone shows the happy path', () => {
		expect(parseSimulate(undefined)).toEqual({ outcome: 'OK' });
		expect(parseSimulate('')).toEqual({ outcome: 'OK' });
	});

	it('accepts every outcome in the taxonomy and nothing else', () => {
		for (const o of OUTCOMES) expect(parseSimulate(o)).toEqual({ outcome: o });
		// One spelling. The header is a machine value, and the docs list exactly one form.
		expect(parseSimulate('soft_block')).toHaveProperty('error');
		expect(parseSimulate('BLOCKED')).toHaveProperty('error');
	});
});

describe('simulate derives everything from FAILOVER', () => {
	// The whole reason this feature is permitted: no second table. Walk the real one.
	it.each(OUTCOMES)('%s: attempts follow the failover policy', (outcome) => {
		const r = simulate(outcome, IDS, REQ);
		const policy = FAILOVER[outcome];
		const expected = policy.failover === true ? IDS.length : policy.failover === 'once' ? 2 : 1;
		expect(r.outcome).toBe(outcome);
		expect(r.attempts).toHaveLength(expected);
		expect(r.attempts.map((a) => a.provider)).toEqual(IDS.slice(0, expected));
		for (const a of r.attempts) {
			expect(a.outcome).toBe(outcome);
			// Nothing upstream happened, so nothing is attributed upstream.
			expect(a.upstreamMs).toBe(0);
		}
	});

	it.each(OUTCOMES)('%s: a body only where the real chain would pass one', (outcome) => {
		const r = simulate(outcome, IDS, REQ);
		expect(r.result !== undefined).toBe(carriesBody(outcome));
		if (r.result !== undefined) {
			const text = new TextDecoder().decode(r.result.body);
			// Says what it is in the first heading, and escapes the guard-normalised URL.
			expect(text).toContain(`Simulated ${outcome}`);
			expect(text).toContain('example.com/?a=1&#38;b=%3Cx%3E');
			expect(text).not.toContain('a=1&b=');
			expect(r.result.cost.microcredits).toBe(0);
		}
	});

	it('names the provider as `sandbox` when none is configured', () => {
		const r = simulate('OK', [], REQ);
		expect(r.provider).toBe('sandbox');
		expect(r.attempts).toHaveLength(1);
	});

	it('attaches a rule id that exists to a SOFT_BLOCK, like the real chain', () => {
		const r = simulate('SOFT_BLOCK', IDS, REQ);
		expect(r.detectRuleId).toBe(RULES[0]?.id);
		expect(RULES.some((rule) => rule.id === r.detectRuleId)).toBe(true);
		expect(simulate('OK', IDS, REQ).detectRuleId).toBeUndefined();
	});

	it('gives a simulated OK an upstream 200, so the status resolves', () => {
		expect(simulate('OK', IDS, REQ).result?.upstreamStatusCode).toBe(200);
		expect(simulate('TARGET_NOT_FOUND', IDS, REQ).result?.upstreamStatusCode).toBeUndefined();
	});
});

describe('the edge guard runs inside simulate, so no caller can skip it', () => {
	it('refuses a metadata address exactly as the live chain does', () => {
		const r = simulate('OK', IDS, { ...REQ, url: 'http://169.254.169.254/latest/meta-data/' });
		expect(r.outcome).toBe('TARGET_FORBIDDEN');
		expect(r.attempts).toHaveLength(0);
		expect(r.result).toBeUndefined();
	});

	it('reflects the URL the guard judged, not the string the caller sent', () => {
		// `\` ends the authority in WHATWG parsing, so the guard sees example.com; a page that
		// echoed the raw string would show a caller a URL the guard never approved.
		const r = simulate('OK', IDS, { ...REQ, url: 'http://example.com\\@169.254.169.254/' });
		expect(r.outcome).toBe('OK');
		const text = new TextDecoder().decode(r.result?.body);
		// The backslash is gone and the authority is example.com: what the guard approved.
		expect(text).toContain('<code>http://example.com/@169.254.169.254/</code>');
		expect(text).not.toContain('\\');
	});
});
