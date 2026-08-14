/**
 * The wordmark, and the mark, as two levels of the same station.
 *
 * NO SECOND TYPEFACE. `design.md` chooses one humanist sans with hierarchy from weight alone
 * and says outright that there is no display face, because the diagram is the display element.
 * A logo font would be a quiet amendment to that, so the distinctiveness comes from the mark
 * and from tracking instead.
 *
 * THE RING IS THE `O`. Substituting the interchange station into the letterform means the
 * wordmark and the diagram are the same object at two sizes, rather than a picture sitting next
 * to a name. It also means the name still reads as a word at 12px, which the alternative — the
 * three-line mark set inside the letter — did not: its rules ran past the `o` and crowded the
 * `r` and the `x`.
 */
export function Wordmark({ className }: { readonly className?: string }) {
	return (
		<span className={`tracking-[-0.03em] ${className ?? ''}`}>
			pr
			{/* MEASURED AGAINST THE FACE, not eyeballed. Hanken Grotesk at 500 puts its x-height
			    at 0.513em and its `o` from 0.0101em below the baseline to 0.5231em above — a 1%
			    overshoot at each end, which is what stops a round letter looking smaller than a
			    flat one. So the ring is 0.5332em tall and hangs 0.0101em below the baseline, and
			    it is a plain inline element: `vertical-align` puts a replaced element's bottom
			    edge exactly on the baseline, which a flex `items-baseline` does not, because an
			    SVG has no baseline of its own to align. That is why the first version floated. */}
			<svg
				width="0.5332em"
				height="0.5332em"
				viewBox="0 0 32 32"
				aria-hidden="true"
				style={{ verticalAlign: '-0.0101em' }}
				className="mx-[0.006em] inline-block"
			>
				{/* Stroke 5.7 of 32 is ~0.095em, the stem weight of this face at 500. Heavier and
				    it reads as an icon dropped into the word rather than as the letter it stands
				    in for. r + half the stroke fills the box exactly, so the ring's outer edge is
				    the glyph's outer edge. */}
				<circle
					cx="16"
					cy="16"
					r="13.15"
					fill="none"
					stroke="var(--color-accent)"
					strokeWidth="5.7"
				/>
			</svg>
			xlane
		</span>
	);
}

/**
 * The standalone mark: three provider lines, one interchange.
 *
 * This is the one that has to survive 16px in a browser tab, which is why it is not the ring.
 * A ring at 16px is a dot and says nothing; three coloured rules with a station on the middle
 * one still reads as a route, and teaches the colour system before anyone has read a word.
 *
 * The station is drawn in the accent rather than in ink: at tab size the ink version greys out
 * against browser chrome, and the brand colour is the part worth keeping.
 */
export function Mark({ className }: { readonly className?: string }) {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
			<g strokeWidth="4" strokeLinecap="round">
				<path d="M2 9 H30" stroke="var(--color-line-1)" />
				<path d="M2 18 H30" stroke="var(--color-line-2)" />
				<path d="M2 27 H30" stroke="var(--color-line-3)" />
			</g>
			<circle
				cx="16"
				cy="18"
				r="6.5"
				fill="var(--color-ground)"
				stroke="var(--color-accent)"
				strokeWidth="4.5"
			/>
		</svg>
	);
}
