/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SiteHeader } from '../components/site-header.js';
import { Mark } from '../components/wordmark.js';
import appCss from '../styles/app.css?url';

/**
 * The canonical origin, and the reason it is a constant.
 *
 * The site answers on a `workers.dev` subdomain as well as its own domain, so without an
 * explicit canonical a search engine gets to pick, and may pick the one nobody links to.
 * Everything below derives from this, so there is one place to change when it moves.
 */
const SITE = 'https://proxlane.dev';
const DESCRIPTION =
	'Route scraping requests across ScraperAPI, ScrapingBee, Scrapfly and Bright Data with automatic ' +
	'failover, cost-aware routing and honest success detection. Change one hostname. ' +
	'AGPL, self-hostable.';
const TITLE = 'Proxlane: one endpoint in front of every scraping API';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: TITLE },
			{ name: 'description', content: DESCRIPTION },
			// Open Graph and Twitter. No `og:image` yet: a card that references a missing image
			// renders worse than one with no image at all, and OG image generation belongs to
			// `apps/web/src/generators/**`. `summary` rather than `summary_large_image` for the
			// same reason — the large card is mostly image.
			{ property: 'og:type', content: 'website' },
			{ property: 'og:site_name', content: 'Proxlane' },
			{ property: 'og:title', content: TITLE },
			{ property: 'og:description', content: DESCRIPTION },
			{ property: 'og:url', content: `${SITE}/` },
			{ property: 'og:image', content: `${SITE}/og.png` },
			{ property: 'og:image:width', content: '2400' },
			{ property: 'og:image:height', content: '1260' },
			{
				property: 'og:image:alt',
				content:
					'A request routed across three providers: blocked, errored, then served 200 OK.',
			},
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: `${SITE}/og.png` },
			{ name: 'twitter:title', content: TITLE },
			{ name: 'twitter:description', content: DESCRIPTION },
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			// Declared, so the browser stops guessing at `/favicon.ico`. Undeclared it requested
			// one anyway, took a 404, and logged a console error that cost the Lighthouse
			// best-practices score — a real defect that only showed up against a built server.
			{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
			// NO `canonical` HERE, and no `og:url` either. Both are per-page facts, and the root
			// route is every page — pinned to `${SITE}/` they told a crawler that /docs is a
			// duplicate of the homepage and should be dropped from the index, which on a project
			// whose entire growth model is search is the most expensive possible default. Each
			// route declares its own via `docHead` in `src/lib/doc-head.ts`.
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

/**
 * The theme is resolved BEFORE first paint, inline and synchronously.
 *
 * Doing it in an effect means the light variant renders first and then swaps, which is the
 * flash every themed site has had since 2019. The script is tiny and blocking on purpose: it
 * reads the stored choice, falls back to the OS, and stamps `data-theme` before the body
 * exists. `suppressHydrationWarning` because the server cannot know which one it picked.
 */
const THEME_INIT = `try{var t=localStorage.getItem('proxlane-theme');
if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

function RootDocument({ children }: { readonly children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* A blocking inline script is the only way to set the theme before first
				    paint. The content is a constant in this file, never user input. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
			</head>
			<body>
				{/* 68rem, not 64. At max-w-5xl the content stopped two thirds of the way across a
				    1440 viewport and every section inside it stopped earlier still, so the right
				    quarter of the page was permanently empty. */}
				<div className="mx-auto flex min-h-dvh w-full max-w-[68rem] flex-col px-6 sm:px-10">
					<SiteHeader />
					<main className="flex-1">{children}</main>
					<SiteFooter />
				</div>
				<Scripts />
			</body>
		</html>
	);
}

/**
 * Every control clears 44px.
 *
 * The nav links measured 20px on a phone and the theme toggle 24px, because an inline `<a>` is
 * only as tall as its line box. `min-h-11` with `inline-flex` is what makes the target the
 * size it looks like it should be; the visual weight is unchanged.
 */

function SiteFooter() {
	return (
		<footer className="flex flex-col gap-3 border-[color:var(--color-rule)] border-t py-10 text-[color:var(--color-slate)] text-sm">
			{/* Per-package, because four packages are Apache-2.0 so an adapter can be written
			    without inheriting copyleft. Saying "AGPL" flat would be wrong and would put off
			    exactly the contributors we want.
			    Measured, not full-bleed: unconstrained this line ran 139 characters while every
			    paragraph above it ran under 70. 56ch, not 68 — this face's `0` is 0.63em, so a
			    `ch` cap runs a good deal wider than the count suggests, and 68 still measured
			    long against every other paragraph. */}
			<p className="max-w-[56ch] leading-relaxed">
				The adapter, detection, SDK and shared packages are Apache-2.0, so you can write an
				adapter without inheriting copyleft. Everything else, the gateway included, is
				AGPL-3.0-only.
			</p>
			{/* The mark, not the wordmark. The footer is where a reader has finished and the
			    signature belongs; the tri-line station is the thing worth leaving them with. */}
			<p className="flex items-center gap-2.5 font-mono text-xs">
				<Mark className="size-[15px] shrink-0" />
				proxlane
			</p>
		</footer>
	);
}
