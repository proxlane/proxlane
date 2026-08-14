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
		<span className={`inline-flex items-baseline tracking-[-0.03em] ${className ?? ''}`}>
			pr
			{/* Sits on the baseline with the lowercase letters rather than centred on the line
			    box, so it reads as a glyph and not as an icon that wandered into the word. */}
			<svg
				width="0.62em"
				height="0.62em"
				viewBox="0 0 32 32"
				aria-hidden="true"
				className="mx-[0.045em] translate-y-[0.01em]"
			>
				<circle
					cx="16"
					cy="16"
					r="10"
					fill="none"
					stroke="var(--color-accent)"
					strokeWidth="7"
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
