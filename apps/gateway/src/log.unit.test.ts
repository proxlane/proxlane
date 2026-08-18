import { describe, expect, it } from 'vitest';
import { createLogger, hostOf, type RequestLine, timings } from './log.js';

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
