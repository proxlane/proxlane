/**
 * The shell every docs page renders into.
 *
 * Read mode, in the sense that matters: the visitor is here to understand something and
 * leave. So the measure is narrow, the contents are always visible on wide screens, and
 * nothing animates. The transit vocabulary stays in the type and the accent rather than
 * being restated — a reference page competing with the landing page for attention is a
 * reference page nobody finishes.
 */
import { Link, useLocation } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ProseWithCopy } from './copy-code.js';
import { DocSearch } from './doc-search.js';

export interface DocNavItem {
	readonly to: string;
	readonly title: string;
}

/** Every docs page, in reading order. The sidebar and `llms.txt` both derive from this. */
export const DOC_NAV: readonly DocNavItem[] = [
	{ to: '/docs', title: 'Overview' },
	{ to: '/docs/faq', title: 'FAQ' },
	{ to: '/docs/quickstart', title: 'Quickstart' },
	{ to: '/docs/hosting', title: 'Hosting' },
	{ to: '/docs/api', title: 'API reference' },
	{ to: '/docs/outcomes', title: 'Outcomes' },
	{ to: '/docs/failover', title: 'How failover works' },
	{ to: '/docs/adapters', title: 'Bring your own provider' },
	{ to: '/docs/agents', title: 'Agents' },
	{ to: '/docs/use-cases', title: 'Use cases' },
	{ to: '/docs/changelog', title: 'Changelog' },
];

export interface DocHeading {
	readonly depth: 2 | 3;
	readonly id: string;
	readonly text: string;
}

export function DocPage({
	title,
	summary,
	headings,
	children,
}: {
	readonly title: string;
	readonly summary: string;
	readonly headings?: readonly DocHeading[];
	readonly children: ReactNode;
}) {
	return (
		<div className="pt-10 pb-24 sm:pt-14 sm:pb-32">
			{/* Three columns on wide, one on phone. The contents column is last in the DOM and
			    pulled left by grid order, so a screen reader and a keyboard both reach the page
			    itself before a list of links into it. */}
			<div className="lg:grid lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-x-12">
				<DocSidebar headings={headings} />

				<div className="min-w-0">
					<header className="mb-10">
						<h1 className="font-medium text-[color:var(--color-ink)] text-3xl tracking-tight sm:text-4xl">
							{title}
						</h1>
						<p className="mt-3 max-w-[46rem] text-[color:var(--color-slate)] text-lg">
							{summary}
						</p>
					</header>

					{/* The on-page contents used to sit here, in the content column, as a bordered
					    list above the prose. It read as a block quote rather than as navigation, and
					    it scrolled away the moment you started reading — which is exactly when a
					    table of contents becomes useful. It now lives in the sticky sidebar, nested
					    under the page it belongs to. */}
					{headings !== undefined && headings.length > 2 && (
						<nav aria-label="On this page" className="mb-10 lg:hidden">
							<p className="text-[color:var(--color-slate)] text-xs uppercase tracking-wide">
								On this page
							</p>
							<ul className="mt-2 flex flex-col gap-1.5 border-[color:var(--color-rule)] border-l pl-4">
								{headings.map((h) => (
									<li key={h.id} className={h.depth === 3 ? 'pl-4' : undefined}>
										<a
											href={`#${h.id}`}
											className="text-[color:var(--color-slate)] text-sm transition-colors hover:text-[color:var(--color-ink)]"
										>
											{h.text}
										</a>
									</li>
								))}
							</ul>
						</nav>
					)}

					{children}
					<DocFooter />
				</div>
			</div>
		</div>
	);
}

/**
 * Which heading you are currently reading.
 *
 * A contents list that does not track position is a list of links; one that does is a
 * position indicator, and that is the difference between decoration and navigation.
 *
 * `rootMargin` pins the detection band near the top of the viewport rather than its middle.
 * Without it the "current" section changes when a heading crosses the centre of the screen,
 * which is long after the reader considers themselves inside it. `-45% bottom` means: the
 * active heading is the last one to have passed the upper part of the viewport.
 */
function useActiveHeading(headings: readonly DocHeading[] | undefined): string | undefined {
	const [active, setActive] = useState<string | undefined>(undefined);
	useEffect(() => {
		if (headings === undefined || headings.length === 0) return;
		if (typeof IntersectionObserver === 'undefined') return;
		const seen = new Map<string, boolean>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) seen.set(e.target.id, e.isIntersecting);
				// The FIRST heading currently in the band, in document order. Using the last
				// intersecting entry makes the highlight jump backwards when two are visible.
				const current = headings.find((h) => seen.get(h.id) === true);
				if (current !== undefined) setActive(current.id);
			},
			{ rootMargin: '0px 0px -45% 0px', threshold: 0 },
		);
		for (const h of headings) {
			const el = document.getElementById(h.id);
			if (el !== null) observer.observe(el);
		}
		return () => observer.disconnect();
	}, [headings]);
	return active;
}

/**
 * The sidebar: the pages, and the current page's own headings nested beneath it.
 *
 * ONE NAVIGATION, TWO LEVELS, rather than two navigations in two places. The contents list
 * used to sit in the content column and read as a quotation — it had no relationship to the
 * page list opposite it, and a reader had to work out that the two were the same kind of
 * thing. Nesting them says it: this is where you are, and this is what is inside it.
 *
 * Sticky with its own scroll, because a sidebar taller than the viewport that cannot scroll
 * simply hides its last items.
 */
// `| undefined` rather than `?`: with `exactOptionalPropertyTypes` an optional prop will not
// accept an explicitly-undefined value, and the caller always passes one.
function DocSidebar({ headings }: { readonly headings: readonly DocHeading[] | undefined }) {
	const { pathname } = useLocation();
	const here = pathname.replace(/\/$/, '') || '/docs';
	const active = useActiveHeading(headings);

	return (
		<nav aria-label="Documentation" className="mb-10 lg:mb-0">
			{/* Sticky wrapper, so search sits above the page list and both stay in view. On phones
			    this is a wrapping row of page links: the headings are rendered in the content
			    column instead, where they do not push the page down. */}
			<div className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:pb-8">
				<DocSearch />
				<ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 lg:flex-col lg:gap-x-0">
					{DOC_NAV.map((item) => {
						const current = item.to === here;
						return (
							<li key={item.to}>
								<Link
									to={item.to}
									className={`inline-flex min-h-9 items-center text-sm transition-colors ${
										current
											? 'font-medium text-[color:var(--color-ink)]'
											: 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'
									}`}
								>
									{item.title}
								</Link>
								{current && headings !== undefined && headings.length > 1 && (
									<ul className="mt-0.5 mb-2 hidden flex-col border-[color:var(--color-rule)] border-l lg:flex">
										{headings.map((h) => (
											<li key={h.id}>
												<a
													href={`#${h.id}`}
													// The active marker is a border on the item, not a background:
													// the rule is already there, so lighting up a segment of it reads
													// as a position on a line rather than as a selected row.
													className={`-ml-px block border-l-2 py-1 text-sm transition-colors ${
														h.depth === 3 ? 'pl-6' : 'pl-3'
													} ${
														active === h.id
															? 'border-[color:var(--color-accent)] text-[color:var(--color-ink)]'
															: 'border-transparent text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'
													}`}
												>
													{h.text}
												</a>
											</li>
										))}
									</ul>
								)}
							</li>
						);
					})}
				</ul>
			</div>
		</nav>
	);
}

/**
 * Where to go next, and how to fix what you just read.
 *
 * Both are open-source documentation conventions that pay for themselves. Prev/next turns a
 * pile of pages into a reading order, and an edit link converts "this paragraph is wrong"
 * from an issue somebody might file into a pull request they can open in one click. The
 * second only works because the pages are markdown in the repo.
 */
function DocFooter() {
	const { pathname } = useLocation();
	const here = pathname.replace(/\/$/, '') || '/docs';
	const i = DOC_NAV.findIndex((n) => n.to === here);
	const prev = i > 0 ? DOC_NAV[i - 1] : undefined;
	const next = i >= 0 && i < DOC_NAV.length - 1 ? DOC_NAV[i + 1] : undefined;
	// The overview has no markdown file, and neither does the generated outcome reference —
	// pointing "edit this page" at a file that does not exist is worse than omitting the link.
	const slug = here === '/docs' ? undefined : here.slice('/docs/'.length);
	// Generated pages have no markdown file behind them; an edit link would 404.
	const GENERATED = new Set(['outcomes', 'changelog']);
	const editable = slug !== undefined && !GENERATED.has(slug);

	return (
		<footer className="mt-16 max-w-[46rem] border-[color:var(--color-rule)] border-t pt-6">
			{editable && (
				<a
					href={`https://github.com/proxlane/proxlane/edit/main/apps/web/content/docs/${slug}.md`}
					className="inline-flex min-h-9 items-center text-[color:var(--color-slate)] text-sm transition-colors hover:text-[color:var(--color-ink)]"
					rel="noreferrer"
				>
					Edit this page on GitHub
				</a>
			)}
			{(prev !== undefined || next !== undefined) && (
				<nav aria-label="Pagination" className="mt-4 flex flex-wrap justify-between gap-4">
					{prev === undefined ? (
						<span />
					) : (
						<Link to={prev.to} className="group max-w-[48%]">
							<span className="block text-[color:var(--color-slate)] text-xs">Previous</span>
							<span className="text-[color:var(--color-ink)] group-hover:text-[color:var(--color-accent)]">
								{prev.title}
							</span>
						</Link>
					)}
					{next !== undefined && (
						<Link to={next.to} className="group max-w-[48%] text-right">
							<span className="block text-[color:var(--color-slate)] text-xs">Next</span>
							<span className="text-[color:var(--color-ink)] group-hover:text-[color:var(--color-accent)]">
								{next.title}
							</span>
						</Link>
					)}
				</nav>
			)}
		</footer>
	);
}

/**
 * Rendered markdown, with a copy button on every code block.
 *
 * The HTML is produced at build time from repo markdown with `markdown-it`'s `html: false`,
 * so no user input reaches it. The buttons are attached to the rendered tree on mount rather
 * than authored into the string; see `copy-code.tsx` for why that is the only option here.
 */
export function Prose({ html }: { readonly html: string }) {
	return <ProseWithCopy html={html} />;
}
