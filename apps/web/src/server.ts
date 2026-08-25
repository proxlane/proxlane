/**
 * The Start instance, carrying one request middleware: markdown content negotiation.
 *
 * WHY. Every docs page is already published twice — HTML at `/docs/quickstart`, its source at
 * `/docs/quickstart.md` — and `llms.txt` points at the second. What was missing was the header
 * route to the same thing. An agent sending `Accept: text/markdown` to `/docs/quickstart` got
 * the router's serialised loader data: JSON describing a page rather than the page, which is
 * worse than a 404 because it looks like a successful answer.
 *
 * The convention is acceptmarkdown.com, and it has two halves. Serve markdown when it is asked
 * for, AND send `Vary: Accept` so a cache holding the HTML variant does not hand it to the next
 * agent that asks for markdown. Without `Vary` the negotiation is worse than none at all,
 * because it is correct right up until something caches it — and this site sits behind a CDN.
 *
 * `Vary` goes on BOTH branches. Declaring it only on the markdown response would let the HTML
 * variant be cached without it, which is the same bug approached from the other side.
 */

import { createMiddleware, createStart } from '@tanstack/react-start';

/** Docs pages only, and never one that already ends in `.md`, which would recurse. */
const DOCS = /^\/docs\/[a-z0-9-]+$/;

const VARY = 'Accept, Accept-Encoding';

/**
 * Whether the caller wants markdown, as opposed to merely tolerating it.
 *
 * NOT a substring test, and the difference is the whole function. A browser sends `text/html`
 * followed by a wildcard, and that wildcard matches every media type including this one — so
 * reading "markdown is acceptable" as "markdown is wanted" would serve plain text to every
 * browser that visits the site. This requires an explicit `text/markdown` that outranks
 * `text/html` on q-value.
 *
 * (The wildcard is described in words rather than written out, because the literal ends a block
 * comment. It ended this one, and the build reported "Unexpected token" thirty lines below.)
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
	if (accept === null || accept === undefined) return false;
	const q = (type: string): number => {
		for (const part of accept.split(',')) {
			const [media, ...params] = part.trim().split(';');
			if (media?.trim().toLowerCase() !== type) continue;
			const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
			if (qp === undefined) return 1;
			const n = Number(qp.slice(2));
			return Number.isFinite(n) ? n : 0;
		}
		return 0;
	};
	const md = q('text/markdown');
	return md > 0 && md >= q('text/html');
}

/** True when this request should be answered with the page's markdown twin. */
export function wantsMarkdown(
	method: string,
	pathname: string,
	accept: string | null,
): boolean {
	return (
		(method === 'GET' || method === 'HEAD') && DOCS.test(pathname) && prefersMarkdown(accept)
	);
}

const markdownNegotiation = createMiddleware({ type: 'request' }).server(
	async ({ request, pathname, next }) => {
		const isDocs = DOCS.test(pathname);

		if (wantsMarkdown(request.method, pathname, request.headers.get('accept'))) {
			// A subrequest to the twin. The asset layer answers `.md` before this Worker runs, so
			// there is no recursion; `DOCS` excludes anything already carrying the extension.
			const twin = new URL(`${pathname}.md`, new URL(request.url).origin);
			const res = await fetch(new Request(twin, { method: request.method }));
			if (res.ok) {
				const headers = new Headers(res.headers);
				headers.set('content-type', 'text/markdown; charset=utf-8');
				headers.set('vary', VARY);
				return new Response(res.body, { status: res.status, headers });
			}
			// Fall through on a miss rather than answering 404. A docs page with no twin is a bug
			// in the artifact generator, and the HTML page is the better failure: the reader gets
			// the content, just not in the shape they asked for.
		}

		const result = await next();
		if (!isDocs) return result;
		const headers = new Headers(result.response.headers);
		headers.set('vary', VARY);
		return {
			...result,
			response: new Response(result.response.body, {
				status: result.response.status,
				headers,
			}),
		};
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [markdownNegotiation],
}));
