/**
 * The site header, sticky, and quiet until it has a reason not to be.
 *
 * WHY IT IS TRANSPARENT AT THE TOP. `app.css` paints a fixed field behind the whole document,
 * so the page scrolls across a stationary grid. A header with a permanent background is a bar
 * sitting on that drawing, and the first thing a reader sees becomes a piece of furniture. At
 * scroll zero there is nothing to separate, so it wears nothing: no ground, no rule, no shadow.
 *
 * It earns them on the way down, where content is passing underneath and the grid would
 * otherwise run straight through the wordmark.
 *
 * AN INTERSECTION OBSERVER ON A SENTINEL, not a scroll listener. A listener fires on every
 * frame of every scroll and does layout work on the main thread to answer a question with two
 * possible answers. The sentinel is a zero-height element above the header: when it leaves the
 * viewport, the header has stuck. The browser does the work, off-thread.
 *
 * SSR RENDERS THE UNSTUCK STATE, which is correct rather than a compromise: at first paint the
 * page is at scroll zero. So there is no flash, and no hydration mismatch to suppress.
 */

import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './theme-toggle.js';
import { Mark, Wordmark } from './wordmark.js';

const NAV_LINK =
	'inline-flex min-h-11 items-center transition-colors hover:text-[color:var(--color-ink)]';

/**
 * The state the SERVER renders, and the reason it is a named constant rather than a literal.
 *
 * A first paint is always at scroll zero, so the header must render unstuck. Start it stuck and
 * every page briefly wears a bordered, blurred bar that hydration then takes away.
 *
 * Named so a test can assert it. Inlined as `useState(false)` the invariant is real and
 * unreachable: rendering the component needs a router in context, so a test that tries goes
 * down the "no router" path and asserts nothing, which is what the first version of that test
 * did.
 */
export const STUCK_AT_FIRST_PAINT = false;

/** The header's classes for a given state. Pure, so the two treatments can be compared. */
export function headerClass(stuck: boolean): string {
	return [
		'sticky top-0 z-40 -mx-6 flex items-center justify-between gap-6 px-6 py-5 sm:-mx-10 sm:px-10',
		// Only the properties that change, so a re-render cannot animate something unrelated.
		'transition-[background-color,border-color,backdrop-filter] duration-200',
		// Unstuck: a transparent strip over the fixed field the page scrolls across.
		'border-transparent border-b bg-transparent',
		// Stuck: the ground at 85%, blurred, with the hairline every panel uses. The alpha
		// resolves through `color-mix` on the TOKEN, so dark mode follows without a second rule.
		stuck
			? 'border-[color:var(--color-rule)] bg-[color:var(--color-ground)]/85 backdrop-blur-md'
			: '',
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
				// A hair of margin so the change happens as the header meets the top edge rather than
				// one pixel after, which reads as a lag.
				rootMargin: '0px 0px 0px 0px',
				threshold: 0,
			},
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<>
			{/* Zero height, so it changes no layout and reserves no space. */}
			<div ref={sentinel} aria-hidden="true" className="h-0" />
			<header className={headerClass(stuck)}>
				{/* THE MARK, then the name. One mark here and in the footer: the header used to draw
				    the word alone with its `o` replaced by a raspberry ring, a second logo that
				    shared nothing with the tri-line station but its colour. */}
				<Link
					to="/"
					aria-label="proxlane, home"
					className="inline-flex min-h-11 items-center gap-2.5 font-medium text-[color:var(--color-ink)] text-lg"
				>
					<Mark className="size-[18px] shrink-0" />
					<Wordmark />
				</Link>
				<nav className="flex items-center gap-5 text-[color:var(--color-slate)] text-sm sm:gap-6">
					<Link className={NAV_LINK} to="/docs">
						docs
					</Link>
					{/* Named for the reader's situation, not for our directory. Someone whose scrape
					    just broke is troubleshooting; "symptoms" is what we call the folder. Hidden
					    on the narrowest phones, where it is the fourth control across 342px. */}
					<Link className={`${NAV_LINK} hidden sm:inline-flex`} to="/symptoms">
						troubleshooting
					</Link>
					<a className={NAV_LINK} href="https://github.com/proxlane/proxlane">
						github
					</a>
					<ThemeToggle />
					<Link
						to="/docs/quickstart"
						className="ml-1 hidden min-h-9 items-center rounded-card bg-[color:var(--color-accent)] px-3.5 font-medium text-[color:var(--color-ground)] text-sm transition-opacity hover:opacity-85 sm:inline-flex"
					>
						Get started
					</Link>
				</nav>
			</header>
		</>
	);
}
