/**
 * The 404, written to be recoverable by something that cannot ask for help.
 *
 * The default was the words "Not Found" inside the site chrome. That is a correct status code
 * and a dead end: a person guesses at the nav, and an agent — which has no nav — concludes the
 * path does not exist and stops. Neither learns where the thing they wanted actually lives.
 *
 * So this page names the indexes by full URL rather than linking them as words. An agent reading
 * the rendered text gets three fetchable addresses; a person gets three links. `llms.txt` and
 * `sitemap.xml` are deliberately shown as URLs and not hidden behind link text, because the URL
 * IS the useful content for the reader who needs it most.
 */

import { Link } from '@tanstack/react-router';

const SITE = 'https://proxlane.dev';

/** Machine-readable first, because the human paths are already in the header nav. */
const INDEXES: ReadonlyArray<readonly [string, string]> = [
	['/llms.txt', 'every page, summarised for agents'],
	['/sitemap.xml', 'every indexable URL'],
	['/openapi.json', 'the gateway API, typed'],
];

export function NotFound() {
	return (
		<section className="mx-auto w-full max-w-[68ch] px-4 py-20 sm:px-8">
			<p className="font-mono text-[color:var(--color-accent)] text-sm">404</p>
			<h1 className="mt-3 font-semibold text-3xl text-[color:var(--color-ink)] tracking-tight">
				That page is not here
			</h1>
			<p className="mt-4 text-[color:var(--color-slate)] leading-relaxed">
				Nothing is served at this address. The docs index is at{' '}
				<Link
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
					to="/docs"
				>
					{SITE}/docs
				</Link>
				, and every documentation page is also served as markdown at the same path with{' '}
				<code className="text-[color:var(--color-ink)]">.md</code> on the end.
			</p>

			<h2 className="mt-10 font-semibold text-[color:var(--color-ink)] text-sm uppercase tracking-wide">
				Machine-readable indexes
			</h2>
			<ul className="mt-4 flex flex-col gap-3">
				{INDEXES.map(([path, what]) => (
					<li key={path} className="text-sm">
						<a
							className="font-mono text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
							href={path}
						>
							{SITE}
							{path}
						</a>
						<span className="text-[color:var(--color-slate)]"> — {what}</span>
					</li>
				))}
			</ul>

			<p className="mt-10 text-[color:var(--color-slate)] text-sm">
				If a link here sent you to this page, that is a bug worth{' '}
				<a
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
					href="https://github.com/proxlane/proxlane/issues"
				>
					reporting
				</a>
				.
			</p>
		</section>
	);
}
