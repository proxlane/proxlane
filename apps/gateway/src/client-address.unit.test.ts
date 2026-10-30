// The rate-limit key for a caller. Wrong here means a limit anyone can dodge, or one that every
// caller behind a proxy shares.

import { describe, expect, it } from 'vitest';
import { addressKey } from './client-address.js';

describe('the key an address is limited under', () => {
	it('keeps IPv4 as is, and unwraps the IPv4-mapped form to it', () => {
		expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
		expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(addressKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
	});

	it('groups IPv6 by /64, so a fresh source per request does not buy a fresh limit', () => {
		const a = addressKey('2001:db8:1:2:aaaa::1');
		expect(a).toBe('2001:db8:1:2::/64');
		expect(addressKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(a);
		expect(addressKey('2001:0db8:0001:0002::9')).toBe(a);
		expect(addressKey('2001:db8:1:3::1')).not.toBe(a);
	});

	it('handles the compressed edge cases', () => {
		expect(addressKey('::1')).toBe('0:0:0:0::/64');
		expect(addressKey('2001:db8::')).toBe('2001:db8:0:0::/64');
		expect(addressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
		expect(addressKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
	});

	it('puts anything unparseable in one shared bucket, never a key of its own', () => {
		// A header is caller-controlled until a proxy overwrites it; junk must not mint buckets.
		for (const junk of [undefined, '', 'localhost', 'x'.repeat(5000), '1.2.3.4, 5.6.7.8']) {
			expect(addressKey(junk)).toBe('unknown');
		}
	});
});
