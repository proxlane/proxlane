// The request-body cap, and where it stops reading.
//
// `c.req.text()` resolves only once the entire body is in memory, so the old code measured the
// size afterwards and returned 413 having already paid the allocation the cap exists to prevent.
// The gateway's memory budget is `maxInflight * bodyCap * 2.5` (operations.md section 1), which
// assumes no single request exceeds the cap — and `@hono/node-server` imposes no limit of its
// own, so nothing upstream was helping.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFetchTransport } from './transport.js';

const HERE = dirname(fileURLToPath(import.meta.url));

import { readRequestBodyCapped } from './app.js';

/** A stream that reports how many chunks were actually pulled. */
function chunked(sizes: number[]): {
	stream: ReadableStream<Uint8Array>;
	pulled: () => number;
} {
	let pulled = 0;
	let i = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i >= sizes.length) {
				controller.close();
				return;
			}
			pulled += 1;
			controller.enqueue(new Uint8Array(sizes[i] as number).fill(97));
			i += 1;
		},
	});
	return { stream, pulled: () => pulled };
}

describe('a body within the cap is returned whole', () => {
	it('decodes exactly what was sent', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new TextEncoder().encode('hello '));
				c.enqueue(new TextEncoder().encode('world'));
				c.close();
			},
		});
		expect(await readRequestBodyCapped(stream, 1024)).toBe('hello world');
	});

	it('treats an absent body as empty, not as an error', async () => {
		expect(await readRequestBodyCapped(null, 1024)).toBe('');
	});

	it('accepts a body of exactly the cap', async () => {
		// The boundary in the permissive direction, so `>` cannot become `>=`.
		const { stream } = chunked([64]);
		expect(await readRequestBodyCapped(stream, 64)).toHaveLength(64);
	});
});

describe('an oversized body is refused without being read', () => {
	// THE ASSERTION THIS FILE EXISTS FOR. Not "does it return 413" — the old code did that too —
	// but "did it stop pulling", which is the whole difference.
	it('stops pulling once the cap is passed', async () => {
		const { stream, pulled } = chunked([64, 64, 64, 64, 64, 64, 64, 64]);
		expect(await readRequestBodyCapped(stream, 100)).toBe('too-large');
		// Two chunks reach 128 > 100. A reader that drained the stream would report 8.
		expect(pulled(), 'the whole body was read before refusing it').toBeLessThanOrEqual(2);
	});

	it('refuses one byte over the cap', async () => {
		const { stream } = chunked([65]);
		expect(await readRequestBodyCapped(stream, 64)).toBe('too-large');
	});

	it('counts bytes, not characters', async () => {
		// A multi-byte body would otherwise pass a length check and blow the cap: 40 characters
		// of a 3-byte codepoint is 120 bytes.
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new TextEncoder().encode('あ'.repeat(40)));
				c.close();
			},
		});
		expect(await readRequestBodyCapped(stream, 100)).toBe('too-large');
	});
});

describe('a client that hangs up stops the attempt', () => {
	// `c.req.raw.signal` existed and was read by nothing, so a caller that disconnected at 5s
	// left the chain walking every provider for the full deadline — 120s by default — paying
	// each hop and discarding the result. The in-flight slot was held for all of it, so the
	// gateway shed real traffic at `maxInflight` to protect a request nobody was waiting for.
	it('aborts the in-flight request when the caller goes away', async () => {
		const controller = new AbortController();
		let sawAbort = false;
		const transport = createFetchTransport();
		// A target that never answers. The only thing that can end this is an abort.
		const started = transport
			.execute(
				{
					url: 'http://127.0.0.1:9/never',
					method: 'GET',
					headers: {},
					timeoutMs: 60_000,
				},
				{ budgetMs: 60_000, maxBodyBytes: 1024, clientSignal: controller.signal },
			)
			.then((r) => {
				sawAbort = r.kind === 'client-gone';
				return r;
			});

		controller.abort();
		await started;
		// NOT `timeout`, which is what an abort used to surface as. A client hanging up filed as
		// PROVIDER_TIMEOUT would cool a provider that was answering perfectly well and feed the
		// health statistic a failure nobody caused — a worse bug than the one being fixed.
		expect(sawAbort, 'the caller hung up and it was not reported as client-gone').toBe(true);
	});

	it('removes its listener, so a long-lived signal does not accumulate one per attempt', () => {
		// Read from source: `removeEventListener` in the `finally` is what bounds the listener
		// count on a signal that outlives a single hop. A leak here is invisible until a
		// long-running client makes many attempts on one request.
		const src = readFileSync(join(HERE, 'transport.ts'), 'utf8');
		expect(src).toMatch(/removeEventListener\('abort', onClientGone\)/);
		expect(src).toMatch(/addEventListener\('abort', onClientGone, \{ once: true \}\)/);
	});
});
