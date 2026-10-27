/**
 * A replay of an agent calling `fetch_page`, drawn on the page rather than recorded.
 *
 * NOT A SCREEN RECORDING, deliberately. A video of one vendor's chat window dates with its next
 * redesign, weighs megabytes, and shows a product we do not make. This is the site's own type and
 * the same `RouteDiagram` the hero uses, so the chain an agent sees can never disagree with the
 * chain the gateway draws, and it re-renders for whichever client is selected above it.
 */

import { describeRoute, type RouteAttempt, RouteDiagram } from '@proxlane/route-viz';
import { useEffect, useRef, useState } from 'react';
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
		result: `{ "ok": true, "provider": "scrapfly",
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
		result: `{ "ok": false, "outcome": "HARD_BLOCK",
  "class": "blocked", "retryable": true }`,
		answer:
			'Every provider was blocked by a bot check on that page, so I have nothing to read and will not guess at the price. Worth trying again later, not right now.',
	},
];

/** When each beat lands, in ms from the start. The answer then types at `CHAR_MS` a character. */
const BEATS = [0, 650, 1300, 2600, 3300] as const;
const CHAR_MS = 14;

/**
 * The beats of one run: the ask, the tool call, the chain, the result, the answer.
 *
 * SAME CONTRACT AS `Transcript`: state starts complete so the server renders the finished
 * conversation and hydration matches, an effect rewinds it only when motion is allowed, and it
 * starts when scrolled into view. A run switched to after that replays at once, because the reader
 * asked for it.
 */
function useReplay(runKey: string, answerLength: number) {
	const [state, setState] = useState<{ beat: number; chars: number }>({
		beat: BEATS.length,
		chars: answerLength,
	});
	const ref = useRef<HTMLDivElement | null>(null);
	const seen = useRef(false);

	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const timers: ReturnType<typeof setTimeout>[] = [];
		const play = () => {
			seen.current = true;
			setState({ beat: 0, chars: 0 });
			BEATS.forEach((at, i) => {
				timers.push(setTimeout(() => setState({ beat: i + 1, chars: 0 }), at));
			});
			const start = BEATS[BEATS.length - 1] ?? 0;
			for (let c = 1; c <= answerLength; c++) {
				timers.push(
					setTimeout(() => setState({ beat: BEATS.length, chars: c }), start + c * CHAR_MS),
				);
			}
		};

		if (seen.current) {
			play();
			return () => timers.forEach(clearTimeout);
		}
		setState({ beat: 0, chars: 0 });
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					play();
				}
			},
			{ threshold: 0.35 },
		);
		io.observe(node);
		return () => {
			io.disconnect();
			timers.forEach(clearTimeout);
		};
		// runKey is the replay trigger: a different run or client starts it again.
	}, [runKey, answerLength]);

	return { ref, ...state };
}

function Conversation({
	run,
	client,
	beat,
	chars,
}: {
	run: Run;
	client: ReplayClient;
	beat: number;
	chars: number;
}) {
	const statusProp = run.status === undefined ? {} : { status: run.status };
	const failed = run.outcome !== 'OK';
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className={beat >= 1 ? 'proxlane-beat' : 'invisible'}>
				<p className="font-mono text-[color:var(--color-slate)] text-xs">you</p>
				<p className="mt-1 text-[0.9375rem]">{ASK}</p>
			</div>

			<div className={beat >= 2 ? 'proxlane-beat' : 'invisible'}>
				<p className="flex items-center gap-1.5 font-mono text-[color:var(--color-slate)] text-xs">
					<ClientMark id={client.mark} className="size-3.5" />
					{client.name.toLowerCase()}
				</p>
				<p className="mt-1 inline-block rounded-card border border-[color:var(--color-rule)] px-2.5 py-1.5 font-mono text-[0.8125rem]">
					<span className="text-[color:var(--color-accent)]">→ </span>
					{CALL}
				</p>
			</div>

			<div className={`min-h-[132px] overflow-x-auto ${beat >= 3 ? '' : 'invisible'}`}>
				{beat >= 3 && (
					<RouteDiagram
						key={`${run.id}-${client.id}`}
						attempts={run.attempts}
						outcome={run.outcome}
						{...statusProp}
						compact
						presentation
						className="w-full min-w-[280px] max-w-[360px]"
					/>
				)}
			</div>

			<pre
				className={`overflow-x-auto whitespace-pre rounded-card border-l-2 py-1 pl-3 font-mono text-[0.75rem] leading-[1.7] ${
					failed ? 'border-[color:var(--color-accent)]' : 'border-[color:var(--color-rule)]'
				} ${beat >= 4 ? 'proxlane-beat' : 'invisible'}`}
			>
				{run.result}
			</pre>

			<p className={`text-[0.9375rem] leading-relaxed ${beat >= 5 ? '' : 'invisible'}`}>
				{run.answer.slice(0, chars)}
				{beat >= 5 && chars < run.answer.length && (
					<span className="proxlane-caret text-[color:var(--color-accent)]">▊</span>
				)}
			</p>
		</div>
	);
}

export function Replay({ client }: { client: ReplayClient }) {
	const [runId, setRunId] = useState<Run['id']>('blocked');
	const run = RUNS.find((r) => r.id === runId) ?? RUNS[0];
	if (run === undefined) throw new Error('RUNS is empty');
	const { ref, beat, chars } = useReplay(`${run.id}-${client.id}`, run.answer.length);

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
				<div ref={ref} className="grid grid-cols-[minmax(0,1fr)] px-4 py-5 sm:px-5">
					{/* Both finished runs, invisible, in the cell the live one plays in: the panel holds
					    the taller one's height from the first frame, so switching runs moves nothing. */}
					{RUNS.map((r) => (
						<div key={r.id} aria-hidden="true" className="invisible col-start-1 row-start-1">
							<Conversation
								run={r}
								client={client}
								beat={BEATS.length}
								chars={r.answer.length}
							/>
						</div>
					))}
					<div aria-hidden="true" className="col-start-1 row-start-1">
						<Conversation run={run} client={client} beat={beat} chars={chars} />
					</div>
					<p className="sr-only" aria-live="polite">
						{`${ASK} ${client.name} calls fetch_page. ${describeRoute(run.attempts, run.outcome)} ${run.answer}`}
					</p>
				</div>
			</div>
			<figcaption className="mt-4 max-w-[58ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
				<span className="text-[color:var(--color-ink)]">A worked example.</span> The tool result
				is the shape the server returns; shop.example is a reserved name, not a site.
			</figcaption>
		</figure>
	);
}
