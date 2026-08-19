import { createFileRoute, Link } from '@tanstack/react-router';
import { DocPage } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

const TITLE = 'Documentation';
const SUMMARY = 'One endpoint in front of every scraping API. Start here.';

/**
 * The overview, and the only page that is allowed to be a list of links.
 *
 * Grouped by what the reader is trying to do rather than by document type, because someone
 * arriving here wants either to make it work or to understand why it did something. Those
 * are different visits and the split is worth making obvious.
 */
const SECTIONS: readonly {
	readonly heading: string;
	readonly items: readonly {
		readonly to: string;
		readonly title: string;
		readonly blurb: string;
	}[];
}[] = [
	{
		heading: 'Get it working',
		items: [
			{
				to: '/docs/faq',
				title: 'Questions people actually ask',
				blurb: 'What it does, what it costs, what happens to your keys.',
			},
			{
				to: '/docs/quickstart',
				title: 'Quickstart',
				blurb: 'Your first request, in about a minute.',
			},
			{
				to: '/docs/hosting',
				title: 'Hosting',
				blurb: 'Where the gateway runs well, and where it does not.',
			},
		],
	},
	{
		heading: 'Reference',
		items: [
			{
				to: '/docs/api',
				title: 'API reference',
				blurb: 'Every endpoint, parameter and response header.',
			},
			{
				to: '/docs/outcomes',
				title: 'Outcomes',
				blurb: 'Every result, its status code, and whether to retry.',
			},
		],
	},
	{
		heading: 'Understand it',
		items: [
			{
				to: '/docs/failover',
				title: 'How failover works',
				blurb: 'Chains, detection, cooldowns and deadlines.',
			},
			{
				to: '/docs/adapters',
				title: 'Bring your own provider',
				blurb: 'Add a provider we have never heard of.',
			},
			{
				to: '/docs/agents',
				title: 'Using it from an agent',
				blurb: 'Giving an AI agent a scraper that fails honestly.',
			},
			{
				to: '/docs/use-cases',
				title: 'Use cases',
				blurb: 'What it is good at, and what it is not for.',
			},
		],
	},
];

function DocsIndex() {
	return (
		<DocPage title={TITLE} summary={SUMMARY}>
			<div className="doc-prose max-w-[46rem]">
				<p>
					Proxlane routes scraping requests across ScraperAPI, ScrapingBee and Scrapfly. When a
					provider blocks, errors or times out, the next one is tried. The response says exactly
					what happened.
				</p>
				<p>
					It is AGPL and self-hostable, and it uses your provider keys. There is no account to
					create.
				</p>
			</div>

			{SECTIONS.map((section) => (
				<section key={section.heading} className="mt-10 max-w-[46rem]">
					<h2 className="font-medium text-[color:var(--color-ink)] text-xs uppercase tracking-wide">
						{section.heading}
					</h2>
					<ul className="mt-3 flex flex-col">
						{section.items.map((item) => (
							<li
								key={item.to}
								className="border-[color:var(--color-rule)] border-b last:border-b-0"
							>
								<Link
									to={item.to}
									className="group flex flex-col gap-0.5 py-3.5 transition-colors sm:flex-row sm:items-baseline sm:gap-4"
								>
									<span className="min-w-[11rem] font-medium text-[color:var(--color-ink)] group-hover:text-[color:var(--color-accent)]">
										{item.title}
									</span>
									<span className="text-[color:var(--color-slate)] text-sm">{item.blurb}</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</DocPage>
	);
}

export const Route = createFileRoute('/docs/')({
	head: () => docHead(TITLE, SUMMARY, '/docs'),
	component: DocsIndex,
});
