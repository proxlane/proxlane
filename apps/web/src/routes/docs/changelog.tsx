/**
 * The changelog, generated from the CHANGELOG.md files changesets already writes.
 *
 * Not hand-maintained, and not a second place to describe a release. Every entry here was a
 * changeset in the pull request that made the change — the house rule is that every behaviour
 * change carries one — so this page cannot fall behind the code without the release process
 * itself having failed.
 *
 * Grouped by package rather than merged into one timeline. Changesets records no dates, so a
 * merged list would have to invent an order across packages whose versions move
 * independently. Grouping says the true thing instead: here is what changed in the gateway.
 */
import changelog from 'virtual:docs-changelog';
import { createFileRoute } from '@tanstack/react-router';
import type { ChangelogEntry, ChangelogPackage } from '../../../vite-plugin-docs.js';
import { DocPage } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

const TITLE = 'Changelog';
const SUMMARY = 'What changed, per package, newest first.';

/** A patch of dependency bumps is still a release; it just has nothing to tell you. */
function Release({ release }: { readonly release: ChangelogEntry }) {
	return (
		<li className="border-[color:var(--color-rule)] border-b py-4 last:border-b-0">
			<div className="flex items-baseline gap-3">
				<span className="font-[family-name:var(--font-mono)] font-medium text-[color:var(--color-ink)] text-sm">
					{release.version}
				</span>
				<span className="text-[color:var(--color-slate)] text-xs uppercase tracking-wide">
					{release.kind}
				</span>
			</div>
			{release.dependenciesOnly ? (
				<p className="mt-1.5 text-[color:var(--color-slate)] text-sm">
					Dependency updates only.
				</p>
			) : (
				<ul className="mt-2 flex flex-col gap-2">
					{release.notes.map((note) => (
						<li
							key={note}
							className="doc-changelog-note text-[color:var(--color-slate)] text-sm leading-relaxed"
							dangerouslySetInnerHTML={{ __html: note }}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function Changelog() {
	return (
		<DocPage
			title={TITLE}
			summary={SUMMARY}
			headings={changelog.map((p: ChangelogPackage) => ({
				depth: 2 as const,
				id: p.label.toLowerCase(),
				text: p.label,
			}))}
		>
			<div className="doc-prose max-w-[46rem]">
				<p>
					Written from the changesets in each pull request, so it cannot drift from what
					shipped. Versions move per package; there is no single release train.
				</p>
			</div>

			{changelog.map((pkg: ChangelogPackage) => (
				<section key={pkg.label} className="mt-12 max-w-[46rem]">
					<h2
						id={pkg.label.toLowerCase()}
						className="flex items-baseline gap-3 font-medium text-[color:var(--color-ink)] text-xl tracking-tight"
					>
						{pkg.label}
						<span className="font-[family-name:var(--font-mono)] font-normal text-[color:var(--color-slate)] text-sm">
							{pkg.current}
						</span>
					</h2>
					<p className="mt-1 text-[color:var(--color-slate)] text-sm">{pkg.note}</p>
					<ul className="mt-3 flex flex-col">
						{pkg.releases.map((release: ChangelogEntry) => (
							<Release key={release.version} release={release} />
						))}
					</ul>
				</section>
			))}
		</DocPage>
	);
}

export const Route = createFileRoute('/docs/changelog')({
	head: () => docHead(TITLE, SUMMARY, '/docs/changelog'),
	component: Changelog,
});
