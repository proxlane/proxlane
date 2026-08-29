// The REAL transport, against a real socket. `pnpm test:e2e`.
//
// This is the one file that exercises `createFetchTransport`. Everything else in the suite
// runs against the replay transport, which is correct — the provider boundary must be
// recorded bytes, not invention — but it means the code that actually opens connections had
// no automated coverage at all. Before this, `createFetchTransport` was referenced by exactly
// three files: itself, `index.ts`, and the k6 harness. None of them run on a pull request.
//
// That matters more here than in most projects. `plan.md` section 3's stated reason for
// choosing Node over Bun is undici's per-origin pools with explicit `headersTimeout` and
// `bodyTimeout`, and the transport's own comment records a bug found by hand: a trickling
// body ran 12,730 ms against a 2,000 ms budget, because `fetch()` resolves when HEADERS
// arrive and the timer had been cleared there. Nothing would have caught its return.
//
// The server below is deliberately hostile in the specific ways a provider is: it stalls
// after headers, it sends more than it promised, it never answers at all.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetchTransport } from './transport.js';

let server: Server;
let base: string;

/** Handles that must be released even when a test fails, or the suite hangs on exit. */
const openTimers: ReturnType<typeof setInterval>[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		const path = (req.url ?? '/').split('?')[0];
		switch (path) {
			case '/ok':
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-mock': 'yes' });
				res.end('<html>hello</html>');
				return;

			case '/trickle': {
				// THE 12,730 ms BUG, reproduced. Headers arrive at once and the body dribbles out
				// forever. A budget enforced only around `fetch()` is already satisfied here.
				res.writeHead(200, { 'content-type': 'text/html' });
				res.write('<html>');
				const timer = setInterval(() => res.write('.'), 50);
				openTimers.push(timer);
				return;
			}

			case '/silent':
				// Accepts the connection and never responds. The budget is the only thing that
				// ends this.
				return;

			case '/huge': {
				// No content-length, streamed. The cap has to trip mid-stream rather than after
				// buffering, which is the whole point of reading with a ceiling.
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				const chunk = Buffer.alloc(64 * 1024, 0x61);
				for (let i = 0; i < 200; i++) res.write(chunk);
				res.end();
				return;
			}

			case '/status':
				res.writeHead(503, { 'retry-after': '7' });
				res.end('unavailable');
				return;

			case '/echo': {
				let body = '';
				req.on('data', (d) => {
					body += d;
				});
				req.on('end', () => {
					res.writeHead(200, { 'content-type': 'text/plain' });
					res.end(`${req.method}:${body}`);
				});
				return;
			}

			default:
				res.writeHead(404);
				res.end('nope');
		}
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	for (const t of openTimers) clearInterval(t);
	server.closeAllConnections();
	await new Promise<void>((r) => server.close(() => r()));
});

const transport = createFetchTransport();
const run = (path: string, opts: { budgetMs?: number; maxBodyBytes?: number } = {}) =>
	transport.execute(
		{ url: `${base}${path}`, method: 'GET', headers: {}, timeoutMs: 0 },
		{ budgetMs: opts.budgetMs ?? 5_000, maxBodyBytes: opts.maxBodyBytes ?? 1024 * 1024 },
	);

describe('the real transport', () => {
	it('returns status, headers and raw bytes', async () => {
		const res = await run('/ok');
		expect(res.kind).toBe('response');
		if (res.kind !== 'response') return;
		expect(res.response.status).toBe(200);
		expect(res.response.headers['x-mock']).toBe('yes');
		// BYTES, not a string. `/detect` fingerprints the page before charset decoding, so
		// anything that hands it text has already destroyed the evidence.
		expect(res.response.body).toBeInstanceOf(Uint8Array);
		expect(Buffer.from(res.response.body).toString()).toBe('<html>hello</html>');
		expect(res.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('bounds a body that trickles after the headers arrive', async () => {
		// THE REGRESSION TEST FOR THE MEASURED BUG. `fetch()` resolves the moment headers land,
		// so a timer cleared there leaves the body read unbounded. If someone moves the
		// `clearTimeout` out of `finally` and onto the fetch promise, this is what fails.
		const started = Date.now();
		const res = await run('/trickle', { budgetMs: 400 });
		const elapsed = Date.now() - started;
		expect(res.kind).toBe('timeout');
		// Generous, because CI is slow — but an order of magnitude under the failure it guards,
		// which ran 6x its budget.
		expect(elapsed).toBeLessThan(4_000);
	});

	it('times out a server that never answers', async () => {
		const res = await run('/silent', { budgetMs: 300 });
		expect(res.kind).toBe('timeout');
		if (res.kind !== 'timeout') return;
		expect(res.afterMs).toBeGreaterThanOrEqual(150);
	});

	it('trips the body cap mid-stream rather than after buffering', async () => {
		// The server sends 12 MB with no content-length. Buffering first would allocate all of
		// it before objecting, which is the failure the ceiling exists to prevent.
		const res = await run('/huge', { maxBodyBytes: 256 * 1024 });
		expect(res.kind).toBe('too-large');
		if (res.kind !== 'too-large') return;
		expect(res.cap).toBe(256 * 1024);
	});

	it('passes an upstream error status through instead of throwing', async () => {
		// A 503 from a provider is data the chain routes on, not an exception.
		const res = await run('/status');
		expect(res.kind).toBe('response');
		if (res.kind !== 'response') return;
		expect(res.response.status).toBe(503);
		expect(res.response.headers['retry-after']).toBe('7');
	});

	it('reports a connection failure as an error, not a timeout', async () => {
		// DISCRIMINATED ON THE SIGNAL, not the message. Node words an abort as "This operation
		// was aborted", so message-matching would mislabel the first DNS or refusal whose text
		// happens to contain it. Port 1 on loopback refuses immediately.
		const res = await transport.execute(
			{ url: 'http://127.0.0.1:1/', method: 'GET', headers: {}, timeoutMs: 0 },
			{ budgetMs: 5_000, maxBodyBytes: 1024 },
		);
		expect(res.kind).toBe('error');
	});

	it('forwards a POST body verbatim', async () => {
		const res = await transport.execute(
			{
				url: `${base}/echo`,
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"q":"example"}',
				timeoutMs: 0,
			},
			{ budgetMs: 5_000, maxBodyBytes: 1024 * 1024 },
		);
		expect(res.kind).toBe('response');
		if (res.kind !== 'response') return;
		expect(Buffer.from(res.response.body).toString()).toBe('POST:{"q":"example"}');
	});

	it('does not leave the budget timer holding the process open', async () => {
		// `clearTimeout` in `finally` is what makes this true. Without it a fast response still
		// leaves a pending timer, and a gateway that answers quickly takes its budget to shut
		// down — up to 75 seconds on a terminal hop.
		const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
		await run('/ok');
		const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
		expect(after).toBeLessThanOrEqual(before);
	});
});
