import { RouteDiagram } from '@proxlane/route-viz';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

/**
 * The page has one job, per `design.md`: convince someone to change one hostname.
 *
 * The layout is the one `design.md` sketches, which the first version did not follow and
 * should have: headline, then the DIAGRAM, then the calls to action. That version put the
 * headline alone above two buttons and buried the diagram in a section below, which made the
 * hero a paragraph and the signature element an afterthought.
 */
function Home() {
	return (
		<div className="flex flex-col gap-20 pt-10 pb-20 sm:pt-16">
			<Hero />
			<Migration />
			<Honesty />
		</div>
	);
}

/**
 * One request's journey, drawn from attempt data.
 *
 * A WORKED EXAMPLE, labelled as one. This is the shape the gateway actually returns —
 * ScraperAPI soft-blocked, ScrapingBee served — but nobody made this request, and captioning
 * it as live traffic would be the kind of claim this repo refuses. It becomes real the day
 * the canary writes to the request log.
 */
const EXAMPLE = [
	{
		provider: 'scraperapi',
		outcome: 'SOFT_BLOCK',
		line: 1 as const,
		detectRuleId: 'cf-challenge',
	},
	{ provider: 'scrapingbee', outcome: 'OK', line: 2 as const, latencyMs: 1840 },
];

function Hero() {
	return (
		<section className="flex flex-col gap-8">
			<div className="flex flex-col gap-5">
				<h1 className="max-w-3xl text-balance font-bold text-[2.75rem] leading-[1.05] tracking-[-0.02em] sm:text-6xl">
					Your request, rerouted.
				</h1>
				<p className="max-w-xl text-balance text-[color:var(--color-slate)] text-lg leading-relaxed">
					One endpoint in front of every scraping API. When a provider gets blocked, the next
					one runs — and you are told which, and why.
				</p>
			</div>

			{/* The signature element, in the hero where design.md puts it.
			    ON A RULED FIELD, not floating and not in a card. Floating read as unfinished —
			    two thin lines adrift in whitespace. A card would turn it into an illustration
			    ABOUT the product. A grid is what a map is drawn on, so it belongs to the
			    metaphor rather than being borrowed from a component library. */}
			<figure className="max-w-2xl rounded-[--radius-card] border border-[color:var(--color-rule)] bg-[image:var(--grid-paper)] bg-[length:16px_16px] px-6 py-5">
				<RouteDiagram attempts={EXAMPLE} outcome="OK" status={200} />
				<figcaption className="mt-4 border-[color:var(--color-rule)] border-t pt-3 text-[color:var(--color-slate)] text-xs leading-relaxed">
					A worked example, in the shape the gateway returns. The first provider answered 200
					with a challenge page; the detector caught it and the chain moved on. Both attempts
					are billed, and reported.
				</figcaption>
			</figure>

			<div className="flex flex-wrap items-center gap-3">
				<a
					href="/docs"
					className="rounded-[--radius-card] bg-[color:var(--color-ink)] px-4 py-2.5 font-medium text-[color:var(--color-ground)] text-sm transition-opacity hover:opacity-85"
				>
					Change one hostname
				</a>
				<a
					href="https://github.com/proxlane/proxlane"
					className="rounded-[--radius-card] border border-[color:var(--color-rule)] px-4 py-2.5 font-medium text-sm transition-colors hover:border-[color:var(--color-ink)]"
				>
					Read the source
				</a>
			</div>
		</section>
	);
}

/** A section heading: label plus a rule, which is the map convention, not a settings screen. */
function Heading({ children }: { readonly children: string }) {
	return (
		<div className="flex items-center gap-4">
			<h2 className="font-medium text-base">{children}</h2>
			<span aria-hidden="true" className="h-px flex-1 bg-[color:var(--color-rule)]" />
		</div>
	);
}

/**
 * The migration, shown rather than described.
 *
 * `plan.md` section 4 makes drop-in migration the product promise: one hostname change,
 * parameters unchanged in shape. That claim is checkable in two lines, so it is printed in two
 * lines. Anything longer would be an argument where a demonstration will do.
 */
function Migration() {
	return (
		<section className="flex flex-col gap-5">
			<Heading>Change one hostname</Heading>
			<pre className="max-w-2xl overflow-x-auto font-mono text-[0.8rem] leading-loose">
				<code>
					<span className="text-[color:var(--color-slate)] line-through decoration-1">
						{'curl "https://api.scraperapi.com?api_key=KEY&url=..."'}
					</span>
					{'\n'}
					<span className="text-[color:var(--color-line-1)]">
						{'curl "https://api.proxlane.dev/v1?api_key=KEY&url=..."'}
					</span>
				</code>
			</pre>
			<p className="max-w-lg text-[color:var(--color-slate)] text-sm">
				Same parameters, same status codes. Your code keeps branching on the 404 it already
				branches on.
			</p>
		</section>
	);
}

/**
 * The differentiator, stated as behaviour rather than as an adjective.
 *
 * Every competitor says "reliable". None of them tells you a 200 was a block page, because
 * saying so costs them a success in their own numbers.
 */
function Honesty() {
	const facts = [
		{
			n: '200',
			title: 'is not a success',
			body: 'A block page returns 200 with a body. The detector reads the body, calls it SOFT_BLOCK, and attaches the rule that fired.',
		},
		{
			n: '17',
			title: 'outcomes, six classes',
			body: 'Branch on the class, which never grows. Read the outcome for detail. Adding an outcome cannot break your switch.',
		},
		{
			n: '2',
			title: 'attempts, both billed',
			body: 'Every attempt is priced, including the ones that failed. A failover that burned two charged hops reports two.',
		},
	];
	return (
		<section className="flex flex-col gap-5">
			<Heading>Honest by default</Heading>
			<div className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
				{facts.map((f) => (
					<article key={f.title} className="flex flex-col gap-2">
						<p className="font-mono text-2xl text-[color:var(--color-line-2)] leading-none">
							{f.n}
						</p>
						<h3 className="font-medium">{f.title}</h3>
						<p className="text-[color:var(--color-slate)] text-sm leading-relaxed">{f.body}</p>
					</article>
				))}
			</div>
		</section>
	);
}
