import { createFileRoute, Link } from '@tanstack/react-router';
import c200 from '../../../content/symptoms/200-captcha-body.md?docs';
import c403 from '../../../content/symptoms/403-while-scraping.md?docs';
import cCf from '../../../content/symptoms/cloudflare-challenge-playwright.md?docs';
import cDd from '../../../content/symptoms/datadome-detection.md?docs';
import { docHead } from '../../lib/doc-head.js';

/**
 * The parent the symptom pages did not have.
 *
 * Four leaf pages shipped with nothing above them, which is a dead end from the header and a
 * gap in the crawl. Listed by the QUERY rather than the title, because that is the string a
 * reader recognises: they typed something close to it twenty minutes ago.
 *
 * Hand-listed rather than generated, deliberately. There are four, `content:lint` fails if a
 * page has no route, and a generator here would be machinery in front of a list that a person
 * should be looking at while deciding what to write next.
 */
const PAGES = [
	{ to: '/symptoms/403-while-scraping', doc: c403 },
	{ to: '/symptoms/200-captcha-body', doc: c200 },
	{ to: '/symptoms/cloudflare-challenge-playwright', doc: cCf },
	{ to: '/symptoms/datadome-detection', doc: cDd },
] as const;

export const Route = createFileRoute('/symptoms/')({
	head: () =>
		docHead(
			'Troubleshooting',
			'Why a scrape failed, by the symptom you can see: a 403, a 200 with a captcha in it, a challenge page that survived a headless browser.',
			'/symptoms',
		),
	component: () => (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				Troubleshooting
			</h1>
			<p className="mt-5 max-w-[52ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Start from what you can see. Each page answers one question and says plainly where the
				answer is a documented hypothesis rather than something we have confirmed.
			</p>
			{/* `border-t` only. With `border-b` the last row got a rule under it and the list looked
			    unfinished, as though a fifth item had failed to load. A divided list closes on its
			    last item, not on a line. */}
			<ul className="mt-10 divide-y divide-[color:var(--color-rule)] border-[color:var(--color-rule)] border-t">
				{PAGES.map(({ to, doc }) => (
					<li key={to}>
						{/* The accent arrives on hover as a rule down the left, the same gesture the answer
						    callout uses on every symptom page. It is the one branded thing in a list that
						    was otherwise entirely grey. */}
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
							<span className="mt-1 block max-w-[56ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
								{doc.summary}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	),
});
