// The consent form for remote MCP sign-in, and the page after it. Plain HTML, no script.
//
// `plan.md` section 2: open registration is a phishing surface, and this page is where it closes.
// It names the HOST the code will go to, never the name a client registered under, and a host
// that is not a known callback needs an explicit tick before anything is issued. Everything a
// caller controls is escaped; the page is served `no-store`, `no-referrer` and unframeable.

import { CAPABILITIES } from '@proxlane/adapters';

const NAMES: Readonly<Record<string, string>> = {
	brightdata: 'Bright Data',
	firecrawl: 'Firecrawl',
	scraperapi: 'ScraperAPI',
	scrapfly: 'Scrapfly',
	scrapingbee: 'ScrapingBee',
};

/** Headers for every page this file renders. */
export const PAGE_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Cache-Control': 'no-store',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Content-Security-Policy':
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
} as const;

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Proxlane</title><style>
:root{color-scheme:light dark;--ink:#16181d;--slate:#5b6270;--rule:#d9dce2;--accent:#c2185b;--ground:#fbfbfc}
@media (prefers-color-scheme:dark){:root{--ink:#eceef2;--slate:#9aa1ad;--rule:#2c3038;--accent:#f06292;--ground:#14161a}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:1.5rem;line-height:1.2;margin:0 0 1rem}
p{color:var(--slate);margin:.75rem 0}
.host{font-family:ui-monospace,monospace;color:var(--ink);font-size:1.05rem}
.warn{border:1px solid var(--accent);border-radius:8px;padding:.75rem 1rem;color:var(--ink)}
.err{color:var(--accent)}
label{display:block;margin:.75rem 0 .25rem;font-size:.9rem}
input[type=password],input[type=text]{width:100%;box-sizing:border-box;padding:.55rem .7rem;border:1px solid var(--rule);border-radius:8px;background:transparent;color:var(--ink);font:14px ui-monospace,monospace}
fieldset{border:1px solid var(--rule);border-radius:8px;margin:1.25rem 0;padding:.5rem 1rem 1rem}
legend{color:var(--slate);font-size:.85rem;padding:0 .25rem}
button,a.button{display:inline-block;margin-top:1.25rem;padding:.6rem 1.1rem;border:1px solid var(--accent);border-radius:8px;background:transparent;color:var(--ink);font:inherit;cursor:pointer;text-decoration:none}
code{font-family:ui-monospace,monospace;font-size:.9em;color:var(--ink);word-break:break-all}
</style></head><body><main>${body}</main></body></html>`;
}

export function fatalPage(message: string): string {
	return page(
		'Sign-in failed',
		`<h1>This sign-in did not start properly</h1><p>${escapeHtml(message)}</p>`,
	);
}

export function consentPage(args: {
	readonly consent: string;
	readonly host: string;
	readonly verified: boolean;
	readonly error?: string;
}): string {
	const host = escapeHtml(args.host);
	const fields = CAPABILITIES.map((c) => c.id)
		.sort()
		.map(
			(id) =>
				`<label for="key_${id}">${escapeHtml(NAMES[id] ?? id)}</label><input type="password" id="key_${id}" name="key_${id}" autocomplete="off" spellcheck="false" placeholder="leave empty to skip">`,
		)
		.join('');
	return page(
		'Connect',
		`<h1>Connect Proxlane to an AI app</h1>
<p>The app at <span class="host">${host}</span> is asking to fetch pages through this gateway with your provider keys. It never sees the keys, only a token that uses them.</p>
${
	args.verified
		? ''
		: `<p class="warn"><strong>${host} is not a known AI app.</strong> Anyone can start a sign-in that sends you here. Continue only if you started this from an app you trust at exactly that address.</p>`
}
${args.error === undefined ? '' : `<p class="err" role="alert">${escapeHtml(args.error)}</p>`}
<form method="post" action="/oauth/authorize" autocomplete="off">
<input type="hidden" name="consent" value="${escapeHtml(args.consent)}">
<fieldset><legend>Your provider keys</legend>${fields}</fieldset>
<label for="token">Or a proxlane token you already have</label>
<input type="text" id="token" name="token" autocomplete="off" spellcheck="false" placeholder="pxl1_…">
${
	args.verified
		? ''
		: `<label><input type="checkbox" name="confirm" value="${host}"> I started this from ${host}</label>`
}
<button type="submit">Connect</button>
</form>
<p>Each request bills your own provider accounts. Nothing here stores your keys: they are sealed into the token the app receives.</p>`,
	);
}

/**
 * After consent. NOT a redirect: the token's id is shown first, because it is the only way a user
 * who pasted keys can revoke this grant later, and they never see the token itself.
 */
export function connectedPage(args: {
	readonly location: string;
	readonly host: string;
	readonly tokenId: string;
}): string {
	return page(
		'Connected',
		`<h1>Connected</h1>
<p>Keep this id. It names the token behind this connection, and it is how the gateway's operator revokes it if you ask; rotating the provider keys inside it works too.</p>
<p><code>${escapeHtml(args.tokenId)}</code></p>
<a class="button" href="${escapeHtml(args.location)}">Continue to ${escapeHtml(args.host)}</a>`,
	);
}
