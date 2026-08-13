import { RouteDiagram } from '@proxlane/route-viz';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

/**
 * The page has one job, per `design.md`: convince someone to change one hostname.
 *
 * So the strongest argument goes above the fold and it is not a claim, it is a diff. A
 * developer audience reads two lines of curl faster than a paragraph, and can check it.
 */
function Home() {
	return (
		<div className="flex flex-col gap-24 py-16">
			<Hero />
			<Journey />
			<Migration />
			<Honesty />
		</div>
	);
}

function Hero() {
	return (
		<section className="flex flex-col gap-8">
			<h1 className="max-w-2xl text-balance font-bold text-4xl leading-[1.1] tracking-tight sm:text-5xl">
				Your request, rerouted.
			</h1>
			<p className="max-w-xl text-[color:var(--color-slate)] text-lg leading-relaxed">
				One endpoint in front of every scraping API. When a provider gets blocked, the next one
				runs — and you are told which, and why.
			</p>
			<div className="flex flex-wrap items-center gap-3">
				<a
					href="/docs"
					className="rounded-[--radius-card] bg-[color:var(--color-ink)] px-4 py-2 font-medium text-[color:var(--color-ground)] text-sm"
				>
					Change one hostname
				</a>
				<a
					href="https://github.com/proxlane/proxlane"
					className="rounded-[--radius-card] border border-[color:var(--color-rule)] px-4 py-2 font-medium text-sm"
				>
					Read the source
				</a>
			</div>
		</section>
	);
}

/**
 * The signature element: one request's journey, drawn from attempt data.
 *
 * `design.md` requires the hero visual and the dashboard's request timeline be the same
 * component reading the same shape, because "a developer audience can tell the difference
 * between a diagram of a system and a diagram from a system".
 *
 * The attempts below are a WORKED EXAMPLE, labelled as one. They are the shape the gateway
 * actually returns — ScraperAPI soft-blocked, ScrapingBee served — but nobody made this
 * request, and captioning it as live traffic would be the kind of claim this repo refuses.
 * It becomes real the day the canary writes to the request log.
 */
function Journey() {
	const attempts = [
		{
			provider: 'scraperapi',
			outcome: 'SOFT_BLOCK',
			line: 1 as const,
			detectRuleId: 'cf-challenge',
		},
		{ provider: 'scrapingbee', outcome: 'OK', line: 2 as const, latencyMs: 1840 },
	];
	return (
		<section className="flex flex-col gap-4">
			<h2 className="font-medium text-sm text-[color:var(--color-slate)] uppercase tracking-wide">
				What actually happened
			</h2>
			<div className="rounded-[--radius-card] border border-[color:var(--color-rule)] p-4">
				<RouteDiagram attempts={attempts} outcome="OK" status={200} />
			</div>
			<p className="max-w-xl text-[color:var(--color-slate)] text-sm">
				A worked example, in the shape the gateway returns. The first provider answered 200 with
				a challenge page; the detector called it and the chain moved on. You are billed for both
				attempts and told so.
			</p>
		</section>
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
		<section className="flex flex-col gap-4">
			<h2 className="font-medium text-sm text-[color:var(--color-slate)] uppercase tracking-wide">
				The migration
			</h2>
			<pre className="overflow-x-auto rounded-[--radius-card] border border-[color:var(--color-rule)] p-4 font-mono text-sm leading-relaxed">
				<code>
					<span className="text-[color:var(--color-slate)] line-through">
						{'curl "https://api.scraperapi.com?api_key=KEY&url=..."'}
					</span>
					{'\n'}
					<span className="text-[color:var(--color-line-1)]">
						{'curl "https://api.proxlane.dev/v1?api_key=KEY&url=..."'}
					</span>
				</code>
			</pre>
			<p className="max-w-xl text-[color:var(--color-slate)] text-sm">
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
			title: 'A 200 is not a success',
			body: 'A block page returns 200 with a body. The detector reads the body and calls it SOFT_BLOCK, with the rule that fired attached to the response.',
		},
		{
			title: 'Seventeen outcomes, six classes',
			body: 'Branch on the class, which never grows. Read the outcome for detail. Adding an outcome cannot break your switch.',
		},
		{
			title: 'You are told what it cost',
			body: 'Every attempt is priced, including the ones that failed. A failover that burned two charged hops reports two.',
		},
	];
	return (
		<section className="flex flex-col gap-6">
			<h2 className="font-medium text-sm text-[color:var(--color-slate)] uppercase tracking-wide">
				Honest by default
			</h2>
			<div className="grid gap-px overflow-hidden rounded-[--radius-card] border border-[color:var(--color-rule)] bg-[color:var(--color-rule)] sm:grid-cols-3">
				{facts.map((f) => (
					<article
						key={f.title}
						className="flex flex-col gap-2 bg-[color:var(--color-ground)] p-5"
					>
						<h3 className="font-medium">{f.title}</h3>
						<p className="text-[color:var(--color-slate)] text-sm leading-relaxed">{f.body}</p>
					</article>
				))}
			</div>
		</section>
	);
}
