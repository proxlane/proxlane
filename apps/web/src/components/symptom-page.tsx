/**
 * A symptom page: the shell for someone who arrived from a search engine mid-incident.
 *
 * NOT `DocPage`, and the difference is the audience rather than the styling. Docs are read by
 * someone who has already decided to use this, in an order, with a sidebar telling them where
 * they are in that order. A symptom page is read by someone whose scraper broke twenty minutes
 * ago, who has never heard of us, and who will leave the moment the page starts selling.
 *
 * So: no sidebar, because there is no order to be lost in. No prev/next, because these are not
 * a sequence. The heading is the reader's own words, and the first thing under it answers them.
 *
 * WHAT IT MUST NOT DO, taken from the failure this page family is most likely to commit: put
 * the product before the answer. The landing page already made that mistake, seven sections
 * deep, and it is an easy one to repeat here because writing about the mechanism is more fun
 * than writing the fix. The test is one question. What is the first sentence after the h1, and
 * is it about the reader's request or about our software?
 */

import { Prose } from './doc-page.js';

export interface SymptomDoc {
	readonly title: string;
	readonly summary: string;
	readonly query?: string;
	readonly html: string;
}

export function SymptomPage({ doc }: { readonly doc: SymptomDoc }) {
	return (
		<article className="mx-auto w-full max-w-[46rem] py-12 sm:py-20">
			{/* The query, shown. It is what the reader typed, so seeing it back is the fastest
			    possible confirmation that they are in the right place — faster than reading the
			    heading, which is our words for their problem. */}
			{doc.query !== undefined && (
				<p className="mb-3 font-mono text-[color:var(--color-slate)] text-xs">{doc.query}</p>
			)}
			<h1 className="text-balance font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em] sm:text-[2.5rem]">
				{doc.title}
			</h1>
			{/* The answer, before anything else. Ruled in the accent rather than boxed: a callout
			    box reads as an aside, and this is the opposite of an aside. */}
			<p className="mt-6 border-[color:var(--color-accent)] border-l-2 pl-4 text-[color:var(--color-ink)] text-lg leading-relaxed">
				{doc.summary}
			</p>
			<div className="mt-10">
				<Prose html={doc.html} />
			</div>
			{/* No CTA. There is nothing to sign up for, so an invitation to "get started" would be
			    a link to a docker command dressed as a conversion. The body links where it is
			    genuinely useful and the page ends when the answer does. */}
		</article>
	);
}
