// parse() against the REAL recorded bytes, and against two shapes no fixture holds.
//
// THE FOURTH ADAPTER WAS THE ONLY ONE WITHOUT A UNIT TEST FILE, which is how both bugs below
// survived: conformance replays a fixture per category and asserts the outcome, so it saw the
// outcomes and never the body, while the one check that should have seen the body carried
// `&& result.outcome === 'OK'` on the end of its condition and only ever enforced the case that
// was already right.
//
// Do not hand-edit a fixture to make a test pass — re-record it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Outcome, ProviderHttpResponse } from '../contract.js';
import { carriesBody } from '../contract.js';
import { BrightdataAdapter } from './index.js';
import { BRD_ERROR_HEADER, BRD_REFUSAL_CODE_HEADER, BRD_STATUS_HEADER } from './schema.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function load(category: string): ProviderHttpResponse {
	const f = JSON.parse(readFileSync(join(FIXTURES, `${category}.json`), 'utf8')) as {
		kind: string;
		response?: { status: number; headers: Record<string, string>; bodyBase64: string };
	};
	if (f.kind !== 'exchange' || !f.response) throw new Error(`${category} is not an exchange`);
	return {
		status: f.response.status,
		headers: f.response.headers,
		body: new Uint8Array(Buffer.from(f.response.bodyBase64, 'base64')),
	};
}

describe('an outcome that carries a body carries the body', () => {
	// SEVEN OF EIGHT RETURN SITES FORGOT. Only the OK path attached `res.body`, so a target 404,
	// a 429 and every hard block came back empty from Bright Data while the other three adapters
	// returned the target's real page. "Drop-in replacement" depended on which provider won.
	const cases: ReadonlyArray<[string, Outcome]> = [
		['success-html', 'OK'],
		['success-json', 'OK'],
		['target-not-found', 'TARGET_NOT_FOUND'],
		['target-rate-limited', 'TARGET_RATE_LIMITED'],
	];

	it('has a non-OK carrier with real bytes to lose', () => {
		// NON-ZERO DENOMINATOR WITH TEETH. "Body is defined" is satisfied by a zero-length
		// array, and `target-rate-limited` genuinely is one — Bright Data rejects a 429 and
		// sends nothing. If that were the only non-OK carrier here, the whole suite would pass
		// against an adapter that still dropped every real page. `target-not-found` carries the
		// target's actual 404, 185 KB of it, and that is the byte count being protected.
		const substantive = cases
			.filter(([, o]) => carriesBody(o) && o !== 'OK')
			.filter(([c]) => load(c).body.byteLength > 0);
		expect(substantive.length, 'no non-OK carrier has a real body to preserve').toBeGreaterThan(
			0,
		);
	});

	for (const [category, outcome] of cases) {
		it(`${category} parses to ${outcome} and passes the bytes through unchanged`, () => {
			const res = load(category);
			const parsed = BrightdataAdapter.parse(res);
			expect(parsed.outcome).toBe(outcome);
			expect(carriesBody(parsed.outcome), 'the taxonomy disagrees with this case').toBe(true);
			expect(parsed.body, `${outcome} arrived with no body`).toBeDefined();
			// The exact bytes, not merely some bytes. Raw mode's whole point is no decode and no
			// re-encode, so a JPEG survives and the detector fingerprints what the target sent.
			expect(parsed.body).toEqual(res.body);
		});
	}

	it('does NOT attach a body to an outcome that must not carry one', () => {
		// The other direction, so the fix is "ask carriesBody" rather than "always attach".
		const parsed = BrightdataAdapter.parse(load('target-error'));
		expect(carriesBody(parsed.outcome)).toBe(false);
		expect(parsed.body).toBeUndefined();
	});
});

describe('an error code is an error whether or not it came with a message', () => {
	// `if (code !== undefined && message !== undefined)` gated the whole error section on BOTH
	// headers. Bright Data sends `x-brd-error-code` without `x-brd-error` and the response fell
	// past every branch, past the status section, and out of the bottom as OK carrying the body
	// — a captcha page returned to the caller as a successful scrape, by the adapter, which is
	// the exact failure the detector exists to prevent.
	const withHeaders = (headers: Record<string, string>): ProviderHttpResponse => ({
		status: 200,
		headers: { 'content-type': 'text/html', ...headers },
		body: new Uint8Array(Buffer.from('<html>challenge</html>', 'utf8')),
	});

	it('reads reject_block as a hard block with no message header present', () => {
		const parsed = BrightdataAdapter.parse(
			withHeaders({ [BRD_ERROR_HEADER]: 'reject_block', [BRD_STATUS_HEADER]: '200' }),
		);
		expect(parsed.outcome).toBe('HARD_BLOCK');
		expect(parsed.body, 'HARD_BLOCK carries the body, per carriesBody()').toBeDefined();
	});

	it('reads an unrecognised code as a provider failure, not as content', () => {
		const parsed = BrightdataAdapter.parse(
			withHeaders({ [BRD_ERROR_HEADER]: 'some_new_code', [BRD_STATUS_HEADER]: '200' }),
		);
		expect(parsed.outcome).toBe('PROVIDER_ERROR');
	});

	it('still reads a clean 200 with no error code as content', () => {
		// The control. Without it the two cases above are satisfied by returning PROVIDER_ERROR
		// for everything, which would be a worse bug than the one being fixed.
		const parsed = BrightdataAdapter.parse(withHeaders({ [BRD_STATUS_HEADER]: '200' }));
		expect(parsed.outcome).toBe('OK');
		expect(parsed.body).toBeDefined();
	});
});

describe('a refused account is an account fault, not an empty page', () => {
	// Recorded 2026-09-28 from a suspended account: 200, an empty body, `x-brd-status-code: 407`,
	// and the refusal in `x-brd-err-code`, a header family this adapter did not read. It parsed
	// as OK, the chain turned the empty OK into SOFT_BLOCK, and every domain a caller touched
	// cooled Bright Data as though that site had blocked it.
	const suspended = load('auth-failed');

	it('parses the recorded suspension as AUTH_FAILED', () => {
		expect(BrightdataAdapter.parse(suspended).outcome).toBe('AUTH_FAILED');
	});

	it("carries Bright Data's own words, since AUTH_FAILED alone reads as a wrong key", () => {
		expect(BrightdataAdapter.parse(suspended).providerMessage).toMatch(/Account is suspended/);
	});

	it('bills nothing for a request that never reached a target', () => {
		expect(BrightdataAdapter.parse(suspended).cost.microcredits).toBe(0);
	});

	// A TARGET MAY BE ABLE TO SEND THESE HEADERS. Raw mode forwards the target's own, and nobody
	// has shown Bright Data strips `x-brd-err-*` from them. So AUTH_FAILED, which cools the whole
	// account, needs the full recorded shape; each case below is the recording with one part of
	// that shape removed, and each must be read as the response it otherwise is.
	it('ignores the refusal code without the 407', () => {
		const headers = { ...suspended.headers, [BRD_STATUS_HEADER]: '200' };
		expect(BrightdataAdapter.parse({ ...suspended, headers }).outcome).not.toBe('AUTH_FAILED');
	});

	it('ignores the refusal code when a body came back', () => {
		const body = new Uint8Array(Buffer.from('<html>a page</html>', 'utf8'));
		expect(BrightdataAdapter.parse({ ...suspended, body }).outcome).not.toBe('AUTH_FAILED');
	});

	it('ignores a code that is not one of the superproxy client codes', () => {
		const headers = { ...suspended.headers, [BRD_REFUSAL_CODE_HEADER]: 'unknown_20000' };
		const parsed = BrightdataAdapter.parse({ ...suspended, headers });
		expect(parsed.outcome).not.toBe('AUTH_FAILED');
		expect(parsed.providerMessage).toBeUndefined();
	});

	it('reads a forged code on a real page as the real page', () => {
		// The attack in one line: a site answering 200 with content and `x-brd-err-code`.
		const page = load('success-html');
		const headers = { ...page.headers, [BRD_REFUSAL_CODE_HEADER]: 'client_10020' };
		expect(BrightdataAdapter.parse({ ...page, headers }).outcome).toBe('OK');
	});

	it('the old header family still decides everything it decided before', () => {
		// The control: a response with no refusal header parses exactly as it did.
		expect(BrightdataAdapter.parse(load('success-html')).outcome).toBe('OK');
		expect(BrightdataAdapter.parse(load('dead-host')).outcome).toBe('TARGET_ERROR');
	});
});
