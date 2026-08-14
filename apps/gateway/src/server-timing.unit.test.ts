import { describe, expect, it } from 'vitest';
import { serverTimingHeader, splitTimings } from './server-timing.js';

describe('splitTimings', () => {
	it('attributes everything not spent upstream to the gateway', () => {
		const t = splitTimings(50, [{ upstreamMs: 30 }, { upstreamMs: 12 }]);
		expect(t.upstreamMs).toBe(42);
		expect(t.gatewayMs).toBe(8);
		expect(t.totalMs).toBe(50);
	});

	it('counts a timeout as upstream, which is the reason upstreamMs exists', () => {
		// THE FAILURE THIS GUARDS. `latencyMs` is only set when a response came back, so a
		// timed-out hop reports none. Summing that instead would leave a 22-second wait
		// attributed to the gateway and fail the p95 gate for the opposite of the real reason:
		// the slower the provider, the worse we would look.
		const t = splitTimings(22_050, [{ upstreamMs: 22_000 }]);
		expect(t.gatewayMs).toBe(50);
	});

	it('never reports a negative gateway duration', () => {
		// Total and per-attempt figures are separate `performance.now()` reads, so the parts can
		// round to marginally more than the whole.
		expect(splitTimings(9.99, [{ upstreamMs: 10 }]).gatewayMs).toBe(0);
	});

	it('handles a request that reached no provider', () => {
		const t = splitTimings(3, []);
		expect(t.upstreamMs).toBe(0);
		expect(t.gatewayMs).toBe(3);
	});
});

describe('serverTimingHeader', () => {
	it('emits the gw metric the launch gate reads', () => {
		const h = serverTimingHeader(splitTimings(50, [{ upstreamMs: 42 }]));
		expect(h).toMatch(/(^|, )gw;dur=8(,|$)/);
	});

	it('emits up and total so the split can be checked from outside', () => {
		expect(serverTimingHeader(splitTimings(50, [{ upstreamMs: 42 }]))).toBe(
			'gw;dur=8, up;dur=42, total;dur=50',
		);
	});

	it('rounds to a tenth rather than emitting timer noise', () => {
		expect(serverTimingHeader(splitTimings(1.2345, []))).toBe(
			'gw;dur=1.2, up;dur=0, total;dur=1.2',
		);
	});

	it('parses back out of the header, which is what k6 does', () => {
		const h = serverTimingHeader(splitTimings(87.65, [{ upstreamMs: 80 }]));
		const gw = Number(/gw;dur=([\d.]+)/.exec(h)?.[1]);
		expect(gw).toBeCloseTo(7.7, 1);
	});
});
