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
import { Cta } from './cta.js';
import { ThemeToggle } from './theme-toggle.js';
import { Mark, Wordmark } from './wordmark.js';

const NAV_LINK =
	'relative inline-flex min-h-11 items-center transition-colors duration-200 hover:text-[color:var(--color-ink)]';

/**
 * The nav, once, so the row and the mobile sheet cannot drift apart.
 *
 * "troubleshooting" is fifteen characters and it does not fit a 390px pill beside a wordmark,
 * a theme control and a call to action. The previous answer was to hide it below `sm`, which
 * meant a phone had no route to those pages at all — the pages most likely to be READ on a
 * phone, since somebody debugging on the move is exactly who searches for them.
 *
 * So the row keeps what fits and everything lives in the sheet. That also answers the real
 * question, which was not this label: the next three links have somewhere to go.
 */
const NAV: readonly { readonly to: string; readonly label: string }[] = [
	{ to: '/docs', label: 'docs' },
	{ to: '/symptoms', label: 'troubleshooting' },
];

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
		'transition-[padding] duration-300 ease-(--ease-lane)',
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
		'transition-opacity duration-300 ease-(--ease-lane)',
		stuck ? 'opacity-100' : 'opacity-0',
	].join(' ');
}

/**
 * The pill. Each state supplies its OWN background, border and shadow, and never the other's.
 */
export function pillClass(stuck: boolean): string {
	return [
		'flex items-center justify-between gap-4 rounded-full border px-4 py-1.5 sm:gap-6 sm:px-5',
		'transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-(--ease-lane)',
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
	const [open, setOpen] = useState(false);

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
						<Mark className="size-[18px] shrink-0 transition-transform duration-500 ease-(--ease-interchange) group-hover:rotate-90 motion-reduce:transition-none" />
						<Wordmark />
					</Link>
					<nav className="flex items-center gap-4 text-[color:var(--color-slate)] text-sm sm:gap-5">
						{/* EVERY LINK IS HIDDEN BELOW `sm`, not just the long one. Keeping `docs` in the
						    pill put it in two places at once on a phone: once in the bar and again in the
						    sheet below it, which is a menu that half works. On a phone the pill is the
						    wordmark, the theme, and the way in. */}
						<span className="hidden sm:contents">
							{NAV.map((item) => (
								<NavLink key={item.to} to={item.to}>
									{item.label}
								</NavLink>
							))}
							<a className={NAV_LINK} href="https://github.com/proxlane/proxlane">
								github
							</a>
						</span>
						<ThemeToggle />
						<span className="hidden sm:contents">
							<Cta to="/docs/quickstart" size="sm">
								Get started
							</Cta>
						</span>
						<MenuButton open={open} onToggle={() => setOpen((v) => !v)} />
					</nav>
				</header>
				<MobileSheet open={open} onNavigate={() => setOpen(false)} />
			</div>
		</>
	);
}

/**
 * The disclosure. Two bars that become a cross, animated as transforms so it composites.
 *
 * `sm:hidden`, because above that the row shows everything and a menu holding the same links
 * twice is a second way to do one thing.
 */
function MenuButton({
	open,
	onToggle,
}: {
	readonly open: boolean;
	readonly onToggle: () => void;
}) {
	const bar =
		'absolute left-1/2 h-px w-4 -translate-x-1/2 bg-[color:var(--color-ink)] transition-transform duration-300 ease-(--ease-lane) motion-reduce:transition-none';
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-controls="site-menu"
			aria-label={open ? 'Close menu' : 'Open menu'}
			className="relative -mr-1 inline-flex size-11 items-center justify-center sm:hidden"
		>
			<span className={`${bar} ${open ? 'rotate-45' : '-translate-y-[3px]'}`} />
			<span className={`${bar} ${open ? '-rotate-45' : 'translate-y-[3px]'}`} />
		</button>
	);
}

/**
 * The sheet: every nav item, at a size a thumb can hit.
 *
 * Grid-rows from 0fr to 1fr rather than a height, so it animates without anybody measuring
 * anything, and `overflow-hidden` on the wrapper is what makes that work. Height animation
 * would need a ResizeObserver to stay honest as the list grows, which is the whole point of
 * having a sheet.
 *
 * `aria-hidden` and `invisible` when closed, or a screen reader reads a menu that is not there
 * and a keyboard tabs into links nobody can see.
 */
function MobileSheet({
	open,
	onNavigate,
}: {
	readonly open: boolean;
	readonly onNavigate: () => void;
}) {
	return (
		<div
			id="site-menu"
			aria-hidden={!open}
			className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-(--ease-lane) sm:hidden motion-reduce:transition-none ${
				open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
			}`}
		>
			<div className={`min-h-0 ${open ? '' : 'invisible'}`}>
				<nav className="mt-2 flex flex-col rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-ground)]/85 p-2 shadow-panel backdrop-blur-xl">
					{NAV.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							onClick={onNavigate}
							className="rounded-card px-3 py-3 text-[color:var(--color-ink)] transition-colors hover:bg-[color:var(--color-surface)]"
						>
							{item.label}
						</Link>
					))}
					<a
						href="https://github.com/proxlane/proxlane"
						onClick={onNavigate}
						className="rounded-card px-3 py-3 text-[color:var(--color-ink)] transition-colors hover:bg-[color:var(--color-surface)]"
					>
						github
					</a>
					<span className="mt-1 px-1 pb-1">
						<Cta to="/docs/quickstart" size="sm">
							Get started
						</Cta>
					</span>
				</nav>
			</div>
		</div>
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
			className={`${NAV_LINK} after:absolute after:right-0 after:bottom-2.5 after:left-0 after:h-px after:origin-center after:scale-x-0 after:bg-[color:var(--color-accent)] after:transition-transform after:duration-200 after:ease-(--ease-lane) hover:after:scale-x-100 motion-reduce:after:transition-none`}
		>
			{children}
		</Link>
	);
}
