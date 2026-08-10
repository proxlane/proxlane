// parse() is pure, so it tests against bytes with nothing mocked.
//
// The case that earns most of this file: the service answers a FAILED fetch with HTTP 200
// and reports the target's status in the body. Reading the status alone records every dead
// target as a success, which is the failure proxlane exists to prevent.

import { describe, expect, it } from 'vitest';
import type { ProviderHttpResponse } from '../../contract.js';
import { JinaReaderAdapter } from './index.js';

const enc = new TextEncoder();

function res(
	status: number,
	body: string,
	ct = 'text/plain; charset=utf-8',
): ProviderHttpResponse {
	return { status, headers: { 'content-type': ct }, body: enc.encode(body) };
}

/** The real envelope shape, as recorded 2026-08-07. */
function envelope(url: string, warning?: string, content = 'Some page text.') {
	return [
		'Title: Example',
		'',
		`URL Source: ${url}`,
		...(warning === undefined ? [] : ['', `Warning: ${warning}`]),
		'',
		'Markdown Content:',
		content,
	].join('\n');
}

describe('jina-reader parse', () => {
	it('reads a clean 200 as OK', () => {
		const r = JinaReaderAdapter.parse(res(200, envelope('https://x.test/')));
		expect(r.outcome).toBe('OK');
		expect(r.upstreamStatusCode).toBe(200);
	});

	it('maps a 200 carrying an upstream 404 to TARGET_NOT_FOUND, not OK', () => {
		const r = JinaReaderAdapter.parse(
			res(200, envelope('https://x.test/', 'Target URL returned error 404: Not Found')),
		);
		expect(r.outcome).toBe('TARGET_NOT_FOUND');
		expect(r.upstreamStatusCode).toBe(404);
	});

	it('maps an upstream 5xx to TARGET_ERROR', () => {
		const r = JinaReaderAdapter.parse(
			res(
				200,
				envelope('https://x.test/', 'Target URL returned error 503: Service Unavailable'),
			),
		);
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.upstreamStatusCode).toBe(503);
	});

	it('treats an upstream 403 as a block, not as TARGET_FORBIDDEN', () => {
		// TARGET_FORBIDDEN means rejected at OUR edge — private range, denylist, metadata
		// address. Using it for a target's own 403 would make edge rejections unmeasurable.
		const r = JinaReaderAdapter.parse(
			res(200, envelope('https://x.test/', 'Target URL returned error 403: Forbidden')),
		);
		expect(r.outcome).toBe('HARD_BLOCK');
	});

	it('does NOT treat a Warning line inside the scraped page as a provider signal', () => {
		// The boundary that makes upstreamStatusFrom honest. A page whose own text contains
		// the warning string must parse as OK — otherwise any page quoting an error message
		// gets recorded as a dead target.
		const body = envelope(
			'https://x.test/',
			undefined,
			'Warning: Target URL returned error 404: Not Found\n\nis a line this article quotes.',
		);
		const r = JinaReaderAdapter.parse(res(200, body));
		expect(r.outcome).toBe('OK');
		expect(r.upstreamStatusCode).toBe(200);
	});

	it('hands back the original bytes, never a re-encoded string', () => {
		const body = enc.encode(envelope('https://x.test/'));
		const r = JinaReaderAdapter.parse({
			status: 200,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
			body,
		});
		expect(r.body).toBe(body);
	});

	it('carries the charset through from the header', () => {
		const r = JinaReaderAdapter.parse(
			res(200, envelope('https://x.test/'), 'text/plain; charset=Shift_JIS'),
		);
		expect(r.charset).toBe('Shift_JIS');
	});

	it('maps a 422 naming an unresolvable domain to TARGET_ERROR', () => {
		const body = JSON.stringify({
			data: null,
			path: 'url',
			code: 422,
			name: 'SubmittedDataMalformedError',
			status: 42203,
			message: "Domain 'nope.invalid' could not be resolved; check the URL",
		});
		expect(JinaReaderAdapter.parse(res(422, body, 'application/json')).outcome).toBe(
			'TARGET_ERROR',
		);
	});

	it('calls a 422 whose body is not their envelope PROVIDER_DRIFT', () => {
		// Recorded for real: a slow target produced `AssertionFailureError: Failed to goto…`
		// as plain text under a 422. Their documented error status carrying an undocumented
		// body is a contract break, and PROVIDER_DRIFT is the outcome that pages someone.
		const r = JinaReaderAdapter.parse(
			res(422, 'AssertionFailureError: Failed to goto https://x'),
		);
		expect(r.outcome).toBe('PROVIDER_DRIFT');
	});

	it('maps provider-level statuses without consulting the body', () => {
		expect(JinaReaderAdapter.parse(res(401, '')).outcome).toBe('AUTH_FAILED');
		expect(JinaReaderAdapter.parse(res(429, '')).outcome).toBe('RATE_LIMITED');
		expect(JinaReaderAdapter.parse(res(502, '')).outcome).toBe('PROVIDER_ERROR');
	});
});

describe('jina-reader translate', () => {
	const req = {
		url: 'https://x.test/a?b=c',
		method: 'GET' as const,
		renderJs: true,
		premium: 'none' as const,
		deadlineMs: 30_000,
	};

	it('puts the target URL in the path raw, query string intact', () => {
		expect(JinaReaderAdapter.translate(req, '').url).toBe(
			'https://r.jina.ai/https://x.test/a?b=c',
		);
	});

	it('sets every parameter explicitly, including the ones matching the default', () => {
		const w = JinaReaderAdapter.translate(req, '');
		expect(w.headers['x-respond-with']).toBe('markdown');
		expect(w.headers['x-no-cache']).toBe('true');
		expect(w.headers.accept).toBe('text/plain');
	});

	it('sends no authorization header when there is no key', () => {
		// An empty Bearer is a malformed request, not an anonymous one.
		expect(JinaReaderAdapter.translate(req, '').headers.authorization).toBeUndefined();
		expect(JinaReaderAdapter.translate(req, 'k').headers.authorization).toBe('Bearer k');
	});

	it('refuses POST rather than silently issuing a GET', () => {
		// Recording a GET under a fixture labelled POST is a fabrication with a plausible name.
		expect(() => JinaReaderAdapter.translate({ ...req, method: 'POST' }, '')).toThrow(/POST/);
	});
});
