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
	{ to: '/block-page-detector', label: 'detector' },
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
		// `relative z-40` so the scrim cannot paint over it: the pill holds the control that CLOSES
		// the menu, and a blurred close button is the one thing on screen that must stay legible.
		'relative z-40 flex items-center justify-between gap-4 rounded-full border px-4 py-1.5 sm:gap-6 sm:px-5',
		'transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-(--ease-lane)',
		stuck
			? // Glass: the ground at 72%, blurred and saturated so the field behind reads as depth
				// rather than noise, a hairline, and the shadow every panel uses to sit on paper.
				'border-[color:var(--color-rule)] bg-[color:var(--color-ground)]/72 shadow-panel backdrop-blur-xl backdrop-saturate-150'
			: 'border-transparent bg-transparent shadow-none backdrop-blur-none',
	].join(' ');
}

/**
 * The sheet.
 *
 * `absolute`, and that is the whole point rather than a detail. The first version animated
 * `grid-template-rows` in the normal flow, so opening the menu pushed every pixel of the page
 * down and closing it snapped them back. Exported so a test can hold it to that: a menu that
 * moves the content behind it is the defect this replaced.
 */
export function sheetClass(open: boolean): string {
	return [
		'absolute inset-x-4 top-full z-40 origin-top md:hidden',
		'transition-[opacity,transform] duration-300 ease-(--ease-lane) motion-reduce:transition-none',
		open
			? 'translate-y-0 scale-100 opacity-100'
			: 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0',
	].join(' ');
}

/** The scrim. `pointer-events-none` when closed, or an invisible layer eats the whole page. */
export function overlayClass(open: boolean): string {
	return [
		'fixed inset-0 z-30 bg-[color:var(--color-scrim)] backdrop-blur-[2px] md:hidden',
		'transition-opacity duration-300 ease-(--ease-lane)',
		open ? 'opacity-100' : 'pointer-events-none opacity-0',
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

	/**
	 * Escape closes it, and the page underneath stops scrolling while it is open.
	 *
	 * Both are what makes an overlay an overlay rather than a box that happens to be on top. The
	 * scrim catches taps, but a touch-drag on it scrolls the document behind unless the document
	 * is told not to, and a menu whose background slides away under your thumb feels broken in a
	 * way nobody can name.
	 */
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('keydown', onKey);
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = previous;
		};
	}, [open]);

	return (
		<>
			{/* Zero height, so it reserves no space and changes no layout. */}
			<div ref={sentinel} aria-hidden="true" className="h-0" />
			<div className={`relative ${barClass(stuck)}`}>
				<div aria-hidden="true" className={scrimClass(stuck)} />
				<header className={pillClass(stuck || open)}>
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
						<span className="hidden md:contents">
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
						<span className="hidden md:contents">
							<Cta to="/docs/quickstart" size="sm">
								Get started
							</Cta>
						</span>
						<MenuButton open={open} onToggle={() => setOpen((v) => !v)} />
					</nav>
				</header>
				<MobileSheet open={open} onClose={() => setOpen(false)} />
			</div>
		</>
	);
}

/**
 * The disclosure. Two bars that become a cross, animated as transforms so it composites.
 *
 * `md:hidden`, because above that the row shows everything and a menu holding the same links
 * twice is a second way to do one thing. `md` and not `sm`: measured, the row does not actually
 * fit until 740px, and switching at 640 left "Get started" wrapping inside its own pill.
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
			className="relative -mr-1 inline-flex size-11 items-center justify-center md:hidden"
		>
			<span className={`${bar} ${open ? 'rotate-45' : '-translate-y-[3px]'}`} />
			<span className={`${bar} ${open ? '-rotate-45' : 'translate-y-[3px]'}`} />
		</button>
	);
}

/**
 * The menu, as a piece of the diagram.
 *
 * IT OVERLAYS, IT DOES NOT PUSH. The first version animated `grid-template-rows` in the normal
 * flow, so opening it shoved the whole page down and closing it yanked it back. That is the
 * cheapest possible disclosure and it reads as one: the content you were looking at moves,
 * which is the opposite of what a menu is for. `absolute` under the bar leaves the page alone.
 *
 * IT IS A LANE. Providers are lines and stations are stops everywhere else on this site, and the
 * menu was the one surface with none of that in it — four rows of text in a rounded box, which
 * is every mobile menu ever shipped. A rule down the left with a node per destination is the
 * same drawing as the hero, at nav scale, and the current page is the filled station.
 *
 * NEVER A LINE COLOUR. `--color-line-1..4` identify PROVIDERS wherever they appear, so painting
 * nav items with them would say the docs page is ScraperAPI. The rule colour draws the track and
 * the accent marks where you are, which is the same distinction the rest of the site makes.
 *
 * The stagger is on the way IN only. Closing one item at a time reads as reluctance; a menu
 * should leave at once.
 */
function MobileSheet({
	open,
	onClose,
}: {
	readonly open: boolean;
	readonly onClose: () => void;
}) {
	const stations = [...NAV, { to: 'https://github.com/proxlane/proxlane', label: 'github' }];
	return (
		<>
			{/* The page recedes. Tapping it closes, which is the gesture everyone tries first. */}
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				onClick={onClose}
				className={overlayClass(open)}
			/>
			<div id="site-menu" aria-hidden={!open} className={sheetClass(open)}>
				<nav className="rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-ground)]/85 p-2 shadow-panel backdrop-blur-xl backdrop-saturate-150">
					{/* The track. Inset top and bottom to the first and last node's centre, so the line
					    runs BETWEEN stations rather than past them, the way a route diagram does. */}
					<div className="relative pl-6">
						<span
							aria-hidden="true"
							// `left-[5px]`, which is the STATION'S centre and not the container's. The node is
							// 11px wide at `-left-6` inside a `pl-6` group, so its centre is 5.5px from the
							// group's left edge; a 1px rule centred there starts at 5. It was at 9, so the
							// line ran four pixels to the right of every dot it was drawing through.
							// Measured: line centre 34.5px against dot centres at 30.5px.
							className="absolute top-[26px] bottom-[26px] left-[5px] w-px bg-[color:var(--color-rule)]"
						/>
						{stations.map((item, i) => (
							<Station
								key={item.to}
								to={item.to}
								label={item.label}
								index={i}
								open={open}
								onClose={onClose}
							/>
						))}
					</div>
					<span className="mt-2 block border-[color:var(--color-rule)] border-t pt-3 pb-1 pl-1">
						<Cta to="/docs/quickstart" size="sm">
							Get started
						</Cta>
					</span>
				</nav>
			</div>
		</>
	);
}

/**
 * One stop on the line.
 *
 * A ring that fills when you are there. `activeProps` rather than reading the location, because
 * the router already knows and a second source of truth about the current route is a bug waiting
 * for a redirect.
 */
function Station({
	to,
	label,
	index,
	open,
	onClose,
}: {
	readonly to: string;
	readonly label: string;
	readonly index: number;
	readonly open: boolean;
	readonly onClose: () => void;
}) {
	// Delay on the way in, none on the way out. Inline because it is per-index; a class per
	// position would be five utilities describing one number.
	const style = { transitionDelay: open ? `${60 + index * 45}ms` : '0ms' };
	const shell =
		'group relative flex min-h-11 items-center py-2.5 text-[color:var(--color-ink)] transition-[opacity,transform] duration-300 ease-(--ease-lane) motion-reduce:transition-none';
	const enter = open ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0';
	const node =
		'-left-6 absolute top-1/2 size-[11px] -translate-y-1/2 rounded-full border-2 bg-[color:var(--color-ground)] transition-colors duration-200';

	const external = to.startsWith('http');
	const inner = (
		<>
			<span
				aria-hidden="true"
				className={`${node} border-[color:var(--color-slate)] group-hover:border-[color:var(--color-accent)] group-data-[status=active]:border-[color:var(--color-accent)] group-data-[status=active]:bg-[color:var(--color-accent)]`}
			/>
			{label}
		</>
	);

	if (external) {
		return (
			<a href={to} onClick={onClose} style={style} className={`${shell} ${enter}`}>
				{inner}
			</a>
		);
	}
	return (
		<Link to={to} onClick={onClose} style={style} className={`${shell} ${enter}`}>
			{inner}
		</Link>
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
			// THE SAME RULE, HELD OPEN. The row had no current-page state at all: four identical
			// links, and the only way to know where you were was to read the heading. The mobile
			// sheet had one from the day it shipped — a filled station on the line — so the two
			// halves of one nav disagreed about whether that mattered.
			//
			// Reusing the hover underline rather than inventing a second mark is the point. Hover
			// grows it and being here keeps it, so the affordance and the state are the same
			// object in two conditions, which is one thing to learn instead of two.
			//
			// Not `exact`: TanStack matches prefixes by default, so `/docs` stays lit on
			// `/docs/quickstart`. A section that goes dark the moment you enter it is worse than
			// no indicator, because it actively says you are somewhere else.
			activeProps={{
				className:
					'text-[color:var(--color-ink)] after:scale-x-100 after:bg-[color:var(--color-accent)]',
			}}
			className={`${NAV_LINK} after:absolute after:right-0 after:bottom-2.5 after:left-0 after:h-px after:origin-center after:scale-x-0 after:bg-[color:var(--color-accent)] after:transition-transform after:duration-200 after:ease-(--ease-lane) hover:after:scale-x-100 motion-reduce:after:transition-none`}
		>
			{children}
		</Link>
	);
}
