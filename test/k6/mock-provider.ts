// A provider that misbehaves on request, so the soak can measure the gateway and not a vendor.
//
// `operations.md` section 9 asks for exactly this: "k6 scenarios against a local mock provider
// that can simulate slow responses, 429s, and huge bodies." Every word of that is load-bearing.
//
// WHY NOT REAL PROVIDERS. Three reasons, and the first two are the ones that matter:
//
//   1. The gate is p95 of GATEWAY-INTERNAL time. Real providers add hundreds of milliseconds
//      of variance that the metric explicitly subtracts, so they cannot improve the
//      measurement — they can only make the run flaky and expensive.
//   2. A 50-VU 30-minute soak is tens of thousands of requests. Pointed at three commercial
//      APIs that is real money and, worse, load against partners whose affiliate terms this
//      project depends on.
//   3. Failure modes have to be ON DEMAND. Waiting for a provider to organically return a 429
//      or a 40 MB body is not a test, it is a vigil.
//
// The mock is deliberately dumb: a switch on the target URL's path decides the behaviour, so a
// k6 scenario picks its failure mode by choosing a URL.
//
// NOT A FIXTURE, and the distinction matters because the house rule says fixtures are never
// hand-written. A fixture is recorded provider traffic replayed by the conformance suite, and
// fabricating one would make a contract test assert against fiction. This is a synthetic
// upstream for a load test: nothing here is claimed to be a recording, and no conformance
// test reads it. What it does borrow from reality is the block-page signature below, because
// a mock that the real detector ignores would measure the wrong code path.

import { createServer, type Server } from 'node:http';

export interface MockOptions {
	readonly port?: number;
	/** Bytes returned by `/huge`. Default is over the gateway's 10 MB cap, on purpose. */
	readonly hugeBytes?: number;
	/** Milliseconds `/slow` waits before answering. */
	readonly slowMs?: number;
}

export interface MockHandle {
	readonly port: number;
	readonly counts: Readonly<Record<string, number>>;
	close: () => Promise<void>;
}

/** A page big enough to be worth buffering, small enough to be cheap to build. */
const OK_BODY = Buffer.from(
	`<!doctype html><html><head><title>mock target</title></head><body>${'content '.repeat(400)}</body></html>`,
);

/**
 * A challenge page the detector should recognise as a soft block.
 *
 * HTTP 200 with a body, which is the whole reason the detector reads bodies. If the soak only
 * ever saw honest status codes it would never exercise the detection path, and detection is
 * the most expensive per-request work the gateway does — precisely what a latency gate needs
 * to include.
 */
const BLOCK_BODY = Buffer.from(
	'<!doctype html><html><head><title>Just a moment...</title></head><body>' +
		'<div id="challenge-running">Checking your browser before accessing the site.</div>' +
		// THE REAL SIGNATURE the `cloudflare-challenge` rule matches. The first version invented
		// a plausible-looking marker, the detector correctly ignored it, and the soak reported
		// every blocked request as OK — a load test that exercised none of the detection path
		// while appearing to.
		'<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' +
		'</body></html>',
);

export function startMockProvider(options: MockOptions = {}): Promise<MockHandle> {
	const hugeBytes = options.hugeBytes ?? 12 * 1024 * 1024;
	const slowMs = options.slowMs ?? 1500;
	const counts: Record<string, number> = {};
	// Built once. Allocating twelve megabytes per request would measure the mock's allocator
	// rather than the gateway, and would dominate the RSS trend the soak watches.
	const huge = Buffer.alloc(hugeBytes, 0x61);

	const server: Server = createServer((req, res) => {
		// The gateway sends the target as a query parameter, the way every provider's API does.
		const url = new URL(req.url ?? '/', 'http://mock.invalid');
		const target = url.searchParams.get('url') ?? '';
		const mode = new URL(target, 'http://target.invalid').pathname.replace(/^\//, '') || 'ok';
		counts[mode] = (counts[mode] ?? 0) + 1;

		const send = (status: number, body: Buffer, headers: Record<string, string> = {}) => {
			res.writeHead(status, {
				'content-type': 'text/html; charset=utf-8',
				'content-length': String(body.byteLength),
				...headers,
			});
			res.end(body);
		};

		switch (mode) {
			case 'slow':
				// Held open, not busy-waited: the point is a slow UPSTREAM, and burning a CPU here
				// would starve the gateway process the run is measuring.
				setTimeout(() => send(200, OK_BODY), slowMs).unref();
				return;
			case 'ratelimited':
				send(429, Buffer.from('{"error":"rate limited"}'), {
					'content-type': 'application/json',
					'retry-after': '2',
				});
				return;
			case 'huge':
				send(200, huge);
				return;
			case 'blocked':
				// 200, with a challenge page. The detector's job.
				send(200, BLOCK_BODY);
				return;
			case 'error':
				send(500, Buffer.from('upstream exploded'));
				return;
			case 'notfound':
				send(404, Buffer.from('no such page'));
				return;
			default:
				send(200, OK_BODY);
		}
	});

	// Nagle adds up to 40 ms to small responses, which would land squarely in the p95 the gate
	// reads and would be the mock's fault, not the gateway's.
	server.on('connection', (socket) => socket.setNoDelay(true));

	return new Promise((resolve) => {
		server.listen(options.port ?? 0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			resolve({
				port,
				get counts() {
					return { ...counts };
				},
				close: () =>
					new Promise<void>((done) => {
						server.closeAllConnections();
						server.close(() => done());
					}),
			});
		});
	});
}
