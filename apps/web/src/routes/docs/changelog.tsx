/**
 * The changelog, generated from the CHANGELOG.md files changesets already writes.
 *
 * Not hand-maintained, and not a second place to describe a release. Every entry here was a
 * changeset in the pull request that made the change — the house rule is that every behaviour
 * change carries one — so this page cannot fall behind the code without the release process
 * itself having failed.
 *
 * TWO VIEWS, and the reason there are two is that the old comment here was half right. It
 * said "changesets records no dates, so a merged list would have to invent an order". True of
 * changesets, false of this repo: every release cuts a git tag and a tag has a date, so the
 * order is read rather than invented. `releaseDates()` in the plugin does that.
 *
 * Recent first, because the question a stranger arrives with is "is this alive", and a page
 * grouped by package could not answer it — you had to read five sections and merge them in
 * your head. Then the per-package sections, which answer the different and equally real
 * question of what changed in the thing you actually run.
 */
import changelog from 'virtual:docs-changelog';
import { createFileRoute } from '@tanstack/react-router';
import type { ChangelogEntry, ChangelogPackage } from '../../../vite-plugin-docs.js';
import { DocPage } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

const TITLE = 'Changelog';
const SUMMARY = 'What changed, per package, newest first.';

/** A patch of dependency bumps is still a release; it just has nothing to tell you. */
function Release({
	release,
	pkg,
	compact,
}: {
	readonly release: ChangelogEntry;
	/** Set only in the merged view, where a version number alone says nothing. */
	readonly pkg?: string;
	/**
	 * CLAMPED, in the recent view only.
	 *
	 * A changeset that bumps two packages writes the same note into both changelogs, so the
	 * merged list renders it twice at full length — and these notes are paragraphs, because
	 * the house style is that a changeset explains why. Unclamped, the view built to be
	 * scannable was a wall of duplicated prose, which is the thing it existed to fix.
	 *
	 * The full text is two screens down in the package section, and the PR link is on the row.
	 */
	readonly compact?: boolean;
}) {
	return (
		<li className="border-[color:var(--color-rule)] border-b py-4 last:border-b-0">
			<div className="flex items-baseline gap-3">
				<span className="font-[family-name:var(--font-mono)] font-medium text-[color:var(--color-ink)] text-sm">
					{pkg === undefined ? null : <span className="font-normal">{pkg} </span>}
					{release.version}
				</span>
				<span className="text-[color:var(--color-slate)] text-xs uppercase tracking-wide">
					{release.kind}
				</span>
				{release.date === undefined ? null : (
					<time
						className="ml-auto font-[family-name:var(--font-mono)] text-[color:var(--color-slate)] text-xs"
						dateTime={release.date}
					>
						{release.date}
					</time>
				)}
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
							className={`doc-changelog-note text-[color:var(--color-slate)] text-sm leading-relaxed${
								compact === true ? ' line-clamp-2' : ''
							}`}
							dangerouslySetInnerHTML={{ __html: note }}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

/**
 * Every release across every package, newest first.
 *
 * Sorted on the tag date, which is read from git rather than inferred from version order —
 * versions move per package, so `0.10.2` in one and `0.2.3` in another say nothing about which
 * came first. An untagged release sorts last rather than being dropped: a missing date is a
 * gap in the tags, and hiding it would hide that.
 */
function recent(packages: readonly ChangelogPackage[], limit: number) {
	return packages
		.flatMap((p) => p.releases.map((r) => ({ pkg: p.label, release: r })))
		.sort((a, b) => (b.release.date ?? '').localeCompare(a.release.date ?? ''))
		.slice(0, limit);
}

const RECENT_LIMIT = 12;

function Changelog() {
	const latest = recent(changelog, RECENT_LIMIT);
	const lastShipped = latest[0]?.release.date;
	return (
		<DocPage
			title={TITLE}
			summary={SUMMARY}
			headings={[
				{ depth: 2 as const, id: 'recent', text: 'Recent' },
				...changelog.map((p: ChangelogPackage) => ({
					depth: 2 as const,
					id: p.label.toLowerCase(),
					text: p.label,
				})),
			]}
		>
			<div className="doc-prose max-w-[46rem]">
				<p>
					Written from the changesets in each pull request, so it cannot drift from what
					shipped. Versions move per package; there is no single release train.
					{lastShipped === undefined ? null : <> Last release: {lastShipped}.</>}
				</p>
			</div>

			{/* THE ANSWER TO "IS THIS ALIVE", which the per-package view could not give. A reader
			    had to open five sections and merge them mentally to learn what shipped this week. */}
			<section className="mt-12 max-w-[46rem]">
				<h2
					id="recent"
					className="font-medium text-[color:var(--color-ink)] text-xl tracking-tight"
				>
					Recent
				</h2>
				<p className="mt-1 text-[color:var(--color-slate)] text-sm">
					The last {RECENT_LIMIT} releases across every package, newest first.
				</p>
				<ul className="mt-3 flex flex-col">
					{latest.map(({ pkg, release }) => (
						<Release key={`${pkg}-${release.version}`} release={release} pkg={pkg} compact />
					))}
				</ul>
			</section>

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
