/**
 * One call to action, used everywhere, in two weights.
 *
 * THERE WERE THREE DIFFERENT ONES. A filled raspberry pill in the header, a filled raspberry
 * rectangle in the hero, and an outlined rectangle beside it. Three shapes and two fills for
 * the same job, which reads as three different buttons doing three different things.
 *
 * NOT FILLED. A solid raspberry block is the loudest thing on a page whose whole design is thin
 * coloured lines on a quiet ground: it stops being the brand colour and starts being a button
 * that happens to be pink. A hairline in the accent with a glow on hover says the same thing at
 * the weight the rest of the page speaks in, and it leaves the accent free to mean what it
 * means everywhere else, which is "this line is ours".
 *
 * The glow is a ring plus a soft shadow in the same colour, both at low alpha through
 * `color-mix` on the token, so it follows the theme rather than needing a dark variant.
 */

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

/** `primary` gets the accent hairline. `quiet` is the same shape in the rule colour. */
export type CtaTone = 'primary' | 'quiet';

const BASE =
	// `shrink-0 whitespace-nowrap`: in a flex row that runs short the CTA was the thing that gave,
	// and "Get started" broke across two lines inside a pill. A button that reflows is not a button
	// that fits. The row now only appears at `md` where it does fit; this is the belt to that brace.
	'group relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-5 font-medium transition-[color,border-color,box-shadow,transform] duration-200 ease-(--ease-lane) hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none';

const TONE: Record<CtaTone, string> = {
	primary: [
		'border-[color:var(--color-accent)] text-[color:var(--color-accent)]',
		// The glow: a tight ring and a wider bloom, both derived from the accent so a palette
		// change carries. Never a raw rgba, which `tokens:check` would reject anyway.
		'hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent),0_8px_28px_-8px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]',
	].join(' '),
	quiet: [
		'border-[color:var(--color-rule)] text-[color:var(--color-ink)]',
		'hover:border-[color:var(--color-slate)]',
	].join(' '),
};

const SIZE = {
	sm: 'min-h-9 text-sm',
	md: 'min-h-12 text-base',
} as const;

export function ctaClass(tone: CtaTone = 'primary', size: keyof typeof SIZE = 'md'): string {
	return `${BASE} ${SIZE[size]} ${TONE[tone]}`;
}

export function Cta({
	to,
	href,
	tone = 'primary',
	size = 'md',
	children,
}: {
	readonly to?: string;
	readonly href?: string;
	readonly tone?: CtaTone;
	readonly size?: keyof typeof SIZE;
	readonly children: ReactNode;
}) {
	const className = ctaClass(tone, size);
	if (href !== undefined) {
		return (
			<a className={className} href={href}>
				{children}
			</a>
		);
	}
	return (
		<Link className={className} to={to ?? '/'}>
			{children}
		</Link>
	);
}
