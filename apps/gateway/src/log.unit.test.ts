import { describe, expect, it } from 'vitest';
import { accountOnlyChain, createLogger, hostOf, type RequestLine, timings } from './log.js';

describe('what a log line may contain', () => {
	it('keeps the host and discards the query string', () => {
		// THE POINT OF LOGGING host RATHER THAN url. A scrape URL carries the caller's query
		// string, and query strings carry session tokens and signed URLs. Writing them to stdout
		// turns `docker logs` into a credential store, and logs get pasted into issues.
		expect(hostOf('https://example.com/a/b?token=SECRET&x=1')).toBe('example.com');
	});

	it('keeps the port, which distinguishes two services on one host', () => {
		expect(hostOf('http://example.com:8080/x')).toBe('example.com:8080');
	});

	it('says so rather than throwing on an unparseable url', () => {
		// Worth seeing: it is what a BAD_REQUEST looks like from the log's side.
		expect(hostOf('not-a-url')).toBe('(unparseable)');
		expect(hostOf(undefined)).toBeUndefined();
		expect(hostOf('')).toBeUndefined();
	});
});

describe('timings, read back from the header the gateway already emits', () => {
	it('reads both halves', () => {
		expect(timings('gw;dur=1.7, up;dur=1690.7')).toEqual({ gw: 1.7, up: 1690.7 });
	});

	it('reads gw alone, which is every request that never reached a provider', () => {
		expect(timings('gw;dur=0.4')).toEqual({ gw: 0.4 });
	});

	it('is empty rather than wrong when the header is absent', () => {
		expect(timings(undefined)).toEqual({});
		expect(timings('')).toEqual({});
	});
});

describe('the off switch', () => {
	const line: RequestLine = { t: 'now', id: 'x', method: 'GET', status: 200 };

	it('returns nothing at all when off, so no wrapper is installed', () => {
		// Not a no-op logger: `createApp` checks for undefined and does not wrap the handler,
		// which keeps the hot path free of a function call that does nothing.
		expect(createLogger((k) => (k === 'PROXLANE_LOG' ? 'off' : undefined))).toBeUndefined();
	});

	it('logs by default, because a gateway that records nothing is the bug', () => {
		const out: string[] = [];
		const log = createLogger(
			() => undefined,
			(l) => out.push(l),
		);
		log?.(line);
		expect(out).toHaveLength(1);
		expect(JSON.parse(out[0] as string)).toEqual(line);
	});

	it('emits NDJSON — one line, no newlines inside it', () => {
		const out: string[] = [];
		const log = createLogger(
			() => undefined,
			(l) => out.push(l),
		);
		log?.({ ...line, host: 'a.example' });
		expect(out[0]).not.toContain('\n');
	});

	it('never lets a broken sink take down the request it describes', () => {
		const log = createLogger(
			() => undefined,
			() => {
				throw new Error('disk full');
			},
		);
		expect(() => log?.(line)).not.toThrow();
	});
});

describe('a chain that ended with nothing but account faults', () => {
	// THE CHAIN FROM THE REPORT THAT OPENED #276, and the one #275 is about. Four hops, one of
	// them a target verdict (scrapingbee:HARD_BLOCK), so the target WAS asked and this is not
	// the zero-capacity signature, whichever hop happens to be last.
	it('is not account-only when any hop got a verdict from the target', () => {
		expect(
			accountOnlyChain(
				'scraperapi:RATE_LIMITED>scrapfly:RATE_LIMITED>scrapingbee:HARD_BLOCK>brightdata:AUTH_FAILED',
				'AUTH_FAILED',
			),
		).toBe(false);
	});

	it('is account-only when every hop was our credential or our wallet', () => {
		expect(
			accountOnlyChain(
				'scraperapi:RATE_LIMITED>scrapfly:RATE_LIMITED>brightdata:AUTH_FAILED',
				'AUTH_FAILED',
			),
		).toBe(true);
		expect(accountOnlyChain('brightdata:AUTH_FAILED', 'AUTH_FAILED')).toBe(true);
	});

	it('is never account-only for a served request, even after account faults', () => {
		// The fallback worked: the wallet emptied on two legs and the third served the page.
		expect(
			accountOnlyChain('scraperapi:RATE_LIMITED>scrapfly:RATE_LIMITED>scrapingbee:OK', 'OK'),
		).toBe(false);
	});

	it('is false with no chain at all, which is a request that never reached the router', () => {
		expect(accountOnlyChain(undefined, 'BAD_REQUEST')).toBe(false);
		expect(accountOnlyChain('', 'NO_PROVIDER_AVAILABLE')).toBe(false);
	});

	it('reads the outcome after the LAST colon, so a provider id may not confuse it', () => {
		// Defensive: adapter ids are lowercase today, but the split must not depend on that.
		expect(accountOnlyChain('some:odd:id:AUTH_FAILED', 'AUTH_FAILED')).toBe(true);
		expect(accountOnlyChain('scraperapi:', 'AUTH_FAILED')).toBe(false);
	});
});
