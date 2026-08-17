/**
 * The wordmark, and the mark that sits beside it.
 *
 * NO SECOND TYPEFACE. `design.md` chooses one humanist sans with hierarchy from weight alone
 * and says outright that there is no display face, because the diagram is the display element.
 * A logo font would be a quiet amendment to that, so the distinctiveness comes from the mark
 * and from tracking instead.
 *
 * THE `o` USED TO BE A RASPBERRY RING, and this is the correction. Substituting an interchange
 * station into the letterform was meant to make the wordmark and the diagram the same object at
 * two sizes. It did the opposite on both counts:
 *
 *   It was clipped. The ellipse's outer stroke edge sat exactly on all four viewBox edges —
 *   `cy - ry - strokeWidth/2` was 0.0 and the bottom was 533.0 of a 533 box — so every edge was
 *   shaved by a fraction of a pixel. Read as a flattened top and bottom at every size.
 *
 *   It was the wrong mark. A lone ring shares nothing with the tri-line station the product
 *   actually uses: same colour, different object. Set next to the real mark in the footer, the
 *   header read as a second, unrelated logo. And it borrowed `--color-accent` for a letterform,
 *   when a line colour identifies a provider and the accent is the product's own — a rule this
 *   file was quietly bending.
 *
 * So the letter is a letter, kerned by the font that was designed to kern it, and the mark is
 * the mark. One object, used at whatever size the surface needs.
 */
export function Wordmark({ className }: { readonly className?: string }) {
	return <span className={`tracking-[-0.03em] ${className ?? ''}`}>proxlane</span>;
}

/**
 * The mark: provider lines crossed by one interchange.
 *
 * THREE LINES IS THE METAPHOR, NOT AN INVENTORY, and it does not change when an adapter lands.
 * Four providers ship as of Bright Data and the mark still draws three, deliberately: a transit
 * map's logo does not carry one stripe per line, and a mark that shifts every time the registry
 * grows is not a mark. The place that must track the registry is the capability table on the
 * landing page, which `repo:check` assertion 28 holds to it.
 *
 * It has to survive 16px in a browser tab, which is why it is rules and a station rather than
 * anything finer: three coloured lines with an interchange on the middle one still reads as a
 * route at tab size, and teaches the colour system before anyone has read a word.
 *
 * THE CAPS ARE INSET BY ONE UNIT. `M2 … H30` with a 4-wide round cap puts the ink from 0.0 to
 * 32.0 of a 32 box, so both ends were shaved the same way the old ring was — the bug is easy to
 * reintroduce because the numbers look symmetric and correct. Ink now runs 1..31.
 *
 * The station is drawn in the accent rather than in ink: at tab size the ink version greys out
 * against browser chrome, and the brand colour is the part worth keeping.
 */
export function Mark({ className }: { readonly className?: string }) {
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
			<g strokeWidth="4" strokeLinecap="round">
				<path d="M3 9 H29" stroke="var(--color-line-1)" />
				<path d="M3 18 H29" stroke="var(--color-line-2)" />
				<path d="M3 27 H29" stroke="var(--color-line-3)" />
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
