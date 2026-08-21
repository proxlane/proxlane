import { policyFor } from '@proxlane/shared/outcome';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { outcomeFromSlug, outcomePages } from '../../generators/site.js';
import { docHead } from '../../lib/doc-head.js';

/**
 * One page per outcome, rendered from the taxonomy rather than written.
 *
 * A DYNAMIC ROUTE, NOT EIGHTEEN COMMITTED FILES. The site is SSR on Workers, so each of these
 * is a real crawlable URL either way, and eighteen generated files would be eighteen artifacts
 * to keep byte-identical for no gain the reader can see. What has to stay in sync is the
 * sitemap, and `pages:check` is what holds it there.
 *
 * Unknown slug is a genuine 404 rather than an empty page. The set is closed, so anything
 * outside it never existed.
 */
export const Route = createFileRoute('/outcomes/$slug')({
	loader: ({ params }) => {
		const outcome = outcomeFromSlug(params.slug);
		if (outcome === undefined) throw notFound();
		const page = outcomePages().find((p) => p.path === `/outcomes/${params.slug}`);
		return { outcome, policy: policyFor(outcome), summary: page?.summary ?? '' };
	},
	head: ({ loaderData }) =>
		docHead(
			loaderData === undefined ? 'Outcome' : loaderData.outcome,
			loaderData?.summary ?? '',
			`/outcomes/${loaderData === undefined ? '' : loaderData.outcome.toLowerCase().replace(/_/g, '-')}`,
		),
	component: OutcomePage,
});

function OutcomePage() {
	const { outcome, policy, summary } = Route.useLoaderData();
	const rows: readonly (readonly [string, string])[] = [
		[
			'status',
			policy.httpStatus === 'upstream' ? "the provider's own" : String(policy.httpStatus),
		],
		['class', policy.class],
		[
			'fails over',
			policy.failover === true ? 'yes' : policy.failover === 'once' ? 'once' : 'no',
		],
		['cooldown', policy.cooldown === 'none' ? 'none' : policy.cooldown],
	];
	return (
		<article className="mx-auto w-full max-w-[46rem] py-12 sm:py-20">
			<p className="mb-3 font-mono text-[color:var(--color-slate)] text-xs">X-Outcome</p>
			<h1 className="font-mono font-semibold text-[color:var(--color-ink)] text-[1.75rem] tracking-[-0.01em] sm:text-[2.25rem]">
				{outcome}
			</h1>
			<p className="mt-6 border-[color:var(--color-accent)] border-l-2 pl-4 text-[color:var(--color-ink)] text-lg leading-relaxed">
				{summary}
			</p>
			{/* minmax(0,1fr), because a value here can be long and a bare 1fr will not shrink
			    below its content. That took the width out of the label column on the landing
			    page and broke header names mid-word. */}
			<dl className="mt-10 grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-8 font-mono text-[0.8125rem] leading-[2.2]">
				{rows.map(([k, v]) => (
					<div key={k} className="contents">
						<dt className="whitespace-nowrap text-[color:var(--color-slate)]">{k}</dt>
						<dd className="break-all">{v}</dd>
					</div>
				))}
			</dl>
			<p className="mt-10 text-[color:var(--color-slate)] leading-relaxed">
				Every outcome, side by side, is on the{' '}
				<a className="underline" href="/docs/outcomes">
					outcomes reference
				</a>
				. What the gateway does between them is{' '}
				<a className="underline" href="/docs/failover">
					how failover works
				</a>
				.
			</p>
		</article>
	);
}
