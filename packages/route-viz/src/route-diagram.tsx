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
	readonly className?: string;
}

/** Geometry, in the diagram's own units. Kept together so the map reads as one drawing. */
const GEO = {
	width: 720,
	rowHeight: 56,
	padX: 24,
	padY: 28,
	/** Where the first station sits, leaving room for the entry label. */
	/* Far enough right that the interchange curve, which bulges to startX-18, clears the
	   entry label. At 96 the curve struck through the word `request`. */
	startX: 132,
	stationR: 6,
	interchangeR: 8,
} as const;

const lineVar = (n: 1 | 2 | 3): string => `var(--color-line-${n})`;

/** An outcome that ended the journey successfully. Everything else is a transfer or a stop. */
const isOk = (outcome: string): boolean => outcome === 'OK';

/**
 * A one-sentence description of the journey, for anyone not looking at it.
 *
 * The diagram carries information rather than decoration, so `role="img"` with a real label is
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

export function RouteDiagram({ attempts, outcome, status, className }: RouteDiagramProps) {
	const rows = Math.max(attempts.length, 1);
	// padY once below, not twice: the rows already carry their own leading.
	const height = GEO.padY + (rows - 1) * GEO.rowHeight + GEO.padY;
	const endX = GEO.width - GEO.padX - 76;

	return (
		<svg
			viewBox={`0 0 ${GEO.width} ${height}`}
			className={className}
			role="img"
			aria-label={describeRoute(attempts, outcome)}
			// Scales with the column rather than a fixed size, so the same component works in
			// the hero and in a dashboard table row.
			style={{ width: '100%', height: 'auto' } satisfies CSSProperties}
		>
			<title>{describeRoute(attempts, outcome)}</title>

			<text
				x={GEO.padX}
				y={GEO.padY + 4}
				fill="var(--color-slate)"
				fontSize="12"
				fontFamily="var(--font-mono)"
			>
				request
			</text>

			{attempts.map((attempt, i) => {
				const y = GEO.padY + i * GEO.rowHeight;
				const last = i === attempts.length - 1;
				const succeeded = isOk(attempt.outcome);
				// A leg that failed stops short: the line does not reach the terminus, because it
				// did not. Only the winning leg runs the full width.
				const legEnd = succeeded ? endX : GEO.startX + 210;
				const stroke = lineVar(attempt.line);

				return (
					<g key={`${attempt.provider}-${i}`}>
						{/* The leg. Dashed when the provider was blocked — a broken line is what a
						    transit map already uses for a service that is not running. */}
						<line
							x1={GEO.startX}
							y1={y}
							x2={legEnd}
							y2={y}
							stroke={stroke}
							strokeWidth="var(--stroke-line, 3)"
							strokeLinecap="round"
							strokeDasharray={attempt.outcome.includes('BLOCK') ? '2 7' : undefined}
						/>

						{/* The interchange: a transfer down to the next provider's line. Drawn as a
						    curve rather than a right angle, which is what makes it read as a metro
						    map instead of a flowchart. */}
						{!last && (
							<path
								d={`M ${GEO.startX} ${y} q -18 0 -18 18 v ${GEO.rowHeight - 36} q 0 18 18 18`}
								fill="none"
								stroke={lineVar(attempts[i + 1]?.line ?? attempt.line)}
								strokeWidth="var(--stroke-line, 3)"
							/>
						)}

						<circle
							cx={GEO.startX}
							cy={y}
							r={last ? GEO.stationR : GEO.interchangeR}
							fill="var(--color-ground)"
							stroke={stroke}
							strokeWidth="var(--stroke-line, 3)"
						/>

						<text
							x={GEO.startX + 18}
							y={y - 12}
							fill="var(--color-ink)"
							fontSize="13"
							fontWeight="500"
						>
							{attempt.provider}
						</text>
						<text
							x={legEnd + 16}
							y={y + 4}
							fill={succeeded ? 'var(--color-ink)' : 'var(--color-slate)'}
							fontSize="12"
							fontFamily="var(--font-mono)"
						>
							{succeeded && status !== undefined
								? `${status} ${attempt.outcome}`
								: attempt.outcome}
						</text>

						{/* The terminus. A transit line ends AT a station; one that simply stops
						    reads as an unfinished drawing. */}
						{succeeded && (
							<circle
								cx={legEnd}
								cy={y}
								r={GEO.stationR}
								fill="var(--color-ground)"
								stroke={stroke}
								strokeWidth="var(--stroke-line, 3)"
							/>
						)}

						{/* A stop, not a station: this leg ended here and went no further. */}
						{!succeeded && (
							<g stroke={stroke} strokeWidth="2" strokeLinecap="round">
								<line x1={legEnd - 5} y1={y - 5} x2={legEnd + 5} y2={y + 5} />
								<line x1={legEnd - 5} y1={y + 5} x2={legEnd + 5} y2={y - 5} />
							</g>
						)}
					</g>
				);
			})}
		</svg>
	);
}
