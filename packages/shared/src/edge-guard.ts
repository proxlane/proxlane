// The edge guard: what we refuse to fetch, decided before any provider is chosen.
//
// `operations.md` section 5 scopes this precisely, and the scoping is the interesting part.
// We are, by design, a service that fetches a target on someone ELSE's egress — the
// provider's, not ours. That makes URL validation correct and DNS-level defence largely
// somebody else's problem: **IP pinning, redirect re-checks and the DNS-rebinding suite are
// explicitly deferred** until a direct-fetch path exists. So this guard is synchronous and
// pure, judges the URL as written, and never resolves a name.
//
// What it still buys, and why it is not theatre: `TARGET_FORBIDDEN` exists so that
// "http://localhost:8080" is a 403 from us rather than a page from someone's dev server,
// and so abuse is MEASURABLE — a distinct outcome means a distinct counter. Without it,
// every hostile URL landed on INVALID_REQUEST, which pages the on-call. Anyone could wake
// somebody up with one curl.

import type { Outcome } from '@proxlane/adapters';

export type EdgeVerdict =
	| { readonly allowed: true; readonly url: URL }
	| { readonly allowed: false; readonly outcome: Outcome; readonly reason: string };

/** http and https only. Everything else is a smuggling surface, not a target. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * IPv4 ranges that must never be fetched, as [first, last] inclusive.
 *
 * Covers RFC1918 private space, loopback and link-local, and the special-purpose blocks
 * from RFC 6890. The documentation and benchmark ranges are here too: they are
 * non-routable by definition, so a request naming one is a mistake or a probe, never a
 * real scrape.
 */
const BLOCKED_V4: ReadonlyArray<readonly [string, number, number]> = [
	['this-network', ip4(0, 0, 0, 0), ip4(0, 255, 255, 255)],
	['private-10/8', ip4(10, 0, 0, 0), ip4(10, 255, 255, 255)],
	['cgnat-100.64/10', ip4(100, 64, 0, 0), ip4(100, 127, 255, 255)],
	['loopback-127/8', ip4(127, 0, 0, 0), ip4(127, 255, 255, 255)],
	// 169.254.169.254 lives here: the cloud metadata endpoint, and the single address most
	// worth stealing. The whole /16 goes, not just that host.
	['link-local-169.254/16', ip4(169, 254, 0, 0), ip4(169, 254, 255, 255)],
	['private-172.16/12', ip4(172, 16, 0, 0), ip4(172, 31, 255, 255)],
	['ietf-192.0.0/24', ip4(192, 0, 0, 0), ip4(192, 0, 0, 255)],
	['test-net-1', ip4(192, 0, 2, 0), ip4(192, 0, 2, 255)],
	['6to4-relay', ip4(192, 88, 99, 0), ip4(192, 88, 99, 255)],
	['private-192.168/16', ip4(192, 168, 0, 0), ip4(192, 168, 255, 255)],
	['benchmark-198.18/15', ip4(198, 18, 0, 0), ip4(198, 19, 255, 255)],
	['test-net-2', ip4(198, 51, 100, 0), ip4(198, 51, 100, 255)],
	['test-net-3', ip4(203, 0, 113, 0), ip4(203, 0, 113, 255)],
	['multicast-224/4', ip4(224, 0, 0, 0), ip4(239, 255, 255, 255)],
	['reserved-240/4', ip4(240, 0, 0, 0), ip4(255, 255, 255, 255)],
];

function ip4(a: number, b: number, c: number, d: number): number {
	return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

/**
 * Hostnames that are never a public target.
 *
 * `.internal` is ICANN-reserved for private use, `.local` is mDNS, and `.localhost` is
 * reserved by RFC 6761. None can be a legitimate scrape.
 */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];
const BLOCKED_NAMES = new Set([
	'localhost',
	// The metadata endpoints reachable by NAME rather than by address, which an
	// address-only check would sail straight past.
	'metadata.google.internal',
	'metadata',
	'instance-data',
]);

function parseIpv4(host: string): number | undefined {
	// The WHATWG parser has already normalised hex, octal, decimal-integer and short forms
	// to dotted quad, and lowercased the host — verified against Node 24. So by the time a
	// host reaches here, `0x7f000001`, `2130706433`, `127.1` and `0177.0.0.1` are all
	// `127.0.0.1`, and this only has to understand the canonical form.
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (m === null) return undefined;
	const parts = m.slice(1, 5).map(Number);
	if (parts.some((p) => p > 255)) return undefined;
	return ip4(parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number);
}

/** Expand an IPv6 literal (already stripped of brackets) to its eight 16-bit groups. */
function parseIpv6(host: string): number[] | undefined {
	if (!host.includes(':')) return undefined;
	const parts = host.split('::');
	if (parts.length > 2) return undefined;
	const head = parts[0] ?? '';
	const tail = parts.length === 2 ? (parts[1] ?? '') : undefined;
	const split = (s: string) => (s === '' ? [] : s.split(':'));
	const left = split(head);
	const right = tail === undefined ? [] : split(tail);
	const fill = tail === undefined ? 0 : 8 - left.length - right.length;
	if (fill < 0) return undefined;
	const groups = [...left, ...Array(fill).fill('0'), ...right];
	if (groups.length !== 8) return undefined;
	const out: number[] = [];
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
		out.push(Number.parseInt(g, 16));
	}
	return out;
}

function blockedIpv6(groups: number[]): string | undefined {
	const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	];
	// IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible. Node renders the mapped form as
	// `::ffff:7f00:1` — hex, not dotted — so a naive string check for "127." misses it
	// entirely. Fold to the embedded v4 address and reuse the v4 table.
	if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
		const embedded = ((g6 << 16) >>> 0) + g7;
		if (embedded !== 0 || g5 === 0xffff) {
			const hit = BLOCKED_V4.find(([, lo, hi]) => embedded >= lo && embedded <= hi);
			if (hit) return `ipv4-mapped ${hit[0]}`;
		}
	}
	if (groups.every((g) => g === 0)) return 'unspecified-::';
	if (
		g0 === 0 &&
		g1 === 0 &&
		g2 === 0 &&
		g3 === 0 &&
		g4 === 0 &&
		g5 === 0 &&
		g6 === 0 &&
		g7 === 1
	)
		return 'loopback-::1';
	// fc00::/7 unique-local
	if ((g0 & 0xfe00) === 0xfc00) return 'unique-local-fc00::/7';
	// fe80::/10 link-local
	if ((g0 & 0xffc0) === 0xfe80) return 'link-local-fe80::/10';
	// ff00::/8 multicast
	if ((g0 & 0xff00) === 0xff00) return 'multicast-ff00::/8';
	// 64:ff9b::/96 NAT64 — an IPv4 address wearing an IPv6 costume.
	if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
		const embedded = ((g6 << 16) >>> 0) + g7;
		const hit = BLOCKED_V4.find(([, lo, hi]) => embedded >= lo && embedded <= hi);
		return hit ? `nat64 ${hit[0]}` : undefined;
	}
	// 2001:db8::/32 documentation
	if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation-2001:db8::/32';
	return undefined;
}

/**
 * Judge a target URL. Pure, synchronous, and never resolves a name.
 *
 * Two different refusals, and the difference is load-bearing:
 *   BAD_REQUEST      the string is not a usable URL. The caller's mistake, 400, no page.
 *   TARGET_FORBIDDEN a valid URL we refuse to fetch. 403, and counted separately so abuse
 *                    is measurable rather than buried in our own bug metric.
 */
export function guardTargetUrl(raw: string): EdgeVerdict {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { allowed: false, outcome: 'BAD_REQUEST', reason: 'not a parseable absolute URL' };
	}

	if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
		// file:, gopher:, data: and friends are not targets; they are ways to ask a fetcher to
		// read something local. Wrong-scheme is the caller's error, so BAD_REQUEST.
		return {
			allowed: false,
			outcome: 'BAD_REQUEST',
			reason: `scheme "${url.protocol}" is not http or https`,
		};
	}

	if (url.username !== '' || url.password !== '') {
		// Credentials in a target URL get forwarded to the provider and end up in their logs
		// and ours. They are also the classic way to make a URL read as one host and resolve
		// as another to a human skimming it.
		return {
			allowed: false,
			outcome: 'BAD_REQUEST',
			reason: 'credentials in the URL are not accepted',
		};
	}

	const host = url.hostname.toLowerCase();
	if (host === '') {
		return { allowed: false, outcome: 'BAD_REQUEST', reason: 'empty host' };
	}

	if (host.startsWith('[') && host.endsWith(']')) {
		const groups = parseIpv6(host.slice(1, -1));
		if (groups === undefined) {
			return { allowed: false, outcome: 'BAD_REQUEST', reason: 'unparseable IPv6 literal' };
		}
		const why = blockedIpv6(groups);
		if (why !== undefined) {
			return { allowed: false, outcome: 'TARGET_FORBIDDEN', reason: why };
		}
		return { allowed: true, url };
	}

	const v4 = parseIpv4(host);
	if (v4 !== undefined) {
		const hit = BLOCKED_V4.find(([, lo, hi]) => v4 >= lo && v4 <= hi);
		if (hit) return { allowed: false, outcome: 'TARGET_FORBIDDEN', reason: hit[0] };
		return { allowed: true, url };
	}

	// A trailing dot is a valid FQDN root and must not be a way to spell `localhost.`
	// past an exact-match set.
	const name = host.endsWith('.') ? host.slice(0, -1) : host;
	if (BLOCKED_NAMES.has(name) || BLOCKED_SUFFIXES.some((s) => name.endsWith(s))) {
		return {
			allowed: false,
			outcome: 'TARGET_FORBIDDEN',
			reason: `reserved hostname "${name}"`,
		};
	}
	if (!name.includes('.')) {
		// A dotless name resolves through the host's search domains, which is how an internal
		// service gets reached without ever naming a private address. A public scrape target
		// always has a dot.
		return {
			allowed: false,
			outcome: 'TARGET_FORBIDDEN',
			reason: `dotless hostname "${name}" resolves via local search domains`,
		};
	}

	return { allowed: true, url };
}
