// The route diagram. A transit map of one request's journey.
//
// `design.md` chose direction D because the metaphor is exact rather than approximate: lines
// are providers, interchanges are failovers, journeys are requests, and no part of the
// vocabulary is left doing nothing.
//
// THE CONSTRAINT THAT SHAPED IT: "the signature element must be real product output, not
// decoration. The hero visual and the dashboard's request timeline should be the same
// component reading the same data shape. A developer audience can tell the difference between
// a diagram OF a system and a diagram FROM a system."
//
// So this takes `Attempt[]` — the same array the gateway puts in `X-Attempts` and in the
// error envelope, and the same rows that become `request_attempts` in the log. There is no
// illustration mode and no sample data baked in. If it renders, something happened.
//
// One component, four jobs: the hero, the dashboard request timeline, the per-domain routing
// map in phase three, and the illustration on every `/targets` page.

import type { CSSProperties } from 'react';

/**
 * One provider attempt.
 *
 * Structurally the gateway's `Attempt`, declared here rather than imported: `route-viz` sits
 * above `shared` in the layer graph but must not depend on `apps/gateway`, and TypeScript is
 * structural so the real type satisfies this one.
 */
export interface RouteAttempt {
	readonly provider: string;
	readonly outcome: string;
	/** `--color-line-N` from the token layer. Comes from the adapter registry. */
	readonly line: 1 | 2 | 3;
	readonly latencyMs?: number;
	readonly detectRuleId?: string;
}

export interface RouteDiagramProps {
	readonly attempts: readonly RouteAttempt[];
	/** The outcome the caller actually received, labelled at the terminus. */
	readonly outcome: string;
	/** Status shown at the terminus, e.g. 200. Omitted when the chain never got one. */
	readonly status?: number;
	/**
	 * Narrow geometry for phone widths.
	 *
	 * An SVG scales its text with its box, so one viewBox cannot serve a 342px phone and a
	 * 900px hero: authored at desktop size the labels render at ~5px on a phone, and authored
	 * at phone size they render half again too large in the hero. The legs shorten instead, so
	 * the drawing stays near 1:1 at both ends of the range and the type holds its size.
	 */
	readonly compact?: boolean;
	/**
	 * Drop the `img` role, the title and the label.
	 *
	 * Set on BOTH copies when a caller renders a compact and a wide variant and swaps them with
	 * CSS: `display: none` hides a node from the accessibility tree, but two labelled images in
	 * the markup is still two, and which one a screen reader reaches depends on the viewport.
	 * The caller supplies one visually-hidden description instead.
	 */
	readonly presentation?: boolean;
	/**
	 * Give each leg a hit band, so pointing at a row can single it out.
	 *
	 * The strokes and glyphs are a few pixels of ink in a wide row; without a band you would be
	 * asking someone to hover a 3px line. The band is the whole row and it is transparent —
	 * `fill="transparent"` rather than `none`, because `none` is not hit-tested.
	 *
	 * The dimming itself is CSS on the consumer side (`:has`), not state here: a re-render per
	 * mousemove to change an opacity is work the compositor already does for free.
	 */
	readonly interactive?: boolean;
	readonly className?: string;
}

/**
 * Geometry, in the diagram's own units.
 *
 * A metro map is DENSE. The first version stretched two providers across 720 units inside a
 * full-width box: long thin lines with the air let out of them. Transit diagrams compress
 * distance deliberately — legibility comes from the interchange, not the length of the run.
 */
function geometry(compact: boolean) {
	return {
		width: compact ? 336 : 900,
		rowHeight: compact ? 62 : 68,
		/* Compact needs more than wide: `request` sits ABOVE the map there rather than beside it,
		   so the top pad has to clear two stacked labels instead of one. At 34 it did not, and
		   `request` printed straight through `scraperapi`. */
		padY: compact ? 48 : 34,
		/** Less than `padY`, because the top pad also has to clear the first row's label and the
		 *  bottom has nothing under it. Equal pads left the plate visibly bottom-heavy. */
		padBottom: compact ? 20 : 22,
		/** A left inset in viewBox units, so `request` is not flush against the plate edge. */
		inset: 5,
		/** Clear of the interchange curve, which bulges to `startX - bulge`. */
		startX: compact ? 34 : 132,
		/**
		 * Distance from the origin marker to the first station.
		 *
		 * The request needs somewhere to start FROM. Printed as a bare word beside the map it
		 * read as a caption on the drawing rather than as its first step, which is what it is.
		 */
		originGap: compact ? 28 : 40,
		/**
		 * Reserved at the right for the outcome label, which is mono and therefore wide.
		 *
		 * Every outcome starts on this one column, whatever its leg did. Ragged outcome labels
		 * — one at 40% of the width, the next at 85% — is the single thing that made the drawing
		 * read as unfinished, and a departures board aligns them for the same reason.
		 */
		/* Sized from a 0.72em advance, which is what this mono face actually measures — the
		   first sizing assumed 0.62 and clipped `PROVIDER_ERROR` off the compact right edge.

		   WIDENED FOR `429 GATEWAY_BUSY`, now the longest label at 16 characters. The previous
		   sizing was cut to `PROVIDER_ERROR` at 14, which fitted 128 on compact exactly; the
		   new label needs 16 x 12 x 0.72 = 138 there and 16 x 13 x 0.72 = 150 on wide — the
		   latter landing on 899.8 of a 900 viewBox, i.e. clipped by arithmetic rather than by
		   luck. Both now carry a margin instead of touching the edge.

		   A terminus label is the one thing in this drawing that must never be cut: it is the
		   answer. If a longer outcome ever lands, this is the number that moves. */
		outcomeGutter: compact ? 144 : 162,
		/** How far short of the terminus a failed leg stops. It did not get there. */
		failLeg: compact ? 96 : 400,
		stationR: 5,
		interchangeR: 6.5,
		terminusR: 6.5,
		/** How far the transfer curve swings left of the line before dropping. */
		bulge: 14,
		/** Label baseline above its own line. */
		labelRise: 15,
	} as const;
}

/** `1840` reads as a number; `1.8s` reads as a duration. */
function duration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const lineVar = (n: 1 | 2 | 3): string => `var(--color-line-${n})`;

/** An outcome that ended the journey successfully. Everything else is a transfer or a stop. */
const isOk = (outcome: string): boolean => outcome === 'OK';

/**
 * A one-sentence description of the journey, for anyone not looking at it.
 *
 * The diagram carries information rather than decoration, so a real text alternative is
 * required, not a nicety. `design.md`'s quality floor: Lighthouse accessibility 100.
 */
export function describeRoute(attempts: readonly RouteAttempt[], outcome: string): string {
	if (attempts.length === 0) return `No provider was tried. Outcome ${outcome}.`;
	const legs = attempts.map((a, i) => {
		const via = i === 0 ? 'Tried' : 'then';
		return `${via} ${a.provider}, ${a.outcome}`;
	});
	return `${legs.join('. ')}. Final outcome ${outcome}.`;
}

export function RouteDiagram({
	attempts,
	outcome,
	status,
	compact = false,
	presentation = false,
	interactive = false,
	className,
}: RouteDiagramProps) {
	const geo = geometry(compact);
	const rows = Math.max(attempts.length, 1);
	// padY once below, not twice: the rows already carry their own leading.
	const height = geo.padY + (rows - 1) * geo.rowHeight + geo.padBottom;
	/** The one column every outcome label starts on. */
	const outcomeX = geo.width - geo.outcomeGutter;
	const endX = outcomeX - 14;
	const firstY = geo.padY;
	const originX = geo.startX - geo.originGap;
	const description = describeRoute(attempts, outcome);

	// Every label is data — a provider id, an outcome constant, a status code — so all of it is
	// mono. The first version mixed a sans provider name with mono outcomes inside one small
	// drawing, which put three type treatments in a space the size of a business card and made
	// the outcome constant read louder than the provider it described.
	const labelSize = compact ? 12 : 13;

	// The rule accepts a `title`, or role="img" with a label, and the non-presentation branch
	// supplies both. It does not recognise `aria-hidden`, which is the correct marking for the
	// presentation copies: the caller renders the description once, outside, because two
	// CSS-swapped variants would otherwise announce the same journey twice.
	return (
		// biome-ignore lint/a11y/noSvgWithoutTitle: labelled when it is an image, hidden when it is not
		<svg
			viewBox={`${-geo.inset} 0 ${geo.width + geo.inset} ${height}`}
			className={className}
			{...(presentation
				? { 'aria-hidden': true as const }
				: { role: 'img' as const, 'aria-label': description })}
			style={{ width: '100%', height: 'auto' } satisfies CSSProperties}
		>
			{!presentation && <title>{description}</title>}

			{/* THE ORIGIN. Drawn before the legs so the first interchange curve overlays its tail,
			    which is what makes the junction read as one drawing rather than two.
			    Ink, not a line colour: the request belongs to no provider yet. The colour change at
			    the first station is then meaningful — that is the point where your request becomes
			    somebody's line. Filled marker for the origin, hollow for an interchange, ringed for
			    a terminus: three station types, the same vocabulary a map already uses. */}
			<line
				x1={originX}
				y1={firstY}
				x2={geo.startX}
				y2={firstY}
				stroke="var(--color-ink)"
				strokeWidth="var(--stroke-line, 3)"
				strokeLinecap="round"
			/>
			<circle cx={originX} cy={firstY} r={compact ? 3.5 : 4} fill="var(--color-ink)" />

			<text
				x={compact ? 0 : originX - 12}
				y={compact ? 12 : firstY + 4}
				textAnchor={compact ? 'start' : 'end'}
				fill="var(--color-ink)"
				fontSize={labelSize}
				fontWeight="500"
				fontFamily="var(--font-mono)"
			>
				request
			</text>

			{/* NO LANE WAS ENTERED, which is a real answer and not an empty drawing.
			    Everything below lives inside `attempts.map`, so a chain with no attempts used to
			    render as a dot and the word `request` — a diagram that looks broken rather than
			    one that says the request was refused before any provider was chosen.

			    Drawn ENTIRELY IN INK, and that is the whole point. The origin stub above is
			    already ink because "the request belongs to no provider yet"; the colour change at
			    the first station is where it becomes somebody's line. A request the gateway sheds
			    never gets that far, so it stays ink to the stop mark — the vocabulary already
			    says what happened before a single label is read.

			    The stop is struck at the same place a failed leg stops, so a shed request and a
			    refused one line up in the same column across scenarios. */}
			{attempts.length === 0 && (
				<g>
					{/* RUNS THE FULL WIDTH, unlike a failed provider leg.
					    A failed leg stops short because it did not reach the terminus — there was a
					    provider out there and it did not deliver. A shed request has no such
					    distance to fall short of: the gateway IS the endpoint, and it refused at the
					    door. Stopping short here drew a line ending in mid-air with the outcome
					    stranded far to its right, which reads as a rendering fault rather than as a
					    refusal. */}
					<line
						x1={geo.startX}
						y1={firstY}
						x2={endX - 9}
						y2={firstY}
						stroke="var(--color-ink)"
						strokeWidth="var(--stroke-line, 3)"
						strokeLinecap="round"
					/>
					<g stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round">
						<line x1={endX - 5.5} y1={firstY - 5.5} x2={endX + 5.5} y2={firstY + 5.5} />
						<line x1={endX - 5.5} y1={firstY + 5.5} x2={endX + 5.5} y2={firstY - 5.5} />
					</g>
					{/* The status IS shown here, unlike on a failed leg. A failed leg's label is
					    interim — the chain carried on — whereas this one is the answer the caller
					    received, so it is a terminus and reads like the others do. */}
					<text
						x={outcomeX}
						y={firstY + 4}
						fill="var(--color-ink)"
						fontSize={labelSize}
						fontWeight="500"
						fontFamily="var(--font-mono)"
					>
						{status === undefined ? outcome : `${status} ${outcome}`}
					</text>
				</g>
			)}

			{attempts.map((attempt, i) => {
				const y = geo.padY + i * geo.rowHeight;
				const last = i === attempts.length - 1;
				const succeeded = isOk(attempt.outcome);
				// A leg that failed stops short: the line does not reach the terminus, because it
				// did not. Only the winning leg runs the full width.
				const legEnd = succeeded ? endX : geo.startX + geo.failLeg;
				/* The leg stops SHORT of its own stop mark. Run flush into the cross, the last
				   dash and the cross arms overlap at the exact point a reader is looking, and the
				   3px round caps turn the junction into a blob. A gap is what makes two marks
				   read as two marks. Only failed legs need it: a terminus station is a ring the
				   line is supposed to arrive at. */
				const strokeEnd = succeeded ? legEnd : legEnd - 9;
				const stroke = lineVar(attempt.line);
				const blocked = attempt.outcome.includes('BLOCK');
				const meta = attempt.latencyMs === undefined ? null : duration(attempt.latencyMs);

				return (
					<g
						key={`${attempt.provider}-${i}`}
						data-leg={attempt.provider}
						style={{ color: stroke }}
					>
						{/* The hit band, first so every stroke draws over it. */}
						{interactive && (
							<rect
								x={-geo.inset}
								y={y - geo.rowHeight / 2}
								width={geo.width + geo.inset}
								height={geo.rowHeight}
								fill="transparent"
							/>
						)}
						{/* The leg. Dashed when the provider was blocked — a broken line is what a
						    transit map already uses for a service that is not running. */}
						<line
							data-glow
							x1={geo.startX}
							y1={y}
							x2={strokeEnd}
							y2={y}
							stroke={stroke}
							strokeWidth="var(--stroke-line, 3)"
							strokeLinecap="round"
							strokeDasharray={blocked ? '2 7' : undefined}
							style={
								// A blocked leg is already dashed, and animating dashoffset on it would
								// march the dashes rather than draw the line. It arrives at full length.
								blocked
									? undefined
									: ({
											strokeDasharray: strokeEnd - geo.startX,
											animation: `proxlane-draw 900ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 320}ms both`,
											'--draw-length': strokeEnd - geo.startX,
										} as CSSProperties)
							}
						/>

						{/* The interchange: the transfer down off this line. Drawn as a curve rather
						    than a right angle, which is what makes it read as a metro map instead of
						    a flowchart.

						    STROKED IN THE LINE IT LEAVES, not the one it arrives at. Both are honest
						    map conventions — a colour can change at either end of an interchange — but
						    only this one survives focus. Wearing the next line's colour while sitting
						    in this row's group, it stayed bright when that next leg dimmed, putting
						    one hue at two brightnesses directly above each other.

						    It cannot simply move to the next group either: SVG paints in document
						    order with no z-index, so a curve in the later group draws over the
						    previous row's station instead of tucking under it. */}
						{!last && (
							<path
								data-glow
								d={`M ${geo.startX} ${y} q -${geo.bulge} 0 -${geo.bulge} ${geo.bulge} v ${geo.rowHeight - geo.bulge * 2} q 0 ${geo.bulge} ${geo.bulge} ${geo.bulge}`}
								fill="none"
								stroke={stroke}
								strokeWidth="var(--stroke-line, 3)"
							/>
						)}

						<circle
							cx={geo.startX}
							cy={y}
							r={last ? geo.stationR : geo.interchangeR}
							fill="var(--color-ground)"
							stroke={stroke}
							strokeWidth="var(--stroke-line, 3)"
						/>

						{/* A leader, from where the leg stopped to the column its outcome is printed
						    in. It is rule-coloured and hairline so it cannot be mistaken for a leg:
						    the journey ended at the cross. Without it the aligned outcome column
						    leaves a short leg stranded beside an unexplained gap. */}
						{!succeeded && (
							<line
								x1={legEnd + 11}
								y1={y}
								x2={outcomeX - 10}
								y2={y}
								stroke="var(--color-slate)"
								/* `--color-rule` is #dee2e6 on the light ground — about 1.2:1, which as
								   1px dots is not faint, it is absent, and the gap it exists to bridge
								   just read as a gap. Slate is a text-grade token, so it is dialled
								   back with opacity rather than swapped for a new colour role: still
								   plainly a guide, still clearly subordinate to a 3px provider line. */
								strokeOpacity="0.5"
								strokeWidth="var(--stroke-rule, 1)"
								strokeDasharray="1 4"
								strokeLinecap="round"
							/>
						)}

						{/* The provider owns the line, so it is the louder label: ink at medium,
						    against slate for everything qualifying it. The stroke colour already
						    says which provider; the weight says which word to read first.
						    `tspan dx` rather than a computed x — the offset flows from the measured
						    end of the previous run, so it holds if the mono face falls back. */}
						<text
							x={geo.startX + 16}
							y={y - geo.labelRise}
							fontSize={labelSize}
							fontFamily="var(--font-mono)"
						>
							<tspan fill="var(--color-ink)" fontWeight="500">
								{attempt.provider}
							</tspan>
							{meta !== null && (
								<tspan dx="12" fill="var(--color-slate)" fontSize={labelSize - 2}>
									{meta}
								</tspan>
							)}
						</text>

						{/* The outcome, and beneath it the rule that produced it. A soft block is a
						    claim; the rule id is the receipt, and printing it is the difference
						    between a diagram of a system and one from it. */}
						<text
							x={outcomeX}
							y={y + 4}
							fill={succeeded ? 'var(--color-ink)' : 'var(--color-slate)'}
							fontSize={labelSize}
							fontWeight={succeeded ? '500' : '400'}
							fontFamily="var(--font-mono)"
						>
							{succeeded && status !== undefined
								? `${status} ${attempt.outcome}`
								: attempt.outcome}
						</text>
						{attempt.detectRuleId !== undefined && (
							<text
								x={outcomeX}
								y={y + 19}
								fill="var(--color-slate)"
								fontSize={labelSize - 3}
								fontFamily="var(--font-mono)"
							>
								{attempt.detectRuleId}
							</text>
						)}

						{/* The terminus. A transit line ends AT a station; one that simply stops
						    reads as an unfinished drawing. Ringed with a filled centre, which is how
						    a map distinguishes the end of a line from a stop along it. */}
						{succeeded && (
							<>
								<circle
									cx={legEnd}
									cy={y}
									r={geo.terminusR}
									fill="var(--color-ground)"
									stroke={stroke}
									strokeWidth="var(--stroke-line, 3)"
								/>
								<circle cx={legEnd} cy={y} r="2" fill={stroke} />
							</>
						)}

						{/* A stop, not a station: this leg ended here and went no further. Struck at
						    the leg's own weight — thinner read as a different, weaker mark. */}
						{!succeeded && (
							<g stroke={stroke} strokeWidth="2.5" strokeLinecap="round">
								<line x1={legEnd - 5.5} y1={y - 5.5} x2={legEnd + 5.5} y2={y + 5.5} />
								<line x1={legEnd - 5.5} y1={y + 5.5} x2={legEnd + 5.5} y2={y - 5.5} />
							</g>
						)}
					</g>
				);
			})}
		</svg>
	);
}
