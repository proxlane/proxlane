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

/**
 * The published markdown, inlined at build time.
 *
 * NOT a same-origin subrequest, which is what this did first and which worked under
 * `vite preview` and returned 500 on Cloudflare. A Worker fetching its own hostname does not
 * reach the asset layer the way a browser does, so the fetch failed, the middleware fell
 * through to Start's router — and Start answers a non-HTML `Accept` with
 * `500 Only HTML requests are supported here`. Verified against production, not reasoned about.
 *
 * These are the same bytes `/docs/<slug>.md` serves, read from the same generated artifacts, so
 * the header route and the extension route cannot drift.
 */
const PUBLISHED = import.meta.glob('../public/docs/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

/** `../public/docs/quickstart.md` -> `quickstart`. */
const BY_SLUG = new Map(
	Object.entries(PUBLISHED).map(([path, body]) => [
		path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
		body,
	]),
);

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
			const body = BY_SLUG.get(pathname.slice('/docs/'.length));
			if (body !== undefined) {
				return new Response(request.method === 'HEAD' ? null : body, {
					status: 200,
					headers: {
						'content-type': 'text/markdown; charset=utf-8',
						vary: VARY,
					},
				});
			}
			// 406, NOT next(). Start answers a non-HTML `Accept` with `500 Only HTML requests
			// are supported here`, so falling through turns a missing twin into a server error.
			// 406 is what actually happened: the representation was asked for and does not
			// exist.
			//
			// THIS IS A REAL STATE, not a defensive branch, and an earlier comment here said
			// the opposite. Eight of the ten docs pages are written as markdown in
			// `content/docs/` and published as twins. Two — `/docs/outcomes` and
			// `/docs/changelog` — are generated from the outcome taxonomy and from the package
			// changelogs, so there is no markdown source to publish and never was. Both answer
			// 406 today. `/docs/outcomes` is the one worth fixing: an agent asking about
			// outcomes is asking the question this project exists to answer.
			return new Response(
				`# Not available as markdown\n\n` +
					`\`${pathname}\` is generated rather than written, so it has no markdown source ` +
					`to serve. The content is on the HTML page.\n\n` +
					`- This page: https://proxlane.dev${pathname}\n` +
					`- Every page, summarised for agents: https://proxlane.dev/llms.txt\n` +
					`- Every page as one document: https://proxlane.dev/llms-full.txt\n`,
				{
					status: 406,
					headers: { 'content-type': 'text/markdown; charset=utf-8', vary: VARY },
				},
			);
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
