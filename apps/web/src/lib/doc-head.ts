// Per-page head tags.
//
// The root route deliberately sets no `canonical` and no `og:url`: pinned there they applied
// to every page, telling crawlers that each docs page is a duplicate of the homepage. On a
// project whose growth model is search, that is the most expensive possible default.
export const SITE = 'https://proxlane.dev';

export function docHead(title: string, summary: string, path: string) {
	const full = `${title} — Proxlane docs`;
	return {
		meta: [
			{ title: full },
			{ name: 'description', content: summary },
			{ property: 'og:title', content: full },
			{ property: 'og:description', content: summary },
			{ property: 'og:url', content: `${SITE}${path}` },
			{ name: 'twitter:title', content: full },
			{ name: 'twitter:description', content: summary },
		],
		links: [{ rel: 'canonical', href: `${SITE}${path}` }],
	};
}
