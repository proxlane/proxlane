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
import type { ReactNode } from 'react';
import { ProseWithCopy } from './copy-code.js';

export interface DocNavItem {
	readonly to: string;
	readonly title: string;
}

/** Every docs page, in reading order. The sidebar and `llms.txt` both derive from this. */
export const DOC_NAV: readonly DocNavItem[] = [
	{ to: '/docs', title: 'Overview' },
	{ to: '/docs/quickstart', title: 'Quickstart' },
	{ to: '/docs/hosting', title: 'Hosting' },
	{ to: '/docs/api', title: 'API reference' },
	{ to: '/docs/outcomes', title: 'Outcomes' },
	{ to: '/docs/failover', title: 'How failover works' },
	{ to: '/docs/agents', title: 'Agents' },
	{ to: '/docs/use-cases', title: 'Use cases' },
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
			<div className="lg:grid lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] lg:gap-x-12">
				<nav aria-label="Documentation" className="mb-10 lg:mb-0">
					<ul className="flex flex-wrap gap-x-5 gap-y-1 lg:sticky lg:top-8 lg:flex-col lg:gap-x-0">
						{DOC_NAV.map((item) => (
							<li key={item.to}>
								<Link
									to={item.to}
									className="inline-flex min-h-9 items-center text-[color:var(--color-slate)] text-sm transition-colors hover:text-[color:var(--color-ink)]"
									activeProps={{
										className:
											'inline-flex min-h-9 items-center text-sm font-medium text-[color:var(--color-ink)]',
									}}
									activeOptions={{ exact: item.to === '/docs' }}
								>
									{item.title}
								</Link>
							</li>
						))}
					</ul>
				</nav>

				<div className="min-w-0">
					<header className="mb-10">
						<h1 className="font-medium text-[color:var(--color-ink)] text-3xl tracking-tight sm:text-4xl">
							{title}
						</h1>
						<p className="mt-3 max-w-[46rem] text-[color:var(--color-slate)] text-lg">
							{summary}
						</p>
					</header>

					{headings !== undefined && headings.length > 2 && (
						<nav
							aria-label="On this page"
							className="mb-10 border-[color:var(--color-rule)] border-l pl-4"
						>
							<ul className="flex flex-col gap-1.5">
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
	const editable = slug !== undefined && slug !== 'outcomes';

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
