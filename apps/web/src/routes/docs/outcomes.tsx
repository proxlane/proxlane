/**
 * The outcome reference, GENERATED from the taxonomy.
 *
 * This page is the one piece of documentation that must never drift, because it is the
 * contract callers write `switch` statements against. So it is not written: it is derived
 * from `FAILOVER` in `@proxlane/shared`, the same object the gateway routes on. Adding an
 * outcome adds a row here, with its real status code and its real failover policy, in the
 * same commit that adds it to the union.
 *
 * `apps/web` avoids importing the taxonomy elsewhere — the landing page copies four labels
 * rather than take the dependency. That reasoning does not apply here. This page's content
 * *is* the taxonomy, and a hand-maintained copy of it is precisely the artifact that goes
 * stale and then misleads someone at three in the morning.
 */
import {
	CLASS_ADVICE,
	FAILOVER,
	OUTCOME_CLASSES,
	OUTCOMES,
	type Outcome,
} from '@proxlane/shared/outcome';
import { createFileRoute } from '@tanstack/react-router';
import { DocPage } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

const TITLE = 'Outcomes';
const SUMMARY = 'What every result means, what it returns, and whether to retry.';

/** What a caller should actually do. One line per class, and the reason for it. */

function Table({ rows }: { readonly rows: readonly Outcome[] }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-[color:var(--color-rule)] border-b text-left">
						{['Outcome', 'HTTP', 'Failover', 'Billed', 'Meaning'].map((h) => (
							<th
								key={h}
								className="py-2 pr-4 font-medium text-[color:var(--color-slate)] text-xs uppercase tracking-wide"
							>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((id) => {
						const p = FAILOVER[id];
						return (
							<tr key={id} className="border-[color:var(--color-rule)] border-b align-top">
								<td className="py-2.5 pr-4 font-[family-name:var(--font-mono)] text-[color:var(--color-ink)] text-xs">
									{id}
								</td>
								<td className="py-2.5 pr-4 font-[family-name:var(--font-mono)] text-xs">
									{p.httpStatus === 'upstream' ? "the target's" : p.httpStatus}
								</td>
								<td className="py-2.5 pr-4 text-xs">
									{p.failover === true ? 'yes' : p.failover === false ? 'no' : p.failover}
								</td>
								<td className="py-2.5 pr-4 text-xs">
									{p.chargeable === true ? 'yes' : p.chargeable === false ? 'no' : p.chargeable}
								</td>
								<td className="py-2.5 text-[color:var(--color-slate)]">{p.meaning}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function Outcomes() {
	return (
		<DocPage
			title={TITLE}
			summary={SUMMARY}
			headings={[
				{ depth: 2, id: 'branch-on-the-class', text: 'Branch on the class' },
				...OUTCOME_CLASSES.map((c) => ({ depth: 3 as const, id: c, text: c })),
				{ depth: 2, id: 'status-codes', text: 'Status codes' },
			]}
		>
			<div className="doc-prose max-w-[46rem]">
				<p>
					Every request produces exactly one outcome. There are {OUTCOMES.length} of them,
					grouped into {OUTCOME_CLASSES.length} classes.
				</p>
				<h2 id="branch-on-the-class">Branch on the class</h2>
				<p>
					<code>X-Outcome</code> is open and gains members as adapters land.{' '}
					<code>X-Outcome-Class</code> does not grow. Code written against the class keeps
					working when the vocabulary expands; code written against the outcome breaks on our
					schedule, not yours.
				</p>
			</div>

			{OUTCOME_CLASSES.map((cls) => {
				const rows = OUTCOMES.filter((o) => FAILOVER[o].class === cls);
				const advice = CLASS_ADVICE[cls];
				return (
					<section key={cls} className="mt-10 max-w-[46rem]">
						<h3
							id={cls}
							className="font-[family-name:var(--font-mono)] font-medium text-[color:var(--color-ink)] text-lg"
						>
							{cls}
						</h3>
						{/* No `undefined` guard, and that is the gain from moving these into
						    `@proxlane/shared`. They were a `Record<string, …>` local to this file, so a
						    new outcome class silently rendered no advice; `CLASS_ADVICE` is
						    `satisfies Record<OutcomeClass, …>`, so it now fails to compile instead. */}
						<p className="mt-1.5 text-[color:var(--color-slate)] text-sm">
							<span className="font-medium text-[color:var(--color-ink)]">
								{advice.action}.
							</span>{' '}
							{advice.what}
						</p>
						<div className="mt-4">
							<Table rows={rows} />
						</div>
					</section>
				);
			})}

			<section className="mt-14 max-w-[46rem]">
				<h2
					id="status-codes"
					className="font-medium text-[color:var(--color-ink)] text-xl tracking-tight"
				>
					Status codes
				</h2>
				<p className="mt-2 text-[color:var(--color-slate)]">
					On success the target's own status passes through unchanged. That is the drop-in
					promise: code that already branches on a 404 keeps working. Everything else maps to a
					status of ours.
				</p>
				<div className="mt-4">
					<table className="w-full border-collapse text-sm">
						<tbody>
							{[
								...new Set(
									OUTCOMES.map((o) => FAILOVER[o].httpStatus).filter((s) => s !== 'upstream'),
								),
							]
								.sort((a, b) => Number(a) - Number(b))
								.map((code) => (
									<tr
										key={code}
										className="border-[color:var(--color-rule)] border-b align-top"
									>
										<td className="w-16 py-2.5 font-[family-name:var(--font-mono)] text-[color:var(--color-ink)] text-xs">
											{code}
										</td>
										<td className="py-2.5 font-[family-name:var(--font-mono)] text-[color:var(--color-slate)] text-xs">
											{OUTCOMES.filter((o) => FAILOVER[o].httpStatus === code).join(', ')}
										</td>
									</tr>
								))}
						</tbody>
					</table>
				</div>
			</section>
		</DocPage>
	);
}

export const Route = createFileRoute('/docs/outcomes')({
	head: () => docHead(TITLE, SUMMARY, '/docs/outcomes'),
	component: Outcomes,
});
