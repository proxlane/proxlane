// Who is calling, as a rate-limit key. Hosted mode only: self-host has one caller.
//
// TWO RULES, both from the review of the limiter that consumes this:
//
//   1. A forwarded header is trusted ONLY when the operator names it. Behind a reverse proxy the
//      socket address is the proxy, and every caller would share one limit; but read
//      `X-Forwarded-For` by default and any caller sets their own address with a header. So the
//      operator says which header their proxy writes (`PROXLANE_CLIENT_IP_HEADER`), and the LAST
//      entry is taken: the one that proxy appended, not the ones the caller sent ahead of it.
//   2. IPv6 is limited per /64, the block one subscriber is usually given. Per address it is no
//      limit at all: a single host can draw a fresh source from 2^64 of them for every request.

import { isIPv4, isIPv6 } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/** Longer than any real address. A header is caller-controlled until a proxy overwrites it. */
const MAX_LENGTH = 64;

/**
 * The limit key for an address: IPv4 as is, IPv4-mapped IPv6 as the IPv4 it maps, other IPv6 as
 * its /64, and anything unparseable as one shared `unknown` bucket rather than a key of its own.
 */
export function addressKey(raw: string | undefined): string {
	const a = (raw ?? '').trim().slice(0, MAX_LENGTH).toLowerCase();
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)?.[1];
	if (mapped !== undefined && isIPv4(mapped)) return mapped;
	if (isIPv4(a)) return a;
	// A zone index (`fe80::1%eth0`) names an interface on the gateway's own host, not a caller.
	const v6 = a.split('%')[0] ?? '';
	if (isIPv6(v6)) return `${expandV6(v6).slice(0, 4).join(':')}::/64`;
	return 'unknown';
}

/** Eight hextets, `::` filled in. Only called on what `isIPv6` accepted. */
function expandV6(a: string): string[] {
	// A trailing dotted quad (`::ffff:1.2.3.4` was handled above; `64:ff9b::1.2.3.4` is not)
	// stands for the last two hextets.
	const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(a)?.[1];
	let text = a;
	if (quad !== undefined) {
		const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = quad.split('.').map(Number);
		text = `${a.slice(0, -quad.length)}${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`;
	}
	const [head = '', tail] = text.split('::');
	const left = head === '' ? [] : head.split(':');
	const right = tail === undefined || tail === '' ? [] : tail.split(':');
	const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
	return [...left, ...fill, ...right].map((h) => Number.parseInt(h, 16).toString(16));
}

/** How the server finds a caller's address: a named proxy header, else the socket. */
export function clientAddressFrom(header: string | undefined): (c: Context) => string {
	if (header !== undefined) {
		const name = header.toLowerCase();
		return (c) => addressKey(c.req.header(name)?.split(',').at(-1));
	}
	return (c) => {
		try {
			return addressKey(getConnInfo(c).remote.address);
		} catch {
			// No socket to read, as under `app.request` in a test.
			return 'unknown';
		}
	};
}
