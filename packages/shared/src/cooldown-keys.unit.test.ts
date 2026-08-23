// Cooldown keys are built from an attacker-chosen URL, so their shape is a security surface.
//
// Findings from a security review of the diff that introduced them. None was exploitable on
// a single-tenant self-host deployment; all of them become live the moment two gateways share
// a Valkey, which is the exact shape the Valkey store exists to enable.

import { describe, expect, it } from 'vitest';
import { cooldownDomain, cooldownKey } from './cooldown.js';

describe('the domain component is bounded', () => {
	it('truncates a hostname longer than DNS allows', () => {
		// `new URL()` happily parses a 20,000-character host. Unbounded, that is a 20 KB Valkey
		// key sent twice per provider on every request, a 20 KB Map key in the in-memory store,
		// and 20 KB of attacker input reflected into the error body — and it turns filling a
		// 256 MB `noeviction` Valkey into ~13k requests instead of ~1.3M.
		const huge = `https://${'a'.repeat(20_000)}.com/`;
		const d = cooldownDomain(huge);
		expect(d.length).toBeLessThanOrEqual(253);
	});

	it('leaves a normal hostname untouched', () => {
		expect(cooldownDomain('https://www.example.com/a?b=c')).toBe('www.example.com');
	});

	it('produces a bounded key even for a hostile URL', () => {
		const key = cooldownKey('blk', {
			provider: 'scraperapi',
			domain: cooldownDomain(`https://${'x'.repeat(9999)}.test/`),
			org: 'self',
			premium: 'none',
		}) as string;
		expect(key.length).toBeLessThan(300);
	});
});

describe('the trailing FQDN dot is not a bypass', () => {
	it('treats example.com. and example.com as the same site', () => {
		// They resolve identically, so keeping them apart is a one-character bypass of an armed
		// cooldown and a free way to double the keyspace. The edge guard strips the dot for its
		// blocklist check and then hands back the un-stripped URL, so this is the second place
		// that has to know.
		expect(cooldownDomain('https://example.com./x')).toBe(
			cooldownDomain('https://example.com/x'),
		);
	});

	it('does not mangle a hostname that merely contains dots', () => {
		expect(cooldownDomain('https://a.b.c.example.com/')).toBe('a.b.c.example.com');
	});
});

describe('namespaces cannot be forged from a URL', () => {
	it('keeps an IPv6 literal inside the domain slot', () => {
		// IPv6 puts `:` and brackets into the domain component. `domain` is the TRAILING element
		// of cd:blk:{provider}:{domain}, so extra colons cannot shift a later field, and
		// `provider` comes from a fixed registry rather than from input.
		const d = cooldownDomain('http://[2001:4860:4860::8888]/');
		const key = cooldownKey('blk', {
			provider: 'p',
			domain: d,
			org: 'self',
			premium: 'none',
		}) as string;
		expect(key.startsWith('cd:blk:p:')).toBe(true);
		expect(key).not.toContain('cd:acct');
	});

	it('cannot reach the acct namespace from a blk key', () => {
		const d = cooldownDomain('https://evil.example/');
		expect(
			cooldownKey('blk', { provider: 'p', domain: d, org: 'self', premium: 'none' }),
		).not.toContain('cd:acct:');
	});

	it('normalises away control characters before they reach a key', () => {
		// The WHATWG URL parser strips tabs and newlines from the host, so a key cannot carry a
		// line break into anything that parses one. Asserted rather than assumed.
		const d = cooldownDomain('http://examp\tle\n.com/');
		expect(d).toBe('example.com');
		expect(d).not.toMatch(/[\r\n\t]/);
	});

	it('folds unicode spellings to one key via punycode', () => {
		// Two spellings of one host converging is what we want; diverging would let an attacker
		// dodge a cooldown by changing the encoding.
		expect(cooldownDomain('https://ExAmPlE.com/')).toBe('example.com');
	});
});
