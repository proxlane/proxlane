// The SSRF vector table. `pnpm test:ssrf`.
//
// Its own vitest project and its own filename suffix, not folded into the unit suite,
// because security-engineer's exit criterion is literally "pnpm test:ssrf exits 0" — a
// check that can only be satisfied by a command that runs exactly this.
//
// Every vector here should be assumed to arrive eventually. The gateway's whole job is
// fetching a URL a stranger chose.

import { describe, expect, it } from 'vitest';
import { guardTargetUrl } from './edge-guard.js';

function forbidden(url: string) {
	const v = guardTargetUrl(url);
	expect(v.allowed, `${url} was ALLOWED`).toBe(false);
	return v.allowed === false ? v : null;
}
function allowed(url: string) {
	const v = guardTargetUrl(url);
	expect(v.allowed, `${url} was refused${v.allowed === false ? `: ${v.reason}` : ''}`).toBe(
		true,
	);
}

describe('the two refusals are different, and the difference matters', () => {
	it('calls a hostile-but-valid URL TARGET_FORBIDDEN, not INVALID_REQUEST', () => {
		// INVALID_REQUEST pages a human. If a hostile URL landed there, anyone could wake the
		// on-call with one curl — which is exactly why TARGET_FORBIDDEN exists.
		expect(forbidden('http://localhost:8080/')?.outcome).toBe('TARGET_FORBIDDEN');
		expect(forbidden('http://169.254.169.254/latest/meta-data/')?.outcome).toBe(
			'TARGET_FORBIDDEN',
		);
	});

	it('calls a malformed or wrong-scheme URL BAD_REQUEST', () => {
		// The caller's mistake, not an attack. 400, and no counter that implies abuse.
		expect(forbidden('not a url')?.outcome).toBe('BAD_REQUEST');
		expect(forbidden('file:///etc/passwd')?.outcome).toBe('BAD_REQUEST');
		expect(forbidden('gopher://example.com/')?.outcome).toBe('BAD_REQUEST');
		expect(forbidden('data:text/html,hi')?.outcome).toBe('BAD_REQUEST');
	});
});

describe('cloud metadata, by every spelling', () => {
	const vectors = [
		'http://169.254.169.254/latest/meta-data/',
		// The obfuscations the WHATWG parser normalises. Each of these IS 169.254.169.254.
		'http://0xa9fea9fe/',
		'http://2852039166/',
		'http://169.254.169.254./',
		// By name rather than by address — an address-only guard sails past all of these.
		'http://metadata.google.internal/computeMetadata/v1/',
		'http://metadata/computeMetadata/v1/',
		'http://instance-data/latest/meta-data/',
		// IPv4-mapped IPv6. Node renders this as [::ffff:a9fe:a9fe], hex, so a string check
		// for "169.254" finds nothing.
		'http://[::ffff:169.254.169.254]/',
	];
	for (const v of vectors) {
		it(`refuses ${v}`, () => {
			expect(forbidden(v)?.outcome).toBe('TARGET_FORBIDDEN');
		});
	}
});

describe('loopback, by every spelling the URL parser accepts', () => {
	// All of these normalise to 127.0.0.1 before the guard ever sees them — asserted here
	// because the guard DEPENDS on that normalisation and would be trivially bypassable if
	// a future runtime stopped doing it.
	const vectors = [
		'http://127.0.0.1/',
		'http://127.1/',
		'http://0x7f000001/',
		'http://2130706433/',
		'http://0177.0.0.1/',
		'http://127.0.0.1./',
		'http://LOCALHOST/',
		'http://localhost./',
		'http://foo.localhost/',
		'http://[::1]/',
		'http://[0:0:0:0:0:0:0:1]/',
		'http://[::ffff:127.0.0.1]/',
		'http://[::ffff:7f00:1]/',
	];
	for (const v of vectors) {
		it(`refuses ${v}`, () => {
			expect(forbidden(v)?.outcome).toBe('TARGET_FORBIDDEN');
		});
	}
});

describe('private and special-purpose ranges', () => {
	const v4 = [
		['0.0.0.0', 'this-network'],
		['10.0.0.1', 'RFC1918 10/8'],
		['10.255.255.255', 'RFC1918 upper bound'],
		['100.64.0.1', 'CGNAT'],
		['172.16.0.1', 'RFC1918 172.16/12 lower bound'],
		['172.31.255.255', 'RFC1918 172.16/12 upper bound'],
		['192.168.1.1', 'RFC1918 192.168/16'],
		['192.0.0.1', 'IETF protocol assignments'],
		['198.18.0.1', 'benchmarking'],
		['224.0.0.1', 'multicast'],
		['255.255.255.255', 'broadcast'],
	] as const;
	for (const [ip, why] of v4) {
		it(`refuses ${ip} (${why})`, () => {
			expect(forbidden(`http://${ip}/`)?.outcome).toBe('TARGET_FORBIDDEN');
		});
	}

	const v6 = [
		['[::]', 'unspecified'],
		['[fc00::1]', 'unique local'],
		['[fd12:3456::1]', 'unique local, fd prefix'],
		['[fe80::1]', 'link local'],
		['[ff02::1]', 'multicast'],
		['[64:ff9b::7f00:1]', 'NAT64 wrapping loopback'],
		['[2001:db8::1]', 'documentation'],
	] as const;
	for (const [ip, why] of v6) {
		it(`refuses ${ip} (${why})`, () => {
			expect(forbidden(`http://${ip}/`)?.outcome).toBe('TARGET_FORBIDDEN');
		});
	}

	it('does NOT refuse the public addresses adjacent to each blocked range', () => {
		// The boundaries are where an off-by-one hides, and over-blocking is a real outage:
		// 172.32.x is public, and refusing it breaks a legitimate scrape.
		for (const ip of [
			'9.255.255.255',
			'11.0.0.1',
			'172.15.255.255',
			'172.32.0.1',
			'192.167.255.255',
			'192.169.0.1',
			'100.63.255.255',
			'100.128.0.1',
			'223.255.255.255',
		]) {
			allowed(`http://${ip}/`);
		}
	});
});

describe('names that are never a public target', () => {
	for (const h of ['printer.local', 'db.internal', 'router.home.arpa', 'intranet', 'wiki']) {
		it(`refuses ${h}`, () => {
			expect(forbidden(`http://${h}/`)?.outcome).toBe('TARGET_FORBIDDEN');
		});
	}

	it('refuses a dotless hostname, which resolves via local search domains', () => {
		// This is how an internal service gets reached without ever naming a private address.
		expect(forbidden('http://buildserver/')?.reason).toMatch(/dotless/);
	});
});

describe('credentials in the URL', () => {
	it('are refused, because they reach the provider and both sets of logs', () => {
		expect(forbidden('http://user:pass@example.com/')?.outcome).toBe('BAD_REQUEST');
		expect(forbidden('http://user@example.com/')?.outcome).toBe('BAD_REQUEST');
	});

	it('do not smuggle a blocked host past the check', () => {
		// `http://127.0.0.1%2f@example.com/` really does target example.com — the parser puts
		// 127.0.0.1 in the USERNAME. Pinning it so nobody later "fixes" the guard to look at
		// the wrong field.
		const v = guardTargetUrl('http://127.0.0.1%2f@example.com/');
		expect(v.allowed).toBe(false);
		if (v.allowed === false) expect(v.outcome).toBe('BAD_REQUEST');
		expect(new URL('http://127.0.0.1%2f@example.com/').hostname).toBe('example.com');
	});
});

describe('what must still get through', () => {
	it('allows ordinary public targets, including odd ports and IDN', () => {
		for (const u of [
			'https://example.com/',
			'http://example.com:8080/path?q=1#frag',
			'https://8.8.8.8/',
			'https://sub.domain.example.co.uk/a/b',
			'https://xn--bcher-kva.example/',
			'https://bücher.example/',
			'https://[2606:4700:4700::1111]/',
		]) {
			allowed(u);
		}
	});

	it('returns the parsed URL so the caller never re-parses a different string', () => {
		// Re-parsing is where a check and its use diverge: validate one string, fetch another.
		const v = guardTargetUrl('https://Example.COM/A?b=1');
		expect(v.allowed).toBe(true);
		if (v.allowed) expect(v.url.hostname).toBe('example.com');
	});
});

describe('what this guard does NOT do, stated so nobody assumes it does', () => {
	it('does not resolve hostnames, so a name pointing at a private IP still passes', () => {
		// operations.md section 5 defers IP pinning, redirect re-checks and DNS rebinding
		// until a direct-fetch path exists — today the PROVIDER egresses, not us. This test
		// exists so the gap is a recorded decision rather than a discovery during an incident.
		allowed('https://localtest.me/'); // resolves to 127.0.0.1 in the real world
	});
});
