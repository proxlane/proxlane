/**
 * The site header: a quiet strip at rest, a floating glass pill once you scroll.
 *
 * WHY IT IS NOTHING AT THE TOP. `app.css` paints a fixed field behind the document, so the page
 * scrolls across a stationary grid. A header with permanent chrome is a bar sitting on that
 * drawing, and the first thing anyone sees becomes furniture. At scroll zero there is nothing to
 * separate, so it wears nothing. It earns the pill on the way down, where content is passing
 * underneath and the grid would otherwise run through the wordmark.
 *
 * THE TWO STATES ARE MUTUALLY EXCLUSIVE, and that is a fix rather than a preference. The first
 * version emitted `bg-transparent` and `bg-[…]/85` in one class list and let Tailwind's layer
 * order choose. It chose `bg-transparent`. `backdrop-blur-md` had no competitor, so the header
 * blurred the text behind it and then painted nothing on top: the worst of both, and exactly
 * what it looked like on a phone. Measured, not guessed — the computed style read
 * `blur(12px)` with `backgroundColor: rgba(0,0,0,0)`.
 *
 * So no utility here is ever emitted alongside its own override.
 *
 * AN INTERSECTION OBSERVER ON A SENTINEL, not a scroll listener. A listener runs every frame to
 * answer a question with two answers. Verified firing `[true, false]` across one scroll.
 *
 * SSR RENDERS THE RESTING STATE, which is right rather than a compromise: a first paint is at
 * scroll zero. No flash, and nothing to suppress on hydration.
 */

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './theme-toggle.js';
import { Mark, Wordmark } from './wordmark.js';

const NAV_LINK =
	'relative inline-flex min-h-11 items-center transition-colors duration-200 hover:text-[color:var(--color-ink)]';

/**
 * The state the SERVER renders. Named so a test can assert it: rendering the component needs a
 * router in context, so an inlined `useState(false)` is an invariant no test can reach.
 */
export const STUCK_AT_FIRST_PAINT = false;

/**
 * The bar: position and vertical rhythm only.
 *
 * The pill lives on the inner element so the bar can stay full width. Rounding the bar itself
 * would round the page edges rather than float something inside them.
 */
export function barClass(stuck: boolean): string {
	return [
		'sticky top-0 z-40 -mx-6 px-4 sm:-mx-10 sm:px-8',
		'transition-[padding] duration-300 ease-out',
		stuck ? 'pt-3 pb-2' : 'pt-5 pb-5',
	].join(' ');
}

/**
 * A scrim behind the pill, so text dissolves upward instead of being sliced.
 *
 * The pill floats with a few millimetres of air above it, and that air is transparent: a line
 * of body copy scrolling past showed through it, cut in half by the top of the viewport. The
 * pill looked correct and the strip around it looked broken.
 *
 * A gradient from the ground to nothing, the height of the bar, painted UNDER the pill. Content
 * fades as it approaches instead of ending mid-letter. `pointer-events-none` because it covers
 * the full width and would otherwise eat clicks meant for the page.
 */
export function scrimClass(stuck: boolean): string {
	return [
		'pointer-events-none absolute inset-x-0 top-0 -z-10 h-full',
		'bg-gradient-to-b from-[color:var(--color-ground)] via-[color:var(--color-ground)]/85 to-transparent',
		'transition-opacity duration-300 ease-out',
		stuck ? 'opacity-100' : 'opacity-0',
	].join(' ');
}

/**
 * The pill. Each state supplies its OWN background, border and shadow, and never the other's.
 */
export function pillClass(stuck: boolean): string {
	return [
		'flex items-center justify-between gap-4 rounded-full border px-4 py-1.5 sm:gap-6 sm:px-5',
		'transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-out',
		stuck
			? // Glass: the ground at 72%, blurred and saturated so the field behind reads as depth
				// rather than noise, a hairline, and the shadow every panel uses to sit on paper.
				'border-[color:var(--color-rule)] bg-[color:var(--color-ground)]/72 shadow-panel backdrop-blur-xl backdrop-saturate-150'
			: 'border-transparent bg-transparent shadow-none backdrop-blur-none',
	].join(' ');
}

export function SiteHeader() {
	const sentinel = useRef<HTMLDivElement>(null);
	const [stuck, setStuck] = useState(STUCK_AT_FIRST_PAINT);

	useEffect(() => {
		const el = sentinel.current;
		if (el === null) return;
		const io = new IntersectionObserver(
			([entry]) => setStuck(entry?.isIntersecting === false),
			{
				threshold: 0,
			},
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<>
			{/* Zero height, so it reserves no space and changes no layout. */}
			<div ref={sentinel} aria-hidden="true" className="h-0" />
			<div className={`relative ${barClass(stuck)}`}>
				<div aria-hidden="true" className={scrimClass(stuck)} />
				<header className={pillClass(stuck)}>
					{/* THE MARK, then the name. One mark here and in the footer: this used to draw the
					    word alone with its `o` replaced by a raspberry ring, a second logo sharing
					    nothing with the tri-line station but its colour.
					    The quarter turn on hover is the interchange rotating, which is the only motion
					    on the mark anywhere and reads as the diagram rather than as decoration. */}
					<Link
						to="/"
						aria-label="proxlane, home"
						className="group inline-flex min-h-11 items-center gap-2.5 font-medium text-[color:var(--color-ink)] text-lg"
					>
						<Mark className="size-[18px] shrink-0 transition-transform duration-500 ease-out group-hover:rotate-90 motion-reduce:transition-none" />
						<Wordmark />
					</Link>
					<nav className="flex items-center gap-4 text-[color:var(--color-slate)] text-sm sm:gap-5">
						<NavLink to="/docs">docs</NavLink>
						{/* Named for the reader's situation rather than our directory: someone whose
						    scrape just broke is troubleshooting, "symptoms" is what we call the folder.
						    Hidden on the narrowest phones, where it is a fourth control across 342px. */}
						<span className="hidden sm:contents">
							<NavLink to="/symptoms">troubleshooting</NavLink>
						</span>
						<a className={NAV_LINK} href="https://github.com/proxlane/proxlane">
							github
						</a>
						<ThemeToggle />
						<Link
							to="/docs/quickstart"
							className="ml-0.5 hidden min-h-9 items-center rounded-full bg-[color:var(--color-accent)] px-4 font-medium text-[color:var(--color-ground)] text-sm transition-[transform,opacity] duration-200 ease-out hover:-translate-y-px hover:opacity-90 motion-reduce:transition-none sm:inline-flex"
						>
							Get started
						</Link>
					</nav>
				</header>
			</div>
		</>
	);
}

/**
 * A nav link whose rule grows from the centre on hover.
 *
 * An underline that appears whole is a state change; one that grows is a response. A scaled
 * pseudo-element rather than an animated width, so it composites off the main thread, and it is
 * skipped for a reader who asked for stillness.
 */
function NavLink({ to, children }: { readonly to: string; readonly children: string }) {
	return (
		<Link
			to={to}
			className={`${NAV_LINK} after:absolute after:right-0 after:bottom-2.5 after:left-0 after:h-px after:origin-center after:scale-x-0 after:bg-[color:var(--color-accent)] after:transition-transform after:duration-200 after:ease-out hover:after:scale-x-100 motion-reduce:after:transition-none`}
		>
			{children}
		</Link>
	);
}
