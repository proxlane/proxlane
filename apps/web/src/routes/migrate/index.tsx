import { createFileRoute, Link } from '@tanstack/react-router';
import scraperapi from '../../../content/migrate/scraperapi.md?docs';
import { docHead } from '../../lib/doc-head.js';

/**
 * The migration pages' parent, and the same shape as `/symptoms`.
 *
 * `plan.md` section 6 ranks this family first: buy-intent, low competition, one page per
 * provider people already pay. Each page is a hostname change, a parameter map read from the
 * adapter's own translation step, and an honest list of what does not carry over.
 *
 * Hand-listed, like the symptoms index, and for the same reason: one page today, `content:lint`
 * fails if a page has no route, and a generator here would be machinery in front of a list a
 * person should be looking at while deciding which provider to write up next.
 */
const PAGES = [{ to: '/migrate/scraperapi', doc: scraperapi }] as const;

export const Route = createFileRoute('/migrate/')({
	head: () =>
		docHead(
			'Migrate',
			'Move an existing integration to the gateway: the one-line change, the parameter map, and what does not carry over, per provider.',
			'/migrate',
		),
	component: () => (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				Migrate
			</h1>
			<p className="mt-5 max-w-[52ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Start from the provider you already use. Each page is the hostname change, the parameter
				map read from the adapter itself, and a plain list of what does not carry over.
			</p>
			<ul className="mt-10 divide-y divide-[color:var(--color-rule)] border-[color:var(--color-rule)] border-t">
				{PAGES.map(({ to, doc }) => (
					<li key={to}>
						<Link
							to={to}
							className="group -mx-3 block border-transparent border-l-2 px-3 py-5 transition-[border-color,background-color] duration-200 hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-surface)]/40"
						>
							<span className="block font-mono text-[color:var(--color-slate)] text-xs transition-colors group-hover:text-[color:var(--color-accent)]">
								{doc.query}
							</span>
							<span className="mt-1.5 block font-medium text-[color:var(--color-ink)] text-lg group-hover:underline">
								{doc.title}
							</span>
							<span className="mt-1.5 block max-w-[60ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
								{doc.summary}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	),
});
