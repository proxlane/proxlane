// EVERY ADAPTER'S REQUEST REACHES THE WIRE INTACT — method, headers and body.
//
// This exists because it did not, for months, on the one adapter it could affect.
//
// `translate` is pure and returns a `ProviderHttpRequest`. Four places in the repo took one
// and sent it, each with its own hand-rolled `fetch`. Three spread `wire.body`; the live
// canary did not. Bright Data is the only adapter that POSTs a JSON payload — the other
// three carry every parameter in the query string — so it alone received a request whose
// body was silently dropped. `api.brightdata.com/request` answered `400 "zone" is required`,
// `parse` mapped 400 to AUTH_FAILED, and the canary reported a dead credential for a key
// that worked. It did that on every run for as long as a key was in the environment, so the
// launch gate in `operations.md` section 9 had never once measured that provider.
//
// The behaviour was already tested. `transport.e2e.test.ts` has "forwards a POST body
// verbatim" and has had it all along. What was missing is this: an assertion that the
// adapters' requests actually GO through the thing that test covers. A unit test of the
// executor cannot catch a caller that does not call it.
//
// So this asserts the join rather than either side. It runs the real transport against a
// local server and compares what arrived with what `translate` produced, for every adapter
// in the registry — including the ones that POST nothing, because "this adapter has no body
// to lose" is a fact worth pinning rather than assuming.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFetchTransport, DEFAULT_BODY_CAP_BYTES } from '@proxlane/shared/transport';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Adapter, type GatewayRequest, REGISTRY } from './index.js';

interface Seen {
	method: string;
	headers: Record<string, string>;
	body: string;
}

let server: Server;
let origin: string;
let seen: Seen | undefined;

/**
 * What the server received, consumed once.
 *
 * A function rather than a cast: assigning `seen = undefined` before each attempt narrows the
 * variable to `undefined` for the rest of the block, so reading it directly needs an `as` that
 * would also hide a genuinely missing request.
 */
function received(): Seen {
	if (seen === undefined) throw new Error('nothing reached the server');
	const taken = seen;
	seen = undefined;
	return taken;
}

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			seen = {
				method: req.method ?? '',
				headers: Object.fromEntries(
					Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')]),
				) as Record<string, string>,
				body: Buffer.concat(chunks).toString('utf8'),
			};
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end('<html>ok</html>');
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((r) => server.close(() => r()));
});

const req: GatewayRequest = {
	url: 'https://example.com/target?a=1',
	method: 'GET',
	renderJs: true,
	premium: 'none',
	deadlineMs: 30_000,
};

const ids = Object.keys(REGISTRY);

describe('the executor transmits what translate built', () => {
	it('has adapters to check', () => {
		expect(ids.length).toBeGreaterThan(0);
	});

	it.each(ids)('%s', async (id) => {
		const adapter: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
		// A key shaped like Bright Data's `<zone>:<token>`, which every other adapter treats
		// as an opaque string. A bare token would send Bright Data an empty zone and test a
		// request no caller makes.
		const wire = adapter.translate(req, 'zone:CONTRACT_KEY');
		seen = undefined;

		// Redirected at the local server, keeping everything else the adapter decided. The
		// point is what crosses the wire, not which host it crosses to.
		const target = new URL(wire.url);
		const local = `${origin}${target.pathname}${target.search}`;
		await createFetchTransport().execute(
			{ ...wire, url: local },
			{ budgetMs: 10_000, maxBodyBytes: DEFAULT_BODY_CAP_BYTES },
		);

		expect(seen, `${id}: nothing reached the server`).toBeDefined();
		const got = received();

		expect(got.method, `${id}: method`).toBe(wire.method);

		// Every header the adapter set arrived with the value it set. Node adds its own
		// (host, connection, accept-*), so this is one-directional by design.
		for (const [k, v] of Object.entries(wire.headers)) {
			expect(got.headers[k.toLowerCase()], `${id}: header ${k}`).toBe(v);
		}

		// THE ONE THAT WAS BROKEN. Byte-identical, and an absent body must arrive absent —
		// "no body" and "an empty body" are different requests, and an adapter that declares
		// GET must not start sending an empty payload because a test was lenient.
		expect(got.body, `${id}: body`).toBe(wire.body ?? '');
	});

	it('at least one adapter POSTs a body, or this test proves nothing', async () => {
		// A guard on the guard. Every launch adapter but Bright Data puts its parameters in
		// the query string, so if the POST adapters ever leave the registry this whole file
		// silently degrades into a check that four GETs have no body — which is exactly the
		// blind spot that let the original defect live.
		const bodies = await Promise.all(
			ids.map(async (id) => {
				const a: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
				return a.translate(req, 'zone:CONTRACT_KEY').body;
			}),
		);
		expect(bodies.some((b) => b !== undefined && b.length > 0)).toBe(true);
	});
});
