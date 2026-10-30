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

/**
 * The site's palette, copied rather than linked: this page is served by the gateway under
 * `default-src 'none'`, so it cannot load the site's stylesheet or fonts, and it should still look
 * like the place the user just came from. Values are `packages/ui/src/theme.css`'s.
 */
const STYLE = `
:root{color-scheme:light dark;--ground:#fbfaf7;--surface:#fff;--ink:#14171a;--slate:#495057;--rule:#dee2e6;--accent:#c2255c;--on-accent:#fff;--line-1:#0b7285;--line-2:#e8590c;--line-3:#5f3dc4;--line-4:#2b8a3e;--line-5:#5c940d}
@media (prefers-color-scheme:dark){:root{--ground:#14171a;--surface:#1a1e23;--ink:#fbfaf7;--slate:#adb5bd;--rule:#343a40;--accent:#f06595;--on-accent:#14171a;--line-1:#22b8cf;--line-2:#ff922b;--line-3:#9775fa;--line-4:#51cf66;--line-5:#a9e34b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--ground);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:30rem;margin:0 auto;padding:clamp(2rem,8vh,5rem) 1.25rem 3rem}
.brand{display:flex;align-items:center;gap:.5rem;font-weight:600;letter-spacing:-.01em;margin-bottom:2.5rem}
.brand svg{width:1.4rem;height:1.4rem}
::selection{background:var(--accent);color:var(--on-accent)}
input{caret-color:var(--accent)}
.field>span:first-child{display:flex;align-items:center;gap:.6rem}
.field svg{width:1.75rem;height:.75rem;flex:none}
h1{font-size:1.75rem;line-height:1.15;letter-spacing:-.02em;margin:0 0 .75rem}
p{color:var(--slate);margin:0 0 1rem}
.host{color:var(--ink);font-weight:600}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:1.5rem;margin:1.75rem 0 1.25rem;box-shadow:0 1px 2px rgb(0 0 0/.04),0 8px 24px -12px rgb(0 0 0/.18)}
.warn{border:1px solid var(--accent);border-radius:10px;padding:.85rem 1rem;color:var(--ink);margin:1.25rem 0}
.err{color:var(--accent);font-weight:500}
.field{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1.25rem}
.field>span:first-child{font-size:.875rem;font-weight:500}
.hint{font-size:.8125rem;color:var(--slate);margin:.15rem 0 0}
input[type=password],input[type=text]{width:100%;padding:.7rem .8rem;border:1px solid var(--rule);border-radius:8px;background:var(--ground);color:var(--ink);font:14px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
input::placeholder{color:var(--slate);opacity:.7;font-family:ui-sans-serif,system-ui,sans-serif}
input:hover{border-color:var(--slate)}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
details{border-top:1px solid var(--rule);margin-top:.25rem;padding-top:1.1rem}
summary{cursor:pointer;color:var(--slate);font-size:.9rem;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"+ ";color:var(--accent);font-weight:600}
details[open] summary::before{content:"\\2212  "}
details[open] summary{margin-bottom:1rem}
.keys{display:grid;gap:0 .9rem;grid-template-columns:1fr}
@media (min-width:34rem){.keys{grid-template-columns:1fr 1fr}}
.check{display:flex;gap:.6rem;align-items:flex-start;font-size:.9rem;margin:1rem 0 0}
.check input{margin-top:.25rem;accent-color:var(--accent)}
button,a.button{display:block;width:100%;margin-top:1.5rem;padding:.85rem 1rem;border:1px solid var(--accent);border-radius:999px;background:transparent;color:var(--accent);font-family:inherit;font-weight:600;font-size:1rem;line-height:1;text-align:center;cursor:pointer;text-decoration:none}
button:hover,a.button:hover{box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 18%,transparent),0 8px 28px -8px color-mix(in oklab,var(--accent) 55%,transparent)}
button:focus-visible,a.button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.small{font-size:.8125rem}
code{display:block;font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);background:var(--ground);border:1px solid var(--rule);border-radius:8px;padding:.7rem .8rem;word-break:break-all}
`;

/** The site's mark (`apps/web/src/components/wordmark.tsx`): three lines and an interchange. */
const MARK =
	'<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke-width="4" stroke-linecap="round"><path d="M3 9H29" stroke="var(--line-1)"/><path d="M3 18H29" stroke="var(--line-2)"/><path d="M3 27H29" stroke="var(--line-3)"/></g><circle cx="16" cy="18" r="6.5" fill="var(--ground)" stroke="var(--accent)" stroke-width="4.5"/></svg>';

/** A provider's line, the colour it has on every diagram on the site (`capabilities.line`). */
const line = (n: number) =>
	`<svg viewBox="0 0 22 10" aria-hidden="true"><path d="M2 5H20" stroke="var(--line-${n})" stroke-width="3" stroke-linecap="round"/></svg>`;

function page(title: string, body: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Proxlane</title><style>${STYLE}</style></head><body><main><div class="brand">${MARK}proxlane</div>${body}</main></body></html>`;
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
	const fields = [...CAPABILITIES]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((c) => {
			const name = escapeHtml(NAMES[c.id] ?? c.id);
			return `<label class="field"><span>${line(c.line)}${name}</span><input type="password" name="key_${c.id}" autocomplete="off" spellcheck="false" placeholder="${c.id === 'brightdata' ? 'zone:token' : 'Paste API key'}"></label>`;
		})
		.join('');
	// THE TOKEN FIRST, keys behind a fold. Most people arrive with a token from the connect page;
	// a page that opened on five empty key fields made the one field they needed look optional.
	return page(
		'Connect',
		`<h1>Connect ${host}</h1>
<p><span class="host">${host}</span> wants to fetch pages through Proxlane with your provider keys. It never sees the keys, only a token that uses them.</p>
${
	args.verified
		? ''
		: `<p class="warn"><strong>${host} is not a known AI app.</strong> Anyone can start a sign-in that sends you here. Continue only if you started this from an app you trust at exactly that address.</p>`
}
${args.error === undefined ? '' : `<p class="err" role="alert">${escapeHtml(args.error)}</p>`}
<form method="post" action="/oauth/authorize" autocomplete="off" class="card">
<input type="hidden" name="consent" value="${escapeHtml(args.consent)}">
<label class="field"><span>Your proxlane token</span><input type="text" name="token" autocomplete="off" spellcheck="false" placeholder="pxl1_…"><span class="hint">From proxlane.dev/connect. It starts with pxl1_.</span></label>
<details><summary>No token? Paste provider keys instead</summary><div class="keys">${fields}</div><p class="hint">Fill in at least one. Leave the rest empty.</p></details>
${
	args.verified
		? ''
		: `<label class="check"><input type="checkbox" name="confirm" value="${host}"><span>I started this from ${host}</span></label>`
}
<button type="submit">Connect</button>
</form>
<p class="small">Each request bills your own provider accounts. Nothing here stores your keys: they are sealed into the token the app receives.</p>`,
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
<div class="card"><code>${escapeHtml(args.tokenId)}</code>
<a class="button" href="${escapeHtml(args.location)}">Continue to ${escapeHtml(args.host)}</a></div>`,
	);
}
