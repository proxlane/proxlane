import { createFileRoute, Link } from '@tanstack/react-router';
import { docHead } from '../lib/doc-head.js';

/**
 * The page that substantiates a claim made on every other page.
 *
 * "Nothing phones home" appears in the README and the pitch. Unsubstantiated it is marketing;
 * this is the page that says what actually happens, including the parts that are not flattering
 * — Cloudflare terminates every request and its logs exist whether or not we read them.
 *
 * WRITTEN FROM THE CODE, not from intent. Every claim below was checked before it was made:
 * `curl -I` for cookies, a grep of the built bundle for the eight common analytics hosts, and a
 * grep of `src/` for `localStorage` and outbound `fetch`. Two localStorage keys exist and they
 * are both named here rather than described as "preferences".
 */
export const Route = createFileRoute('/privacy')({
	head: () =>
		docHead(
			'Privacy',
			'What proxlane.dev stores, what the gateway stores, and what leaves your machine. No cookies, no analytics, no third-party requests.',
			'/privacy',
		),
	component: Page,
});

/** One row per thing a reader might reasonably worry about. */
const FACTS: ReadonlyArray<readonly [string, string]> = [
	['Cookies', 'None. This site sets no cookie, for any purpose, including analytics.'],
	[
		'Analytics',
		'None. There is no Google Analytics, Plausible, Fathom, PostHog, Segment or equivalent, and no first-party substitute for one. We do not know how many people read this page.',
	],
	[
		'Third-party requests',
		'None. Fonts are served from this domain rather than a font CDN, which is a deliberate choice: a font CDN sees the IP address of every visitor to every page that uses it.',
	],
	[
		'Local storage',
		'Two keys, both set only when you change something: proxlane-theme when you use the theme toggle, and a code-tab preference when you pick a language in a code sample. Both stay in your browser and are never sent anywhere.',
	],
];

function Page() {
	return (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				Privacy
			</h1>
			<p className="mt-5 max-w-[62ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Short, because there is not much to describe. This page covers two separate things: this
				website, and the gateway you run yourself. They share a name and nothing else.
			</p>

			<h2 className="mt-14 font-semibold text-[color:var(--color-ink)] text-xl tracking-tight">
				This website
			</h2>
			<dl className="mt-6 flex flex-col gap-6">
				{FACTS.map(([term, detail]) => (
					<div key={term}>
						<dt className="font-medium text-[color:var(--color-ink)]">{term}</dt>
						<dd className="mt-1 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
							{detail}
						</dd>
					</div>
				))}
			</dl>

			<p className="mt-8 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
				The part that is not zero: this site is served by Cloudflare, so Cloudflare terminates
				every request and handles the usual edge data — your IP address, the page you asked for,
				your user agent. That is true of any site behind a CDN, it is not something we opt into
				per visitor, and it happens whether or not anyone here looks at it. We do not join it to
				anything, because there is nothing to join it to.
			</p>

			<h2 className="mt-14 font-semibold text-[color:var(--color-ink)] text-xl tracking-tight">
				The gateway
			</h2>
			<p className="mt-6 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
				The gateway runs on your machine, on your provider keys. There is no hosted endpoint and
				no account, so there is no server here that could receive your traffic even if it wanted
				to. It contains no telemetry: the only hosts it contacts are the provider you configured
				and the URL you asked it to fetch.
			</p>
			<p className="mt-4 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
				It writes one log line per request to its own stdout, on your machine. That line carries
				the target's <em>host</em> and never the full URL, because a scrape URL's query string
				can hold session tokens, signed URLs and the gateway key itself, and logs get pasted
				into bug reports. <code>PROXLANE_LOG=off</code> silences it entirely.
			</p>
			<p className="mt-4 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
				Your provider bills you directly. We are not in the payment path and never see what you
				scrape, how much of it, or what it costs.
			</p>

			<h2 className="mt-14 font-semibold text-[color:var(--color-ink)] text-xl tracking-tight">
				Checking any of this
			</h2>
			<p className="mt-6 max-w-[68ch] text-[color:var(--color-slate)] leading-relaxed">
				Everything above is a claim about code that is{' '}
				<a
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
					href="https://github.com/proxlane/proxlane"
				>
					public
				</a>
				, which is the point of it being public. Open your browser's network tab on any page
				here and count the origins. Read{' '}
				<Link
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
					to="/docs/hosting"
				>
					the hosting docs
				</Link>{' '}
				for what the container does and does not do. If you find something here that is not
				true, that is a bug, and it is the kind we most want reported.
			</p>
		</div>
	);
}
