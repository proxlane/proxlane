import { describeRoute, type RouteAttempt, RouteDiagram } from '@proxlane/route-viz';
import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/')({ component: Home });

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
						'Every adapter declares its env var.',
						'The key already in your environment is found without configuration. The CLI runs one provider and names the result; the gateway is what adds the chain and the detector.',
					]}
				>
					<Quickstart />
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
					label="lines"
					title="Three providers, three lines"
					lead={[
						'They are not interchangeable, which is the point.',
						'Printed by proxlane providers, straight from the capability registry. One does sessions, one is limited to seven regions, and rendering JavaScript costs twice as much on one as on the others. A line colour is assigned here too, and every surface reuses it.',
					]}
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
				<Station
					label="detection"
					title="A 200 is not a success"
					lead={[
						'Every competitor reports a block page as a success,',
						'because saying otherwise costs them a number. Three behaviours instead of the adjective.',
					]}
				>
					<Honesty />
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
};

interface Scenario {
	readonly id: string;
	readonly label: string;
	readonly attempts: readonly RouteAttempt[];
	/** The outcome the caller received. */
	readonly outcome: string;
	readonly status?: number;
	/** `X-Cost-Estimate`, six decimal places, summed across every attempt. */
	readonly cost: string;
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
		cost: '0.004200',
		caption:
			'The first provider answered 200 with a challenge page and the detector named the rule that caught it; the second failed outright; the third served. All three attempts are billed, and all three are reported.',
	},
	{
		id: 'direct',
		label: 'first hop',
		attempts: [{ provider: 'scraperapi', outcome: 'OK', line: 1, latencyMs: 980 }],
		outcome: 'OK',
		status: 200,
		cost: '0.001400',
		caption:
			'The ordinary case, and the one the cost model is built around: the first provider served, the chain stopped, and you were charged for one attempt.',
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
		cost: '0.004600',
		caption:
			'Every provider blocked. The chain reports the last outcome rather than inventing one, and no provider served, so x-provider-used is absent from the response rather than empty. You are still told what was tried, and still charged for it.',
	},
];

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
	return [
		['x-outcome', s.outcome],
		['x-outcome-class', OUTCOME_CLASS[s.outcome] ?? 'gateway'],
		['x-attempts', String(s.attempts.length)],
		...(served === undefined
			? []
			: ([['x-provider-used', served.provider]] as readonly (readonly [string, string])[])),
		['x-cost-estimate', s.cost],
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
 * pick anything. These four columns are the ones that differ between the three, which is the
 * whole argument for routing across them rather than picking one.
 */
const LAUNCH_LINES = [
	{ id: 'scraperapi', line: 1, geo: 'all', sessions: true, js: 10 },
	{ id: 'scrapingbee', line: 2, geo: '7 regions', sessions: false, js: 5 },
	{ id: 'scrapfly', line: 3, geo: 'all', sessions: false, js: 5 },
] as const;

/**
 * Real output from `proxlane outcomes SOFT_BLOCK --json`, pasted verbatim.
 *
 * Every CLI command takes `--json`, which is the whole agent story and is shipped today — so
 * this is a transcript, not a mock-up. `chargeable: false` is hosted billing, which only ever
 * charges on OK; the provider still charged for the attempt, which is what `x-cost-estimate`
 * reports.
 */
interface Block {
	readonly cmd?: string;
	readonly out?: string;
}

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
 */
const QUICKSTART_BLOCKS: readonly Block[] = [
	{ cmd: 'npx proxlane doctor' },
	{
		out: `
  ok   key:scraperapi     $SCRAPERAPI_KEY set (32 chars)
  ok   key:scrapingbee    $SCRAPINGBEE_KEY set (80 chars)
  ok   cooldowns          on. A provider that just refused a domain is skipped
`,
	},
	{ cmd: 'npx proxlane scrape https://example.com --provider=scraperapi --json' },
];

const AGENT_BLOCKS: readonly Block[] = [{ cmd: CLI_COMMAND }, { out: CLI_OUTPUT }];

const QUICKSTART_COPY = 'npx proxlane scrape https://example.com --provider=scraperapi --json';

/** Straight from `.claude/skills/use-proxlane/SKILL.md`, which ships in the repo. */
const EXIT_CODES = [
	['0', 'good, proceed'],
	['1', 'the command worked, the answer is bad. Read the outcome. Not a crash.'],
	['2', 'you called it wrong. Retrying the same call will not help.'],
	['3', 'the environment is wrong, no key. Stop and fix setup.'],
] as const;

const CURL_BEFORE = 'curl "https://api.scraperapi.com?api_key=KEY&url=..."';
const CURL_AFTER = 'curl "https://api.proxlane.dev/v1?api_key=KEY&url=..."';

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

			{/* THE SAME FRAME AS EVERY OTHER ARTIFACT. It was the one unframed thing on a page
			    where the curl, the headers and the registry all sit in a labelled panel — and its
			    `chain` label, floating loose above it in the same mono-slate as the tabs beside it,
			    read as a fourth tab rather than as the name of the control. In the bar it is
			    unmistakably a label, and the hero stops being the odd one out. */}
			<figure className="mt-11 sm:mt-14">
				<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
					<div className="flex flex-wrap items-center justify-between gap-x-6 border-[color:var(--color-rule)] border-b pr-2 pl-4">
						<span className="font-mono text-[color:var(--color-slate)] text-xs">chain</span>
						<div className="flex items-center">
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

			<div className="mt-8 flex flex-wrap items-center gap-3">
				<a
					href="/docs"
					className="inline-flex min-h-12 items-center rounded-card bg-[color:var(--color-accent)] px-6 font-medium text-[0.9375rem] text-[color:var(--color-ground)] transition-opacity hover:opacity-85"
				>
					Bring your own keys
				</a>
				<a
					href="https://github.com/proxlane/proxlane"
					className="inline-flex min-h-12 items-center rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-6 font-medium text-[0.9375rem] transition-colors hover:border-[color:var(--color-ink)]"
				>
					Read the source
				</a>
			</div>
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
			className={`inline-flex min-h-11 items-center px-2.5 font-mono text-xs transition-colors ${
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
		<section className="relative sm:pl-14">
			<span
				aria-hidden="true"
				className="absolute top-[9px] left-[7px] hidden h-px w-7 bg-[color:var(--color-rule)] sm:block"
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
 * Copy to clipboard, with the one state that matters shown.
 *
 * A code block a developer cannot copy is a picture of code. The confirmation is a label
 * change rather than a toast: the feedback belongs on the control that was pressed, and
 * `aria-live` is what carries it to anyone who cannot see the swap.
 */
function CopyButton({ text, what }: { readonly text: string; readonly what: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Clearing on unmount is not tidiness: a section can leave the tree while the 2s timer is
	// still pending, and setting state after that logs a warning and leaks the handle.
	useEffect(() => () => clearTimeout(timer.current), []);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Denied permission, or no clipboard in this context. Say nothing rather than claim
			// a copy that did not happen — a false "Copied" is worse than a button that did not
			// visibly respond, because the paste fails somewhere else entirely.
			return;
		}
		setCopied(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), 2000);
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={`Copy ${what}`}
			// 44px, and the panel bar carries no padding of its own so this control sets the bar's
			// height rather than stacking with it.
			className={`-mr-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-card px-2 font-mono text-xs transition-colors ${copied ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'}`}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{copied ? (
					<path d="M3 8.5 6.5 12 13 4.5" />
				) : (
					<>
						<rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5" />
						<path d="M10.25 3.25a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5" />
					</>
				)}
			</svg>
			<span aria-live="polite">{copied ? 'copied' : 'copy'}</span>
		</button>
	);
}

/**
 * A terminal session: the command types, the output streams in line by line, the caret keeps
 * blinking.
 *
 * TYPING IS CHARACTER-WISE ON COMMANDS AND LINE-WISE ON OUTPUT, because that is how a shell
 * behaves — you type an instruction, the program emits rows. Revealing the output as one block
 * made the panel jump fifteen lines taller the instant it appeared, and character-typing it
 * would hold a reader off the content for the sake of an effect.
 *
 * THE HEIGHT IS RESERVED. A hidden copy of the finished transcript sits in the same grid cell,
 * so the panel is full height from the first frame and nothing below it moves. `visibility`
 * rather than `opacity`, because only the former keeps the box while dropping it from the
 * accessibility tree.
 *
 * It starts on scroll-into-view, once. State begins COMPLETE so the server renders the whole
 * transcript and hydration matches; an effect rewinds it before typing, so there is no flash
 * of finished text and no animation at all when JavaScript never arrives or motion is refused.
 *
 * The visible copy is `aria-hidden` with the full text alongside in an `sr-only` node:
 * mid-animation the DOM genuinely holds a truncated command, and a screen reader must never be
 * handed half an instruction.
 */
const CHARS_PER_TICK = 2;

function Transcript({ blocks }: { readonly blocks: readonly Block[] }) {
	const units = blocks.map((b) =>
		b.cmd === undefined
			? (b.out ?? '').split('\n').length
			: Math.ceil(b.cmd.length / CHARS_PER_TICK),
	);
	const total = units.reduce((n, u) => n + u, 0);
	const [step, setStep] = useState(total);
	const ref = useRef<HTMLDivElement | null>(null);
	const plan = useRef({ blocks, units });
	plan.current = { blocks, units };

	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		setStep(0);
		let timer: ReturnType<typeof setTimeout> | undefined;
		// A row of output should not arrive as fast as a keystroke; the two rates are what make
		// it read as a program answering rather than as text appearing.
		const paceAt = (n: number): number => {
			const { blocks: bs, units: us } = plan.current;
			let acc = 0;
			for (let i = 0; i < bs.length; i++) {
				acc += us[i] ?? 0;
				if (n < acc) return bs[i]?.cmd === undefined ? 46 : 26;
			}
			return 26;
		};
		const tick = (n: number): void => {
			if (n >= total) return;
			timer = setTimeout(() => {
				setStep(n + 1);
				tick(n + 1);
			}, paceAt(n));
		};
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					tick(0);
				}
			},
			{ threshold: 0.25 },
		);
		io.observe(node);
		return () => {
			io.disconnect();
			clearTimeout(timer);
		};
	}, [total]);

	const full = blocks.map((b) => (b.cmd === undefined ? b.out : `$ ${b.cmd}\n`)).join('');
	const preClass =
		'col-start-1 row-start-1 whitespace-pre-wrap break-words font-mono text-[0.8125rem] leading-[1.9]';

	const endsOnOutput = blocks[blocks.length - 1]?.cmd === undefined;
	let before = 0;
	const shown = blocks.map((b, i) => {
		const start = before;
		const size = units[i] ?? 0;
		before += size;
		const local = Math.max(0, Math.min(step - start, size));
		if (local === 0) return null;
		const key = `${i}-${(b.cmd ?? b.out ?? '').slice(0, 24)}`;

		if (b.cmd === undefined) {
			return (
				<span key={key} className="text-[color:var(--color-slate)]">
					{(b.out ?? '').split('\n').slice(0, local).join('\n')}
				</span>
			);
		}
		return (
			<span key={key}>
				<span className="select-none text-[color:var(--color-accent)]">$ </span>
				<span className="font-medium">{b.cmd.slice(0, local * CHARS_PER_TICK)}</span>
				{local === size ? '\n' : ''}
			</span>
		);
	});

	return (
		<div ref={ref} className="grid">
			<p className="sr-only">{full}</p>
			<pre aria-hidden="true" className={`${preClass} invisible`}>
				{full}
			</pre>
			<pre aria-hidden="true" data-transcript className={preClass}>
				<code>
					{shown}
					{/* A shell that has finished printing returns to a fresh prompt on its own line.
					    Left inline the caret sat against the closing brace of the JSON, which reads
					    as a cursor stuck mid-token rather than a session waiting for you. A
					    transcript ending on a command needs no new prompt: you are still typing it. */}
					{endsOnOutput && step >= total && (
						<>
							{'\n'}
							<span className="select-none text-[color:var(--color-accent)]">$ </span>
						</>
					)}
					<span className="proxlane-caret text-[color:var(--color-accent)]">▊</span>
				</code>
			</pre>
		</div>
	);
}

/**
 * The frame every artifact on this page shares.
 *
 * A bare `<pre>` on the page background is what a text file looks like. The label bar names
 * what the block IS — `curl`, `HTTP/1.1 200 OK` — which is the line a developer reads first,
 * and it gives the copy control somewhere to live that is not floating over the code.
 *
 * Opaque, and lifted. The field runs behind the whole document, so a transparent panel would
 * have grid lines running under its code; the ground plus a shadow is what makes it paper on
 * top of a drawing surface rather than a rectangle drawn on one.
 */
function Panel({
	label,
	copy,
	what,
	bodyClass = 'p-4',
	children,
}: {
	readonly label: string;
	readonly copy?: string;
	readonly what?: string;
	/** Override when the body brings its own vertical rhythm, as a ruled list does. */
	readonly bodyClass?: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel transition-colors duration-200 hover:border-[color:var(--color-slate)]">
			{/* min-h on the BAR, not on the copy button. The bar used to take its height from the
			    button, which meant a panel without one — the registry — had a label sitting flat on
			    the border with no padding at all. Height must not depend on an optional child. */}
			<div className="flex min-h-11 items-center justify-between gap-4 border-[color:var(--color-rule)] border-b pr-2.5 pl-4">
				<span className="font-mono text-[color:var(--color-slate)] text-xs">{label}</span>
				{copy !== undefined && what !== undefined && <CopyButton text={copy} what={what} />}
			</div>
			<div className={`overflow-x-auto ${bodyClass}`}>{children}</div>
		</div>
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
		<Panel label="terminal" copy={QUICKSTART_COPY} what="the scrape command">
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
				<dl className="grid w-fit grid-cols-[auto_1fr] gap-x-10 font-mono text-[0.8125rem] leading-[2]">
					{headers.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="text-[color:var(--color-slate)]">{name}</dt>
							<dd>{value}</dd>
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
 * The three launch adapters, as the three lines they are.
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
			'18 outcomes, 6 classes. Branch on the class, which never grows; read the outcome for detail. Adding an outcome cannot break your switch.',
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
