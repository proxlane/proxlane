/**
 * Every generated URL on this site, from one function.
 *
 * ONE ENUMERATION, CALLED BY EVERYTHING. The sitemap writer, `pages:check` and the route that
 * renders these pages all ask this. The alternative is three code paths each reading the
 * taxonomy independently and drifting apart, which is not hypothetical: `repo:check` assertion
 * 32 exists because the homepage counted the providers correctly and listed them in the wrong
 * order, from two places reading the same registry.
 *
 * DERIVED FROM THE CLOSED ENUM, not from a list. `OUTCOMES` is exhaustive by construction, so
 * adding an outcome adds its page, and `pages:check` fails until the sitemap catches up. A
 * hand-kept list would let the two disagree silently, which is the failure this file prevents
 * rather than the one it reports.
 *
 * A NOTE ON THE `pages` FIELD, because the name is a trap. `OutcomePolicy.pages` is a boolean
 * meaning "wakes a human", reserved for our bugs and provider contract breaks. It is nothing to
 * do with web pages, and building this on it would have generated two URLs instead of eighteen
 * while looking entirely correct.
 */

// THE SUBPATH, NEVER THE BARREL. `@proxlane/shared` re-exports `id.ts`, which imports
// `node:crypto`. Pulling the barrel into anything the browser loads drags a Node builtin
// with it: in dev Vite externalises it and the page throws on load, which kills hydration
// for the WHOLE site, not just this route. The header silently stopped reacting to scroll
// and the cause was three files away.
import { OUTCOMES, type Outcome, policyFor } from '@proxlane/shared/outcome';

export interface GeneratedPage {
	/** Site-absolute path, no origin. */
	readonly path: string;
	readonly title: string;
	/** Renders as the answer, above the explanation. */
	readonly summary: string;
	/** How often this is worth recrawling, for the sitemap. */
	readonly changefreq: 'weekly' | 'monthly';
	readonly priority: string;
}

/** `SOFT_BLOCK` -> `soft-block`. The URL a reader can guess from the header they were sent. */
export function outcomeSlug(outcome: Outcome): string {
	return outcome.toLowerCase().replace(/_/g, '-');
}

/** `soft-block` -> `SOFT_BLOCK`, or undefined. The route's only way in. */
export function outcomeFromSlug(slug: string): Outcome | undefined {
	return OUTCOMES.find((o) => outcomeSlug(o) === slug);
}

/**
 * One page per outcome.
 *
 * The audience is narrow and specific, which is what makes it worth generating: somebody has a
 * response in front of them carrying `X-Outcome: SOFT_BLOCK` and pastes that string into a
 * search box. A table of all eighteen answers that badly, because they have to find their row.
 */
export function outcomePages(): GeneratedPage[] {
	return OUTCOMES.map((outcome) => {
		const p = policyFor(outcome);
		const status =
			p.httpStatus === 'upstream' ? "the provider's own status" : `HTTP ${p.httpStatus}`;
		return {
			path: `/outcomes/${outcomeSlug(outcome)}`,
			title: outcome,
			summary: `${p.meaning}. You get ${status}, and ${
				p.failover === true
					? 'the request moves to the next provider'
					: p.failover === 'once'
						? 'the request moves on once'
						: 'the chain stops here'
			}.`,
			changefreq: 'monthly',
			priority: '0.6',
		};
	});
}

/** Everything generated, in a stable order. */
export function enumerateSite(): GeneratedPage[] {
	return [...outcomePages()].sort((a, b) => a.path.localeCompare(b.path));
}
