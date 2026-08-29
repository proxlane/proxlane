// The caller's signal, and the listener it must not leak.
//
// Moved here with the transport itself. It used to sit in the gateway's `body-cap` test, which
// was accurate when the gateway owned the only executor — it does not any more, and a test of
// shared code living in an app is how a package ships untested.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFetchTransport } from './transport.js';

const HERE = dirname(fileURLToPath(import.meta.url));

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
