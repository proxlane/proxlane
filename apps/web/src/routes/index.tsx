import { CAPABILITIES, capabilitiesFor, costOf } from '@proxlane/adapters';
import { describeRoute, type RouteAttempt, RouteDiagram } from '@proxlane/route-viz';
import { createFileRoute, Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type Block, Panel, Transcript } from '../components/artifacts.js';
import { DeployRow } from '../components/deploy.js';

export const Route = createFileRoute('/')({
	// The homepage declares its own canonical and `og:url` now that the root no longer does.
	// The root set them for every page, which told crawlers each docs page was a duplicate of
	// this one; moving them per-route fixes that and must not drop them from here.
	head: () => ({
		meta: [{ property: 'og:url', content: 'https://proxlane.dev/' }],
		links: [{ rel: 'canonical', href: 'https://proxlane.dev/' }],
	}),
	component: Home,
});

/**
 * The page has one job, per `design.md`: convince someone to change one hostname.
 *
 * THE COMPOSITION IS THE METAPHOR, not a picture of it. Direction D says providers are lines
 * and failover is an interchange; the first build honoured that inside one small SVG and left
 * the page around it as four unrelated blocks separated by identical 80px gaps, floating in
 * the left 60% of the viewport. A diagram in a document.
 *
 * So the page itself is a line: a trunk down the left, and each section a station jogging off
 * it. Every station leads with the ARTIFACT — the request, the response, the registry — in the
 * wide column, with the prose beside it rather than above it.
 *
 * AND THE HERO IS OPERATED, NOT WATCHED. It was a picture of one request. A gateway's whole
 * value is what it does when things go wrong, and that cannot be shown by a single frame of
 * the happy path — so the chain is switchable, and the response headers below follow whatever
 * is selected. Every case is real: the outcomes, the classes and the header set are read off
 * `apps/gateway/src`, including the one where a header is absent.
 */
function Home() {
	const [scenarioId, setScenarioId] = useState<ScenarioId>('failover');
	const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
	if (scenario === undefined) return null;

	return (
		<div className="pt-14 pb-24 sm:pt-24 sm:pb-32">
			<Hero scenario={scenario} onSelect={setScenarioId} />
			<Line>
				<Station
					label="quickstart"
					wide
					title="No signup, nothing to paste"
					lead={[
						'One hostname, and the chain is running.',
						'The keys already in your environment are found without configuration. This is the gateway: four providers, failover, and the detector, in the first command you type.',
					]}
				>
					<Quickstart />
				</Station>
				<Station
					label="detection"
					title="A 200 is not a success"
					// NOT "every competitor reports a block page as a success". `plan.md` §6 records that
					// this exact sentence was written once and retracted: ScrapeOps ships response
					// validation on every premium plan, and Scrapfly publishes ASP error codes so a
					// challenge does not come back as a success — from a provider this page ships an
					// adapter for. A reader could falsify it in thirty seconds, on the page whose whole
					// argument is that we say the true thing when it costs us. The retraction never
					// reached the homepage. What is actually ours is that the detection is inspectable.
					lead={[
						'Detection is table stakes. Showing you the rule that fired is not.',
						'Three behaviours instead of the adjective.',
					]}
				>
					<Honesty />
				</Station>
				<Station
					label="migration"
					title="Change one hostname"
					lead={[
						'Same parameters, same status codes.',
						'Your code keeps branching on the 404 it already branches on.',
					]}
				>
					<Migration />
				</Station>
				<Station
					label="response"
					title="Every answer says how it got there"
					lead={[
						'Branch on the class, read the outcome for detail.',
						'The class is closed and will not grow, so adding an outcome cannot break your switch. Headers follow the chain selected above.',
					]}
				>
					<Response scenario={scenario} />
				</Station>
				<Station
					label="pricing"
					title="Free on your own keys"
					lead={[
						'You pay your providers directly. We are not in the payment path.',
						'The gateway is AGPL and runs on your own machine. There is no account to create and nothing to enter a card into.',
					]}
				>
					<Pricing />
				</Station>
				<Station
					label="lines"
					title="Four providers, four lines"
					lead={['They are not interchangeable, which is the point.', linesLead()]}
				>
					<Lines />
				</Station>
				<Station
					label="agents"
					wide
					title="Every command speaks JSON"
					lead={[
						'Built to be driven by a script.',
						'A --json flag on every command, a stable envelope, and exit codes that separate a bad answer from a bad call. The repo ships a use-proxlane skill, so an agent can read the contract instead of guessing it.',
					]}
				>
					<Agents />
				</Station>
			</Line>
		</div>
	);
}

/**
 * `outcomeClass` from `@proxlane/shared`, for the outcomes this page shows.
 *
 * Copied rather than imported: `apps/web` has no reason to take a runtime dependency on the
 * taxonomy to render four labels, and the mapping is asserted in `packages/shared`. Read off
 * `FAILOVER` — `HARD_BLOCK` is `blocked`, not `provider`, and `PROVIDER_ERROR` is `provider`,
 * not `gateway`.
 */
const OUTCOME_CLASS: Record<string, string> = {
	OK: 'ok',
	SOFT_BLOCK: 'blocked',
	HARD_BLOCK: 'blocked',
	PROVIDER_ERROR: 'provider',
	GATEWAY_BUSY: 'gateway',
};

interface Scenario {
	readonly id: string;
	readonly label: string;
	readonly attempts: readonly RouteAttempt[];
	/** The outcome the caller received. */
	readonly outcome: string;
	readonly status?: number;
	// NO `cost` FIELD, deliberately. It was one, it was typed by hand, and all four values were
	// off by about a thousand. `costFor` derives it from these attempts instead, so a scenario
	// cannot state a price its own chain would not produce.
	readonly caption: string;
}

/**
 * Three chains the gateway can actually produce.
 *
 * WORKED EXAMPLES, labelled as such. These are the shapes the gateway returns; nobody made
 * these requests, and captioning them as live traffic would be the kind of claim this repo
 * refuses. They become real the day the canary writes to the request log.
 *
 * The third one matters most and is the one a competitor's site would never show: every
 * provider blocked. Per `chain.ts`, an exhausted chain reports the LAST attempt's outcome —
 * `NO_PROVIDER_AVAILABLE` is only for a chain that made no attempt at all — and it attaches
 * no provider, so `X-Provider-Used` is genuinely absent rather than empty.
 */
const SCENARIOS: readonly Scenario[] = [
	{
		id: 'failover',
		label: 'failover',
		attempts: [
			{
				provider: 'scraperapi',
				outcome: 'SOFT_BLOCK',
				line: 1,
				detectRuleId: 'cf-challenge',
				latencyMs: 1420,
			},
			{ provider: 'scrapingbee', outcome: 'PROVIDER_ERROR', line: 2, latencyMs: 610 },
			{ provider: 'scrapfly', outcome: 'OK', line: 3, latencyMs: 1840 },
		],
		outcome: 'OK',
		status: 200,
		caption:
			'The first provider answered 200 with a challenge page and the detector named the rule that caught it; the second failed outright; the third served. Your providers charge for all three, so Proxlane reports all three. It takes no cut of any of it.',
	},
	{
		id: 'direct',
		label: 'first hop',
		attempts: [{ provider: 'scraperapi', outcome: 'OK', line: 1, latencyMs: 980 }],
		outcome: 'OK',
		status: 200,
		caption:
			'The ordinary case: the first provider served, the chain stopped, and your provider charged you for one attempt.',
	},
	{
		id: 'exhausted',
		label: 'exhausted',
		attempts: [
			{
				provider: 'scraperapi',
				outcome: 'SOFT_BLOCK',
				line: 1,
				detectRuleId: 'cf-challenge',
				latencyMs: 1420,
			},
			{
				provider: 'scrapingbee',
				outcome: 'HARD_BLOCK',
				line: 2,
				detectRuleId: 'datadome',
				latencyMs: 890,
			},
			{
				provider: 'scrapfly',
				outcome: 'HARD_BLOCK',
				line: 3,
				detectRuleId: 'datadome',
				latencyMs: 1130,
			},
		],
		outcome: 'HARD_BLOCK',
		caption:
			'Every provider blocked. The chain reports the last outcome rather than inventing one, and no provider served, so x-provider-used is absent from the response rather than empty. You are still told what was tried, and your providers still charge for it.',
	},
	{
		id: 'shed',
		label: 'shed',
		// Zero attempts, and that is the fact the scenario exists to show. The ceiling is
		// checked before a provider is chosen, so nothing was tried and nothing was spent.
		attempts: [],
		outcome: 'GATEWAY_BUSY',
		status: 429,
		caption:
			'The gateway was already at its in-flight ceiling, so it refused this request instead of queueing it. A proxy that queues silently becomes a latency black hole. Nothing was tried and nothing was charged. retry-after says when to come back, and the class is gateway, not provider: this one is ours, not a provider throttling you.',
	},
];

/**
 * What `x-cost-estimate` would actually say for a scenario.
 *
 * DERIVED, and it had to become derived. These were four hand-typed decimals — 0.001400,
 * 0.002800, 0.004200, 0.004600 — and every one was about a thousand times too small. A single
 * plain attempt on any of the three credit providers costs `1.000000`, which is what the
 * gateway prints; the typed numbers looked like dollars while the header beside them said
 * `provider-credits`. The same wrong figures had spread to the README and the quickstart.
 *
 * The file already made this argument about the JS multiplier a few lines down: "a declared
 * multiplier is a third number that can disagree with the two it summarises". A declared cost
 * is the same thing, and it disagreed.
 *
 * Summed the way `app.ts` sums it — every attempt that carries a cost, not only the one that
 * served, because the provider charges for the failures too — and `mixed` when a chain crosses
 * units, since Bright Data bills in usd-cents and there is no honest total across the two.
 */
function costFor(attempts: readonly { readonly provider: string }[]): string {
	const tables = attempts.map((a) => capabilitiesFor(a.provider)?.costTable);
	if (tables.some((t) => t === undefined)) return '0.000000';
	const units = new Set(tables.map((t) => t?.unit));
	if (units.size > 1) return 'mixed';
	let total = 0;
	for (const t of tables) {
		if (t === undefined) continue;
		total += costOf(t, { premium: 'none', renderJs: false }) ?? 0;
	}
	return (total / 1_000_000).toFixed(6);
}

type ScenarioId = (typeof SCENARIOS)[number]['id'];

/**
 * The headers the gateway would put on that response.
 *
 * DERIVED, so a header can never disagree with the drawing beside it — including the absence
 * of `x-provider-used`, which is a conditional spread in `headersFor` and is the single most
 * useful thing on this page for someone writing integration code.
 */
function headersFor(s: Scenario): readonly (readonly [string, string])[] {
	const served = s.attempts.find((a) => a.outcome === 'OK');
	type Row = readonly [string, string];
	// Provider time is the sum of every hop, gateway time is what the router itself spent, and
	// the total is the two together — the same subtraction the real header is built from, so
	// these add up on screen the way they add up in a response.
	const upstreamMs = s.attempts.reduce((n, a) => n + (a.latencyMs ?? 0), 0);
	const gatewayMs = s.attempts.length === 0 ? 0.4 : 1.1 + s.attempts.length * 0.3;
	const ms = (n: number) => (Math.round(n * 10) / 10).toString();
	return [
		['x-outcome', s.outcome],
		['x-outcome-class', OUTCOME_CLASS[s.outcome] ?? 'gateway'],
		['x-attempts', String(s.attempts.length)],
		// The one header that names who FAILED. Derived from the same attempt list the diagram
		// beside it draws, exactly as the real `headersFor` derives it from `r.attempts`, so the
		// station that shows a red cross and the header that names it cannot disagree.
		...(s.attempts.length === 0
			? []
			: ([
					['x-chain', s.attempts.map((a) => `${a.provider}:${a.outcome}`).join('>')],
				] as Row[])),
		...(served === undefined ? [] : ([['x-provider-used', served.provider]] as Row[])),
		['x-cost-estimate', costFor(s.attempts)],
		// Always beside the number. The gateway omits it only when a chain spent in two units and
		// reports `mixed`, which cannot happen in these scenarios — every one stays on credits.
		['x-cost-unit', 'provider-credits'],
		// Only when the gateway actually knows. A guessed Retry-After is worse than none,
		// because a caller will believe it — the response builder takes the same position.
		...(s.outcome === 'GATEWAY_BUSY' ? ([['retry-after', '1']] as Row[]) : []),
		// On every response. `gw` is the number operations.md gates p95 on, and the one that
		// answers "was it you or the provider" without anyone having to ask.
		[
			'server-timing',
			`gw;dur=${ms(gatewayMs)}, up;dur=${ms(upstreamMs)}, total;dur=${ms(gatewayMs + upstreamMs)}`,
		],
	];
}

/**
 * The three launch adapters, READ OFF `proxlane providers --json`.
 *
 * Not hand-written: every value here was printed by the shipped CLI against the real
 * capability registry in `packages/adapters/src/<id>/capabilities.ts`.
 *
 * The first version of this table listed the id and its line number and nothing else, which
 * told a reader precisely nothing — a line index is an internal token slot, not a reason to
 * pick anything. These four columns are the ones that differ between them, which is the whole
 * argument for routing across them rather than picking one.
 */
/**
 * The provider table, DERIVED rather than retyped.
 *
 * IT WAS HAND-WRITTEN AND TWO CELLS WERE WRONG. ScrapingBee's geography read "7 regions" after
 * its country list was corrected to 42 codes, and Scrapfly's rendering read 5x when its own
 * arithmetic is 1 + 5 = 6. The README's copy of this table is generated by
 * `scripts/readme-providers.ts` and asserted byte-identical, so it self-corrected; this one did
 * not, because nothing derived it. `repo:check` counted the ROWS and checked their ORDER, and
 * neither reads a cell.
 *
 * The multiplier is a ratio of two real prices, for the same reason `lib/cost.ts` computes it
 * that way: a declared multiplier is a third number that can disagree with the two it summarises.
 */
const LAUNCH_LINES = [...CAPABILITIES]
	.sort((a, b) => a.line - b.line)
	.map((c) => {
		const plain = costOf(c.costTable, { premium: 'none', renderJs: false });
		const rendered = costOf(c.costTable, { premium: 'none', renderJs: true });
		return {
			id: c.id,
			line: c.line,
			geo: c.countryCodes === 'all' ? 'all' : `${c.countryCodes.size} codes`,
			sessions: c.sessions,
			js: plain === null || rendered === null || plain === 0 ? 1 : rendered / plain,
		};
	});

/**
 * The sentence above the table, DERIVED for the reason the table itself was.
 *
 * IT CARRIED THE EXACT ERROR THE TABLE WAS FIXED FOR. The comment on `LAUNCH_LINES` records
 * that ScrapingBee's geography "read 7 regions after its country list was corrected to 42
 * codes" — and when that cell was fixed by deriving it, the caption introducing the table went
 * on saying "limited to seven regions", one line above a table rendering "42 codes". A reader
 * saw both at once.
 *
 * Fixing the data and leaving the prose that summarises it is the same failure a second time,
 * so the summary is computed from the same array the table is.
 */
function linesLead(): string {
	const narrow = LAUNCH_LINES.find((l) => l.geo !== 'all');
	const dearest = LAUNCH_LINES.reduce((a, b) => (b.js > a.js ? b : a));
	const free = LAUNCH_LINES.some((l) => l.js === 1);
	const geo =
		narrow === undefined ? '' : `one reaches ${narrow.geo.replace(' codes', ' countries')}, `;
	const js = free
		? `rendering JavaScript is free on one and ${dearest.js}x the price on another`
		: `rendering JavaScript costs up to ${dearest.js}x`;
	return `Printed by proxlane providers, straight from the capability registry. One does sessions, ${geo}and ${js}. A line colour is assigned here too, and every surface reuses it.`;
}

/**
 * The order the gateway actually routes in, which is NOT this table's order.
 *
 * THE BANNER ADVERTISED THE WRONG ONE. It printed the table's order and labelled it "(in
 * order)", while `DEFAULT_PROVIDER_ORDER` in `apps/gateway/src/index.ts` puts Scrapfly ahead of
 * ScrapingBee — so the homepage told visitors which provider gets paid first and named the
 * wrong one. `repo:check` assertion 44 holds this literal to the gateway's constant, because
 * the two live in different deployables and neither can import the other.
 */
const ROUTING_ORDER = ['scraperapi', 'scrapfly', 'scrapingbee', 'brightdata'] as const;

const CLI_COMMAND = 'proxlane outcomes SOFT_BLOCK --json';
const CLI_OUTPUT = `{
  "ok": true,
  "command": "outcomes",
  "data": [
    {
      "outcome": "SOFT_BLOCK",
      "class": "blocked",
      "httpStatus": 502,
      "chargeable": false,
      "failover": true,
      "cooldown": "blk",
      "pages": false,
      "meaning": "200 but our detector fired; a rule ID is attached"
    }
  ]
}`;

/**
 * Real `proxlane doctor` output, trimmed to the lines that make the point.
 *
 * There is no paste step, and that is the single most useful fact for someone arriving with
 * a scraping problem: every adapter declares a `keyEnvVar` in the capability registry, so the
 * key already in your environment is found without configuration.
 *
 * IT ENDS ON THE GATEWAY, not on the CLI. This sequence used to finish with
 * `proxlane scrape --provider=scraperapi`, which pins ONE provider and disables failover — so
 * the page's first hands-on moment demonstrated the product with its main feature switched
 * off, and the prose beside it had to admit as much. Three commands now: find the keys, run
 * the gateway, watch a request fail over. `x-attempts: 2` is the whole pitch in one line.
 */
/**
 * The version this transcript was taken at.
 *
 * ALLOWED TO LAG the newest release, and asserted only to be a version that actually shipped —
 * the same position `repo:check` takes on the self-host compose pin. A transcript is a record of
 * one run, so an older version is honest; a version nobody ever released is not.
 *
 * The banner used to omit it entirely, which stopped being true the moment the gateway started
 * printing one. CI already learned that lesson the hard way: a literal "proxlane gateway on"
 * match in the image smoke test broke on the same change.
 */
const BANNER_VERSION = '0.7.0';

const QUICKSTART_BLOCKS: readonly Block[] = [
	{ cmd: 'npx proxlane doctor' },
	{
		out: `
  ok   key:scraperapi     $SCRAPERAPI_KEY set (32 chars)
  ok   key:scrapingbee    $SCRAPINGBEE_KEY set (80 chars)
  ok   cooldowns          on. A provider that just refused a domain is skipped
`,
	},
	{ cmd: 'docker run -p 8787:8787 --env-file .env ghcr.io/proxlane/gateway' },
	{
		out: `
  proxlane gateway ${BANNER_VERSION} on :8787
  providers: ${ROUTING_ORDER.join(' > ')} (in order)
  retries:   1 extra at the last provider (PROXLANE_TERMINAL_RETRIES)
`,
	},
	{ cmd: 'curl -sD- "localhost:8787/v1?api_key=$KEY&url=https://example.com"' },
	{
		// TWO attempts, and every field agrees with that. `x-cost-estimate` is two hops at the
		// single-hop price the `first hop` scenario above quotes, not the three-hop figure from
		// the `failover` one — a transcript whose own numbers disagree teaches the reader to
		// distrust the rest of the page.
		out: `
  HTTP/1.1 200 OK
  x-outcome        OK
  x-outcome-class  ok
  x-attempts       2
  x-chain          ${ROUTING_ORDER[0]}:SOFT_BLOCK>${ROUTING_ORDER[1]}:OK
  x-provider-used  ${ROUTING_ORDER[1]}
  x-cost-estimate  2.000000
  x-cost-unit      provider-credits
`,
	},
];

const AGENT_BLOCKS: readonly Block[] = [{ cmd: CLI_COMMAND }, { out: CLI_OUTPUT }];

const QUICKSTART_COPY = 'docker run -p 8787:8787 --env-file .env ghcr.io/proxlane/gateway';

/** Straight from `.claude/skills/use-proxlane/SKILL.md`, which ships in the repo. */
const EXIT_CODES = [
	['0', 'good, proceed'],
	['1', 'the command worked, the answer is bad. Read the outcome. Not a crash.'],
	['2', 'you called it wrong. Retrying the same call will not help.'],
	['3', 'the environment is wrong, no key. Stop and fix setup.'],
] as const;

const CURL_BEFORE = 'curl "https://api.scraperapi.com?api_key=KEY&url=..."';
// LOCALHOST, BECAUSE THERE IS NO HOSTED ENDPOINT. This is the one line on the page a reader is
// meant to copy, and it pointed at `api.proxlane.dev` — which answers, with a 401, to a service
// nobody can sign up for. `repo-check.ts` predicted exactly this failure in the comment above
// its DEAD_HOSTS list: a 401 reads as "I set it up wrong", where NXDOMAIN reads as "this does
// not exist yet", which is the truth. The README has said so since it was written; the homepage
// contradicted it two stations from its own quickstart, which prints localhost three times.
const CURL_AFTER = 'curl "http://localhost:8787/v1?api_key=KEY&url=..."';

function Hero({
	scenario,
	onSelect,
}: {
	readonly scenario: Scenario;
	readonly onSelect: (id: ScenarioId) => void;
}) {
	// Spread, not `status={scenario.status}`. Under `exactOptionalPropertyTypes` an explicit
	// `undefined` is not the same as an absent prop, and the exhausted chain has no status —
	// the same distinction the gateway's own `headersFor` makes when it omits a header.
	const statusProp = scenario.status === undefined ? {} : { status: scenario.status };
	return (
		<section>
			<h1 className="max-w-[16ch] text-balance font-bold text-[3rem] leading-[0.98] tracking-[-0.03em] sm:text-[4.25rem] lg:text-[5rem]">
				Your request, rerouted.
			</h1>
			<p className="mt-6 max-w-[52ch] text-[color:var(--color-slate)] text-lg leading-[1.55] sm:mt-7 sm:text-xl">
				One endpoint in front of every scraping API. When a provider gets blocked, the next one
				runs, and you are told which, and why.
			</p>

			{/* THE PROBLEM, BEFORE THE DIAGRAM.
			    The page used to open on a mechanism and never said why anyone needs it: seven
			    sections, five of them internals, all written for someone who had already decided.
			    A visitor who has not hit this problem has no reason to read the taxonomy.

			    Three sentences, no adjectives, and every one of them a fact this project can
			    stand behind. The third is the sharpest and is the one nobody else will print. */}
			<div className="mt-10 max-w-[62ch] border-[color:var(--color-accent)] border-l-2 pl-5 sm:mt-12">
				<p className="text-[0.9375rem] leading-relaxed sm:text-base">
					<span className="font-medium">No provider works on every target.</span>{' '}
					<span className="text-[color:var(--color-slate)]">
						Teams end up with two or three accounts and a pile of glue code that switches
						between them. Providers degrade for hours before they fail outright, and they will
						never fail over to a competitor.
					</span>
				</p>
				<p className="mt-3 text-[0.9375rem] leading-relaxed sm:text-base">
					<span className="font-medium">
						And a blocked request looks like a successful one.
					</span>{' '}
					<span className="text-[color:var(--color-slate)]">
						A captcha page arrives as HTTP 200 with a body. Anything checking status codes
						records a success and stores the challenge page.
					</span>
				</p>
			</div>

			{/* THE SAME FRAME AS EVERY OTHER ARTIFACT. It was the one unframed thing on a page
			    where the curl, the headers and the registry all sit in a labelled panel — and its
			    `chain` label, floating loose above it in the same mono-slate as the tabs beside it,
			    read as a fourth tab rather than as the name of the control. In the bar it is
			    unmistakably a label, and the hero stops being the odd one out. */}
			<figure className="mt-11 sm:mt-14">
				<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
					{/* NO WRAP, AND THE TABS SCROLL. `flex-wrap` put `chain` alone on the first row of a
					    390px phone and the four tabs on the second, which is the floating label the
					    comment above says was fixed by moving it into the bar. It was fixed on a
					    desktop and reintroduced on a phone by the same element.
					    The tabs are a horizontal scroller instead, like every other overflowing thing
					    on the site, with the brand scrollbar saying there is more to the right. */}
					<div className="flex items-center justify-between gap-x-4 border-[color:var(--color-rule)] border-b pr-2 pl-4">
						<span className="shrink-0 font-mono text-[color:var(--color-slate)] text-xs">
							chain
						</span>
						<div className="flex min-w-0 items-center overflow-x-auto">
							{SCENARIOS.map((s) => (
								<ScenarioTab
									key={s.id}
									label={s.label}
									selected={s.id === scenario.id}
									onSelect={() => onSelect(s.id)}
								/>
							))}
						</div>
					</div>

					<div className="overflow-x-auto px-4 py-8 sm:px-6 sm:py-10">
						{/* A floor, not a height. The one-attempt chain is a third the height of the
					    three-attempt one, and without this the whole page jumps every time the
					    selection changes — the switch would be unusable for the thing it exists to
					    let you compare. */}
						<div className="flex min-h-[196px] items-center lg:min-h-[214px]">
							{/* Two geometries, one description. An SVG scales its text with its box, so a
						    single viewBox renders 5px labels on a phone or oversized ones in the hero.
						    Both copies are presentational and the caption below carries the meaning. */}
							<p className="sr-only" aria-live="polite">
								{describeRoute(scenario.attempts, scenario.outcome)}
							</p>
							<RouteDiagram
								attempts={scenario.attempts}
								outcome={scenario.outcome}
								{...statusProp}
								presentation
								interactive
								className="route-map hidden lg:block"
							/>
							<RouteDiagram
								attempts={scenario.attempts}
								outcome={scenario.outcome}
								{...statusProp}
								compact
								presentation
								className="min-w-[336px] max-w-[380px] lg:hidden"
							/>
						</div>
					</div>
				</div>

				<figcaption className="mt-5 min-h-[5.5rem] max-w-[58ch] text-[color:var(--color-slate)] text-sm leading-relaxed sm:min-h-[4.5rem]">
					<span className="text-[color:var(--color-ink)]">A worked example</span>, in the shape
					the gateway returns. {scenario.caption}
				</figcaption>
			</figure>

			{/* ONE CTA COMPONENT, TWO WEIGHTS. These were a filled raspberry rectangle and an
			    outlined one, while the header had a filled raspberry pill: three shapes and two
			    fills for the same job. The accent is now a hairline and a glow rather than a
			    block, so it stays the colour that means "this line is ours". */}
			{/* THE FIRST ONE IS NOW A THING THAT RUNS, not a page that explains. Every CTA here
			    used to lead to more reading — docs, or source — on a site whose whole argument is
			    that you can check the claims yourself. The blueprint deploys a pinned image on
			    the reader's own account, generates the gateway key for them, and asks for one
			    provider key they already pay for. No signup here, because there is nothing here
			    to sign up to. */}
			{/* TWO HOSTS, EACH IN ITS OWN COLOUR, because "deploy" is a decision about where and
			    the reader has already made it. One free button is an offer; two named ones with
			    their prices on them is a choice.

			    THE OTHER TWO ARE LINKS NOW, not pills. Four identical pills gave "Read the
			    source" the same weight as the primary action, and the two carrying prices hung
			    a caption below the row while the other two did not, so the row had a ragged
			    bottom edge. Deploying is the action; docs and source are where you go instead. */}
			<div className="mt-8">
				<DeployRow />
			</div>
			<p className="mt-5 text-[color:var(--color-slate)] text-sm">
				Runs on your account, not ours. Each deploys a blueprint you can{' '}
				<a
					className="underline decoration-[color:var(--color-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]"
					href="https://github.com/proxlane/proxlane/blob/main/render.yaml"
				>
					read first
				</a>
				.
			</p>
			<p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<Link
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 transition-colors duration-200 ease-(--ease-lane) hover:decoration-[color:var(--color-accent)]"
					to="/docs"
				>
					Bring your own keys
				</Link>
				<span aria-hidden="true" className="text-[color:var(--color-rule)]">
					&middot;
				</span>
				<a
					className="text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule)] underline-offset-4 transition-colors duration-200 ease-(--ease-lane) hover:decoration-[color:var(--color-accent)]"
					href="https://github.com/proxlane/proxlane"
				>
					Read the source
				</a>
			</p>
		</section>
	);
}

/**
 * One chain selector.
 *
 * `aria-pressed` rather than a tablist: a tablist owes the user arrow-key navigation and a
 * focus model, and claiming the role without them is worse than not claiming it. These are
 * three toggle buttons, which is what they behave like.
 *
 * The selected state is a rule under the label, not a filled pill — a pill here would be the
 * only filled shape on the page apart from the primary call to action, and would compete with
 * it for the same attention.
 */
function ScenarioTab({
	label,
	selected,
	onSelect,
}: {
	readonly label: string;
	readonly selected: boolean;
	readonly onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			// Named in full rather than leaning on the `chain` label beside it. A wrapper with
			// `role="group"` would carry that association, but the semantic element for it is a
			// `fieldset`, whose `legend` cannot sit at the far end of a flex bar without a fight.
			// A control that says what it does needs no group.
			aria-label={`Show the ${label} chain`}
			// `whitespace-nowrap`, because the bar scrolls now. Without it "first hop" broke over two
			// lines inside its own tab and pushed the bar to double height — the wrap moved from the
			// row down into the button rather than going away.
			className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-2.5 font-mono text-xs transition-colors ${
				selected
					? 'text-[color:var(--color-accent)]'
					: 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'
			}`}
		>
			{/* The rule hugs the LABEL, not the hit box. On the button itself it sat at the bottom
			    of a 44px target while the text was centred in it, leaving the mark floating a
			    clear 14px below the word it was meant to underline. */}
			<span
				className={`border-b-2 pb-1 ${selected ? 'border-[color:var(--color-accent)]' : 'border-transparent'}`}
			>
				{label}
			</span>
		</button>
	);
}

/**
 * The page's own line: one trunk, and a station per section.
 *
 * Hidden below `sm`, where a 56px gutter is a quarter of the screen and the sections are
 * already unambiguously sequential without it.
 */
function Line({ children }: { readonly children: ReactNode }) {
	return (
		<div className="relative mt-24 flex flex-col gap-24 sm:mt-32 sm:gap-32">
			<span
				aria-hidden="true"
				data-trunk
				className="absolute top-[9px] bottom-3 left-[7px] hidden w-px bg-[color:var(--color-rule)] sm:block"
			/>
			{children}
		</div>
	);
}

/**
 * A stop on it: a jog off the trunk, then the docs two-column — narrow prose, wide artifact.
 *
 * NOT a numbered step. The first version had a ringed dot, an `01 /` and an uppercase
 * letter-spaced eyebrow, which is three saturated signals stacked and lands on the generic
 * process-timeline scaffold whatever the metaphor says it is. The number was the load-bearing
 * one — it turns a map into a stepper.
 *
 * The lead is a bolded opening clause and a muted remainder, one paragraph. A flat grey block
 * gives a reader nothing to land on; a heading plus a second heading is two things competing.
 */
/**
 * Is this station the one the reader is at?
 *
 * The page is a transit line, so the section you have scrolled to is the stop you are
 * standing at, and its artifact is what you are meant to be looking at. Lighting it up is the
 * metaphor doing work rather than being described.
 *
 * The band is 20%-40% down the viewport, not the middle. A section becomes active when its
 * content reaches the place people actually read, which is above centre; keyed to the centre
 * it lights up long after you have started reading it.
 *
 * Returns false when IntersectionObserver is unavailable, so every panel simply renders in
 * its resting state. The highlight is emphasis, never the only way to tell panels apart.
 */
function useAtStation(ref: React.RefObject<HTMLElement | null>): boolean {
	const [here, setHere] = useState(false);
	useEffect(() => {
		const node = ref.current;
		if (node === null || typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver(([entry]) => setHere(entry?.isIntersecting === true), {
			rootMargin: '-20% 0px -60% 0px',
			threshold: 0,
		});
		io.observe(node);
		return () => io.disconnect();
	}, [ref]);
	return here;
}

function Station({
	label,
	title,
	lead,
	wide = false,
	children,
}: {
	readonly label: string;
	readonly title: string;
	readonly lead: readonly [string, string];
	/**
	 * Put the artifact under the heading at full width instead of beside it.
	 *
	 * ARITHMETIC, not taste. The side-by-side artifact column is 528px, which at 13px in this
	 * mono holds 56 characters; a `proxlane scrape` invocation is 70 and the widest line of
	 * `outcomes --json` is 68. No type-size tweak closes that — 11px still only buys 66 — so a
	 * transcript in the narrow column wraps to column zero and throws away the indentation
	 * that makes it readable. Full width gives ~98 characters and nothing wraps at all.
	 */
	readonly wide?: boolean;
	readonly children: ReactNode;
}) {
	const section = useRef<HTMLElement>(null);
	const here = useAtStation(section);
	const heading = (
		<>
			<p className="font-mono text-[color:var(--color-accent)] text-xs">{label}</p>
			<h2 className="mt-3 text-balance font-medium text-[1.75rem] leading-[1.12] tracking-[-0.02em] sm:text-[2.125rem]">
				{title}
			</h2>
		</>
	);
	const prose = (
		<p className="max-w-[62ch] text-[0.9375rem] leading-relaxed">
			<span className="font-medium">{lead[0]}</span>{' '}
			<span className="text-[color:var(--color-slate)]">{lead[1]}</span>
		</p>
	);

	return (
		<section
			ref={section}
			data-station
			data-here={here ? '' : undefined}
			className="relative sm:pl-14"
		>
			{/* The tick joining this stop to the trunk. It takes the accent with the panel, so the
			    highlight reads as a position on the line rather than as a box that lit up. */}
			<span
				aria-hidden="true"
				data-tick
				className="absolute top-[9px] left-[7px] hidden h-px w-7 bg-[color:var(--color-rule)] transition-colors duration-300 sm:block"
			/>
			{wide ? (
				<div>
					{/* Title left, prose right, artifact across both. Keeps the horizontal reading
					    the other stations have rather than collapsing to one stacked column. */}
					<div className="lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-x-14">
						<div>{heading}</div>
						<div className="mt-4 lg:mt-0">{prose}</div>
					</div>
					<div className="mt-8 min-w-0">{children}</div>
				</div>
			) : (
				<div className="grid gap-y-8 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-x-14">
					<div>
						{heading}
						<div className="mt-4">{prose}</div>
					</div>
					<div className="min-w-0">{children}</div>
				</div>
			)}
		</section>
	);
}

/**
 * What this costs, which the page did not say at all.
 *
 * A visitor could not tell whether Proxlane charged them, and the failover caption saying
 * "all three attempts are billed" read as a threat rather than as a fact about providers.
 *
 * THE THIRD ROW IS DELIBERATELY MARKED UNAVAILABLE. `CLAUDE.md` puts hosted credits in phase
 * three, gated on a margin decision that `plan.md` section 7 has not settled, and the house
 * rule is that shipped behaviour only gets advertised. The rate is printed because the README
 * already commits to it; the availability is printed because pretending it is buyable today
 * would be the exact dishonesty this product is positioned against.
 */
function Pricing() {
	const rows: readonly {
		readonly plan: string;
		readonly price: string;
		readonly note: string;
		readonly available: boolean;
	}[] = [
		{
			plan: 'Bring your own keys',
			price: 'Free forever',
			note: 'Your provider keys, your provider bill. Proxlane adds nothing to it.',
			available: true,
		},
		{
			plan: 'Self-host',
			price: 'Free forever',
			note: 'AGPL-3.0. One container, your infrastructure, no telemetry.',
			available: true,
		},
		{
			plan: 'Hosted credits',
			price: 'Provider cost + 5%',
			note: 'Not available yet. One bill instead of three, when it lands.',
			available: false,
		},
	];
	return (
		<Panel label="pricing">
			<ul className="flex flex-col">
				{rows.map((row) => (
					<li
						key={row.plan}
						className="flex flex-col gap-1 border-[color:var(--color-rule)] border-b py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
					>
						<span className="min-w-[11rem] font-medium text-[color:var(--color-ink)] text-sm">
							{row.plan}
						</span>
						<span
							className={`min-w-[9rem] font-mono text-xs ${
								row.available
									? 'text-[color:var(--color-accent)]'
									: 'text-[color:var(--color-slate)]'
							}`}
						>
							{row.price}
						</span>
						<span className="text-[color:var(--color-slate)] text-sm">{row.note}</span>
					</li>
				))}
			</ul>
		</Panel>
	);
}

/**
 * The on-ramp, and the honest scope of each surface.
 *
 * `scrape.ts` states it plainly and so does this: the CLI runs ONE provider with no chain and
 * NO DETECTION, because routing lives in the gateway and a second implementation would drift
 * from it. Claiming the detector here would be the easy sentence and the false one.
 */
function Quickstart() {
	return (
		<Panel label="terminal" copy={QUICKSTART_COPY} what="the run command">
			<Transcript blocks={QUICKSTART_BLOCKS} />
		</Panel>
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
		<Panel label="curl" copy={CURL_AFTER} what="the proxlane request">
			<pre className="font-mono text-[0.8125rem] leading-[2]">
				<code>
					<span className="text-[color:var(--color-slate)] line-through decoration-1">
						{CURL_BEFORE}
					</span>
					{'\n'}
					<span className="text-[color:var(--color-accent)]">{CURL_AFTER}</span>
				</code>
			</pre>
		</Panel>
	);
}

/**
 * The wire, next to the picture.
 *
 * The page had exactly one piece of real output on it — a two-line curl — which is why it read
 * as a brochure for a technical product rather than as one. What a gateway returns IS the
 * product surface, and every claim the page makes is checkable against these lines.
 */
function Response({ scenario }: { readonly scenario: Scenario }) {
	const headers = headersFor(scenario);
	const raw = headers.map(([n, v]) => `${n}: ${v}`).join('\n');
	const served = scenario.attempts.some((a) => a.outcome === 'OK');
	return (
		<div>
			<Panel
				label={
					scenario.status === undefined ? 'HTTP/1.1 502' : `HTTP/1.1 ${scenario.status} OK`
				}
				copy={raw}
				what="the response headers"
			>
				{/*
				 * `minmax(0, 1fr)`, NOT `1fr`, and the name column never wraps.
				 *
				 * A `1fr` track carries `min-width: auto`, so it refuses to shrink below its own
				 * content. `x-chain` is the longest value on the page by a wide margin, and it took
				 * the space out of the `auto` column beside it: the header NAMES started breaking
				 * mid-word — `x-` / `outcome-` / `class` — while the chain itself still overflowed
				 * the panel and clipped. Both symptoms, one cause.
				 *
				 * So the value track is allowed to shrink, the names are `nowrap` because a header
				 * name broken across lines is not a header name, and a value too long for one line
				 * wraps instead of running out of the box. `break-all` rather than `break-words`:
				 * a chain has no spaces to break at.
				 */}
				{/* SCROLLS, DOES NOT WRAP. `x-chain` is one token with no spaces, so wrapping it broke
				    the value across two lines mid-identifier and made a three-hop chain unreadable on a
				    phone. A header value is a single string: it belongs on one line, and the line
				    belongs in a scroller. `Panel` already gives the body `overflow-x-auto`, and the
				    scrollbar is the brand raspberry, so the affordance says "there is more". */}
				<dl className="grid w-max grid-cols-[auto_minmax(0,1fr)] gap-x-10 font-mono text-[0.8125rem] leading-[2]">
					{headers.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="whitespace-nowrap text-[color:var(--color-slate)]">{name}</dt>
							<dd className="whitespace-nowrap">{value}</dd>
						</div>
					))}
				</dl>
			</Panel>
			{!served && (
				<p className="mt-4 max-w-[58ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
					<span className="font-mono text-[color:var(--color-ink)]">x-provider-used</span> is
					absent, not empty. Nothing served, so there is nothing honest to put there.
				</p>
			)}
		</div>
	);
}

/**
 * Every shipped adapter, as the lines they are.
 *
 * Not a feature grid: a legend, which is what a map puts its line colours in. The colour is
 * the same token the hero drawing strokes with, so the mapping a reader learns here is the
 * one that holds on the dashboard and in the docs.
 */
function Lines() {
	return (
		<Panel label="proxlane providers" bodyClass="px-3 py-1 sm:px-4">
			<table className="w-full font-mono text-[0.8125rem]">
				<thead>
					<tr className="text-[color:var(--color-slate)] text-xs">
						<th scope="col" className="py-3 text-left font-normal">
							provider
						</th>
						<th scope="col" className="py-3 text-left font-normal">
							geo
						</th>
						<th scope="col" className="py-3 text-left font-normal">
							sessions
						</th>
						<th scope="col" className="py-3 text-right font-normal">
							render-js
						</th>
					</tr>
				</thead>
				<tbody>
					{LAUNCH_LINES.map(({ id, line, geo, sessions, js }) => (
						<tr key={id} className="group border-[color:var(--color-rule)] border-t">
							<th scope="row" className="py-3 pr-4 text-left font-medium sm:pr-6">
								<span className="flex items-center gap-3">
									<span
										aria-hidden="true"
										className="h-[3px] w-8 shrink-0 rounded-interchange transition-[height] duration-200 group-hover:h-[5px]"
										style={{ background: `var(--color-line-${line})` }}
									/>
									{id}
								</span>
							</th>
							<td className="py-3 pr-4 text-[color:var(--color-slate)] sm:pr-6">{geo}</td>
							<td className="py-3 pr-4 text-[color:var(--color-slate)] sm:pr-6">
								{sessions ? 'yes' : 'no'}
							</td>
							<td className="py-3 text-right text-[color:var(--color-slate)]">&times;{js}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Panel>
	);
}

/**
 * The agent surface, which is the CLI, and it is shipped rather than promised.
 *
 * NO MCP SERVER IS CLAIMED. `packages/sdk` is one file today and the MCP server named in
 * `CLAUDE.md` does not exist yet; `state.md` says the same about `npx proxlane try` and the
 * playground. The house rule is shipped behaviour only, so this section advertises exactly
 * what `proxlane --help` prints and what `.claude/skills/use-proxlane/SKILL.md` documents.
 *
 * The transcript is real output, captured by running the built CLI.
 */
function Agents() {
	return (
		<div className="flex flex-col gap-5">
			<Panel label="terminal" copy={CLI_COMMAND} what="the command">
				<Transcript blocks={AGENT_BLOCKS} />
			</Panel>

			<Panel label="exit codes" bodyClass="px-4 py-1">
				<dl className="grid grid-cols-[auto_1fr] gap-x-6 font-mono text-[0.8125rem]">
					{EXIT_CODES.map(([code, meaning], i) => (
						<div
							key={code}
							className={`col-span-2 grid grid-cols-subgrid py-3 ${i > 0 ? 'border-[color:var(--color-rule)] border-t' : ''}`}
						>
							<dt className="font-medium">{code}</dt>
							<dd className="text-[color:var(--color-slate)]">{meaning}</dd>
						</div>
					))}
				</dl>
			</Panel>
		</div>
	);
}

/**
 * The differentiator, stated as behaviour rather than as an adjective.
 *
 * Prose, not a card grid and not the hero-metric template. The first version was three
 * same-size cells of numeral, label and body — the one page scaffold every generated landing
 * page reaches for. Three claims that each need a sentence do not need three boxes; they need
 * three sentences and a rule between them.
 */
function Honesty() {
	const facts = [
		[
			'The detector reads the body.',
			'A block page returns 200 with a body. The detector calls it SOFT_BLOCK and attaches the rule that fired, so you can see why rather than trust that we looked.',
		],
		[
			'The taxonomy can grow without breaking you.',
			'19 outcomes, 6 classes. Branch on the class, which never grows; read the outcome for detail. Adding an outcome cannot break your switch.',
		],
		[
			'Failed attempts are still billed, and still reported.',
			'Every attempt is priced, including the ones that failed. A failover that burned two charged hops reports two, not one.',
		],
	] as const;
	return (
		<dl className="flex flex-col">
			{facts.map(([term, detail], i) => (
				<div
					key={term}
					className={`flex flex-col gap-1.5 py-5 ${i > 0 ? 'border-[color:var(--color-rule)] border-t' : ''} ${i === 0 ? 'pt-0' : ''}`}
				>
					<dt className="font-medium">{term}</dt>
					<dd className="max-w-[62ch] text-[color:var(--color-slate)] text-[0.9375rem] leading-relaxed">
						{detail}
					</dd>
				</div>
			))}
		</dl>
	);
}
