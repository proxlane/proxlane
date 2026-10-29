/**
 * A replay of an agent calling `fetch_page`, drawn on the page rather than recorded.
 *
 * NOT A SCREEN RECORDING, deliberately. A video of one vendor's chat window dates with its next
 * redesign, weighs megabytes, and shows a product we do not make. This is the site's own type and
 * the same `RouteDiagram` the hero uses, so the chain an agent sees can never disagree with the
 * chain the gateway draws, and it re-renders for whichever client is selected above it.
 */

import {
	describeRoute,
	entranceMs,
	type RouteAttempt,
	RouteDiagram,
} from '@proxlane/route-viz';
import { memo, useEffect, useRef, useState } from 'react';
import { ClientMark, type MarkId, Toggle } from './agent-marks.js';

/** What the replay needs of a client: who is calling the tool. */
export interface ReplayClient {
	readonly id: string;
	readonly name: string;
	readonly mark: MarkId;
}

interface Run {
	readonly id: 'served' | 'blocked';
	readonly attempts: readonly RouteAttempt[];
	readonly outcome: string;
	readonly status?: number;
	/** What the gateway answered: the status line and the three headers the tool reads. */
	readonly response: { readonly line: string; readonly class: string };
	/** What `fetch_page` hands the model, in the shape `packages/sdk/src/server.ts` builds. */
	readonly result: string;
	readonly answer: string;
}

const ASK = 'What does the Team plan cost on shop.example?';
const CALL = 'fetch_page  url: "https://shop.example/pricing"';

/**
 * Two runs of one question. A worked example, captioned as one: `shop.example` is a reserved name
 * with no site behind it, which keeps a named target off the page as well.
 *
 * THE SECOND RUN IS THE ARGUMENT. Hand an agent a plain fetch and a challenge page arrives as a
 * 200 with a body, and it summarises the challenge. Here the block reaches the model as a failure
 * with `retryable`, and the answer is a refusal to guess. The first run uses the quickstart's chain
 * so the page tells one story; the second exhausts the same three lines the hero's does.
 */
const RUNS: readonly Run[] = [
	{
		id: 'served',
		attempts: [
			{
				provider: 'scraperapi',
				outcome: 'SOFT_BLOCK',
				line: 1,
				detectRuleId: 'cf-challenge',
				latencyMs: 1420,
			},
			{ provider: 'scrapfly', outcome: 'OK', line: 3, latencyMs: 1840 },
		],
		outcome: 'OK',
		status: 200,
		response: { line: 'HTTP/1.1 200 OK', class: 'ok' },
		result: `{ "ok": true,
  "provider": "scrapfly",
  "chain": "scraperapi:SOFT_BLOCK>scrapfly:OK" }`,
		answer:
			'Team is $24 per seat a month, billed yearly. The page also lists a free plan for up to three seats.',
	},
	{
		id: 'blocked',
		attempts: [
			{
				provider: 'scraperapi',
				outcome: 'SOFT_BLOCK',
				line: 1,
				detectRuleId: 'cf-challenge',
				latencyMs: 1420,
			},
			{
				provider: 'scrapfly',
				outcome: 'HARD_BLOCK',
				line: 3,
				detectRuleId: 'datadome',
				latencyMs: 1130,
			},
			{
				provider: 'scrapingbee',
				outcome: 'HARD_BLOCK',
				line: 2,
				detectRuleId: 'datadome',
				latencyMs: 890,
			},
		],
		outcome: 'HARD_BLOCK',
		// 502 is HARD_BLOCK's `httpStatus` in `packages/shared/src/outcome.ts`.
		response: { line: 'HTTP/1.1 502', class: 'blocked' },
		result: `{ "ok": false,
  "outcome": "HARD_BLOCK",
  "class": "blocked",
  "retryable": true }`,
		answer:
			'Every provider was blocked by a bot check on that page, so I have nothing to read and will not guess at the price. Worth trying again later, not right now.',
	},
];

/**
 * When each beat lands, in ms from the start: the ask, the call, the chain, the gateway's
 * response, the tool result, the answer.
 *
 * DERIVED FROM THE CHAIN. These were five fixed numbers, and the result arrived on the left while
 * a three-leg chain was still drawing on the right: an agent reading a verdict the gateway had not
 * reached. `entranceMs` is the diagram's own clock, so the response waits for the last leg.
 */
const BEAT_COUNT = 6;
function beatsFor(run: Run): readonly number[] {
	const chain = 1300;
	const response = chain + entranceMs(run.attempts.length) + 150;
	return [0, 650, chain, response, response + 550, response + 1150];
}
/** One character of the answer every this many ms. */
const CHAR_MS = 16;

/**
 * Which beat the replay is on, and whether it is actually playing.
 *
 * SAME CONTRACT AS `Transcript`: state starts complete so the server renders the finished
 * conversation and hydration matches, an effect rewinds it only when motion is allowed, and it
 * starts when scrolled into view. A run switched to after that replays at once, because the reader
 * asked for it.
 *
 * Six state changes per run and no more. The answer used to type through state, one render per
 * character, and every render redrew the conversation, the diagram and both height-reserving
 * copies: about a hundred full renders in two seconds, which is what read as choppy. The typing is
 * CSS now (`Answer`).
 */
function useReplay(runKey: string, beats: readonly number[]) {
	const [state, setState] = useState({ beat: BEAT_COUNT, playing: false });
	const ref = useRef<HTMLDivElement | null>(null);
	const seen = useRef(false);
	const plan = useRef(beats);
	plan.current = beats;

	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const timers: ReturnType<typeof setTimeout>[] = [];
		const play = () => {
			seen.current = true;
			setState({ beat: 0, playing: true });
			plan.current.forEach((at, i) => {
				timers.push(setTimeout(() => setState({ beat: i + 1, playing: true }), at));
			});
		};

		if (seen.current) {
			play();
			return () => timers.forEach(clearTimeout);
		}
		setState({ beat: 0, playing: false });
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					play();
				}
			},
			{ threshold: 0.2 },
		);
		io.observe(node);
		return () => {
			io.disconnect();
			timers.forEach(clearTimeout);
		};
		// runKey is the replay trigger: a different run or client starts it again.
	}, [runKey]);

	return { ref, ...state };
}

/**
 * The answer, typed by CSS: one span per character, each fading in on its own delay. Nothing
 * re-renders while it types. Plain text when not playing, so the server render, a reader who
 * asked for stillness and the height-reserving copies all get the sentence whole.
 */
function Answer({ text, playing }: { text: string; playing: boolean }) {
	if (!playing) return <>{text}</>;
	return (
		<>
			{[...text].map((ch, i) => (
				<span
					key={i}
					style={{ animation: `proxlane-arrive 90ms ease-out ${i * CHAR_MS}ms both` }}
				>
					{ch}
				</span>
			))}
		</>
	);
}

/**
 * The chain the gateway walked, as the hero draws it, and what it sent back. Remounted per run
 * and client, so the legs draw again each time the replay plays.
 */
function Gateway({ run, client, beat }: { run: Run; client: ReplayClient; beat: number }) {
	const statusProp = run.status === undefined ? {} : { status: run.status };
	const rows = [
		['x-outcome', run.outcome],
		['x-outcome-class', run.response.class],
		['x-attempts', String(run.attempts.length)],
	] as const;
	return (
		<div className="flex flex-col gap-6">
			<div className={`min-h-[132px] overflow-x-auto ${beat >= 3 ? '' : 'invisible'}`}>
				{beat >= 3 && (
					<RouteDiagram
						key={`${run.id}-${client.id}`}
						attempts={run.attempts}
						outcome={run.outcome}
						{...statusProp}
						compact
						presentation
						className="w-full min-w-[280px] max-w-[380px]"
					/>
				)}
			</div>
			<div
				className={`border-[color:var(--color-rule)] border-t pt-4 font-mono text-[0.75rem] leading-[1.9] ${beat >= 4 ? 'proxlane-beat' : 'invisible'}`}
			>
				<p className="font-medium">{run.response.line}</p>
				<dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6">
					{rows.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="text-[color:var(--color-slate)]">{name}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}

/**
 * A chat on the left and the gateway beside it, not stacked in one column. Five kinds of thing at
 * one rhythm in a single column read as one dense block. Split, the left reads as a conversation
 * and the right as what the gateway did about it. Below `lg` there is no room beside it, so the
 * gateway drops back in between the call and its result, where it happens.
 */
function Conversation({
	run,
	client,
	beat,
	playing,
}: {
	run: Run;
	client: ReplayClient;
	beat: number;
	playing: boolean;
}) {
	const failed = run.outcome !== 'OK';
	return (
		<div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-10">
			<div className="flex min-w-0 flex-col gap-6">
				<div className={`self-start ${beat >= 1 ? 'proxlane-beat' : 'invisible'}`}>
					<p className="font-mono text-[color:var(--color-slate)] text-xs">you</p>
					<p className="mt-2 rounded-card bg-[color:color-mix(in_oklab,var(--color-ink)_5%,transparent)] px-4 py-2.5 text-[0.9375rem]">
						{ASK}
					</p>
				</div>

				<div className={beat >= 2 ? 'proxlane-beat' : 'invisible'}>
					<p className="flex items-center gap-1.5 font-mono text-[color:var(--color-slate)] text-xs">
						<ClientMark id={client.mark} className="size-3.5" />
						{client.name.toLowerCase()}
					</p>
					<p className="mt-2 inline-block rounded-card border border-[color:var(--color-rule)] px-3 py-2 font-mono text-[0.8125rem]">
						<span className="text-[color:var(--color-accent)]">→ </span>
						{CALL}
					</p>
				</div>

				<div className="lg:hidden">
					<Gateway run={run} client={client} beat={beat} />
				</div>

				<pre
					className={`overflow-x-auto whitespace-pre border-l-2 py-1 pl-4 font-mono text-[0.75rem] leading-[1.8] ${
						failed ? 'border-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)]'
					} ${beat >= 5 ? 'proxlane-beat' : 'invisible'}`}
				>
					{run.result}
				</pre>

				<p
					className={`max-w-[56ch] text-[0.9375rem] leading-relaxed ${beat >= 6 ? '' : 'invisible'}`}
				>
					<Answer key={`${run.id}-${client.id}`} text={run.answer} playing={playing} />
				</p>
			</div>

			<div className="hidden flex-col justify-center rounded-card bg-[color:color-mix(in_oklab,var(--color-ink)_3%,transparent)] px-6 py-8 lg:flex">
				<p className="mb-5 font-mono text-[color:var(--color-slate)] text-xs">
					what the gateway did
				</p>
				<Gateway run={run} client={client} beat={beat} />
			</div>
		</div>
	);
}

/**
 * Both finished runs, invisible, in the cell the live one plays in, so the panel holds the taller
 * one's height from the first frame and switching runs moves nothing. Memoised and still: they
 * render once per client, and `data-reserve` stops the diagrams inside them animating unseen.
 */
const Reserve = memo(function Reserve({ client }: { client: ReplayClient }) {
	return (
		<>
			{RUNS.map((r) => (
				<div
					key={r.id}
					aria-hidden="true"
					data-reserve
					className="invisible col-start-1 row-start-1"
				>
					<Conversation run={r} client={client} beat={BEAT_COUNT} playing={false} />
				</div>
			))}
		</>
	);
});

export function Replay({ client }: { client: ReplayClient }) {
	const [runId, setRunId] = useState<Run['id']>('blocked');
	const run = RUNS.find((r) => r.id === runId) ?? RUNS[0];
	if (run === undefined) throw new Error('RUNS is empty');
	const { ref, beat, playing } = useReplay(`${run.id}-${client.id}`, beatsFor(run));

	return (
		<figure className="flex min-w-0 flex-col">
			<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
				<div className="flex items-center justify-between gap-x-4 border-[color:var(--color-rule)] border-b pr-2 pl-4">
					<span className="shrink-0 font-mono text-[color:var(--color-slate)] text-xs">
						fetch_page
					</span>
					<div className="flex min-w-0 items-center overflow-x-auto font-mono">
						{RUNS.map((r) => (
							<Toggle
								key={r.id}
								selected={r.id === run.id}
								onSelect={() => setRunId(r.id)}
								label={`Replay the run where the page was ${r.id}`}
							>
								<span className="text-xs">{r.id}</span>
							</Toggle>
						))}
					</div>
				</div>
				<div ref={ref} className="grid grid-cols-[minmax(0,1fr)] px-5 py-7 sm:px-8 sm:py-8">
					<Reserve client={client} />
					<div aria-hidden="true" className="col-start-1 row-start-1">
						<Conversation run={run} client={client} beat={beat} playing={playing} />
					</div>
					<p className="sr-only" aria-live="polite">
						{`${ASK} ${client.name} calls fetch_page. ${describeRoute(run.attempts, run.outcome)} The gateway answers ${run.response.line}. ${run.answer}`}
					</p>
				</div>
			</div>
			<figcaption className="mt-4 max-w-[58ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
				<span className="text-[color:var(--color-ink)]">A worked example.</span> The response
				and tool result are the shapes the gateway and server return; shop.example is a reserved
				name, not a site.
			</figcaption>
		</figure>
	);
}
