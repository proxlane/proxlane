/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ThemeToggle } from '../components/theme-toggle.js';
import appCss from '../styles/app.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Proxlane — one endpoint in front of every scraping API' },
			{
				name: 'description',
				content:
					'Route scraping requests across ScraperAPI, ScrapingBee and Scrapfly with ' +
					'automatic failover, cost-aware routing and honest success detection. ' +
					'Change one hostname. AGPL, self-hostable.',
			},
		],
		links: [{ rel: 'stylesheet', href: appCss }],
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
				<div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6">
					<SiteHeader />
					<main className="flex-1">{children}</main>
					<SiteFooter />
				</div>
				<Scripts />
			</body>
		</html>
	);
}

function SiteHeader() {
	return (
		<header className="flex items-center justify-between gap-6 py-6">
			<Link to="/" className="font-medium text-[color:var(--color-ink)] text-lg tracking-tight">
				proxlane
			</Link>
			<nav className="flex items-center gap-6 text-[color:var(--color-slate)] text-sm">
				<a className="hover:text-[color:var(--color-ink)]" href="/docs">
					docs
				</a>
				<a
					className="hover:text-[color:var(--color-ink)]"
					href="https://github.com/proxlane/proxlane"
				>
					github
				</a>
				<ThemeToggle />
			</nav>
		</header>
	);
}

function SiteFooter() {
	return (
		<footer className="border-[color:var(--color-rule)] border-t py-8 text-[color:var(--color-slate)] text-sm">
			{/* Per-package, because four packages are Apache-2.0 so an adapter can be written
			    without inheriting copyleft. Saying "AGPL" flat would be wrong and would put off
			    exactly the contributors we want. */}
			<p>
				Gateway, web and CLI are AGPL-3.0-only. The SDK, adapters, detect and shared are
				Apache-2.0, so you can write an adapter without inheriting copyleft.
			</p>
		</footer>
	);
}
