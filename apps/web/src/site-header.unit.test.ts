// The site header, against its rendered markup.
//
// It was inlined in `__root.tsx` and untestable, like the page artifacts before them. Making it
// sticky was the reason to pull it out: a header that changes state on scroll has behaviour, and
// behaviour that only exists in a route module cannot be checked.
//
// WHAT IS ACTUALLY WORTH PINNING here is not the styling. It is that the server renders the
// UNSTUCK state, and that every destination in the nav is a route that exists.

/**
 * `<Link>` needs a router in context, which a static render has no business standing up. The
 * header's own contract is the markup it emits, so the links are read out of the SOURCE and
 * checked against the routes on disk. That is the assertion that actually rots.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ctaClass } from './components/cta.js';
import {
	barClass,
	overlayClass,
	pillClass,
	STUCK_AT_FIRST_PAINT,
	sheetClass,
} from './components/site-header.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = resolve(HERE, 'routes');

describe('the header server-renders the state a first paint is in', () => {
	it('starts unstuck, because a first paint is at scroll zero', () => {
		// Start it stuck and every page briefly wears a bordered, blurred bar that hydration then
		// removes. Asserted on the exported constant rather than by rendering: `<Link>` needs a
		// router in context, so the first version of this test caught the "no router" path and
		// asserted nothing at all. Flipping the initial state left it green.
		expect(STUCK_AT_FIRST_PAINT).toBe(false);
	});

	it('wears nothing at rest and full glass when stuck', () => {
		const rest = pillClass(false);
		const stuck = pillClass(true);
		// At rest it must paint nothing over the fixed field the page scrolls across.
		expect(rest).toContain('bg-transparent');
		expect(rest).toContain('border-transparent');
		expect(rest).toContain('shadow-none');
		expect(rest).toContain('backdrop-blur-none');
		// Stuck it is glass: ground, hairline, lift, blur.
		expect(stuck).toContain('--color-ground');
		expect(stuck).toContain('--color-rule');
		expect(stuck).toContain('shadow-panel');
		expect(stuck).toContain('backdrop-blur-xl');
	});

	it('never emits a utility together with its own override', () => {
		// THE BUG THIS FILE EXISTS FOR. The first version put `bg-transparent` and
		// `bg-[…]/85` in one class list and left the winner to Tailwind's layer order. It
		// chose `bg-transparent`, while `backdrop-blur-md` had no competitor and applied.
		// The header blurred the text behind it and painted nothing on top, which is the
		// least readable thing it could have done.
		//
		// Measured on the real page: `blur(12px)` with `backgroundColor: rgba(0,0,0,0)`.
		for (const cls of [pillClass(true), pillClass(false)]) {
			const groups: ReadonlyArray<readonly [string, string]> = [
				['bg-transparent', 'bg-[color:var(--color-ground)]'],
				['border-transparent', 'border-[color:var(--color-rule)]'],
				['shadow-none', 'shadow-panel'],
				['backdrop-blur-none', 'backdrop-blur-xl'],
			];
			for (const [a, b] of groups) {
				expect(cls.includes(a) && cls.includes(b), `${a} and ${b} both present`).toBe(false);
			}
		}
	});

	it('changes the bar rhythm rather than the page edges', () => {
		// The pill floats inside a full-width bar. Rounding the bar would round the page.
		expect(barClass(true)).toContain('sticky');
		expect(barClass(false)).toContain('sticky');
		expect(barClass(true)).not.toContain('rounded');
		expect(barClass(true)).not.toBe(barClass(false));
	});

	it('uses tokens for every colour it paints', () => {
		expect(/#[0-9a-f]{3,8}\b/i.test(pillClass(true) + barClass(true))).toBe(false);
	});
});

describe('motion uses the named curves, never a framework default', () => {
	// `ease-out` is Tailwind's `cubic-bezier(0, 0, 0.2, 1)`. A site whose identity is a transit
	// diagram should not move like every other Tailwind site, and a default curve is nobody's
	// design decision. Two named tokens: `--ease-lane` decelerates and settles, like a train
	// arriving; `--ease-interchange` overshoots, and is reserved for the mark's quarter turn.
	it('names an easing token on every transition it declares', () => {
		for (const cls of [barClass(true), pillClass(true), ctaClass('primary')]) {
			expect(cls).toContain('transition-');
			expect(cls).toContain('ease-(--ease-');
			// The tell for a framework default slipping back in.
			expect(cls).not.toMatch(/\bease-(out|in|in-out|linear)\b/);
		}
	});
});

describe('one call to action, not three', () => {
	// There were three: a filled raspberry pill in the header, a filled raspberry rectangle in
	// the hero, and an outlined rectangle beside it. Three shapes and two fills for one job.
	it('never fills with the accent', () => {
		// A solid raspberry block is the loudest thing on a page built from thin coloured lines.
		// The accent means "this line is ours" everywhere else; a filled button spends it.
		for (const tone of ['primary', 'quiet'] as const) {
			expect(ctaClass(tone)).not.toContain('bg-[color:var(--color-accent)]');
		}
	});

	it('carries the accent as a hairline and a glow', () => {
		const primary = ctaClass('primary');
		expect(primary).toContain('border-[color:var(--color-accent)]');
		expect(primary).toContain('text-[color:var(--color-accent)]');
		expect(primary).toContain('hover:shadow-');
	});

	it('is one shape in both tones', () => {
		// Two weights of the same button, not two different buttons.
		expect(ctaClass('primary')).toContain('rounded-full');
		expect(ctaClass('quiet')).toContain('rounded-full');
	});

	it('paints no raw hex, including inside the glow', () => {
		// The glow is the easiest place to reach for an rgba. `tokens:check` bans it, and a
		// shadow is exactly the kind of value that gets typed by hand.
		expect(/#[0-9a-f]{3,8}\b/i.test(ctaClass('primary'))).toBe(false);
		expect(ctaClass('primary')).toContain('color-mix');
	});
});

describe('the mobile menu overlays the page instead of pushing it', () => {
	// THE DEFECT THIS REPLACED. The sheet animated `grid-template-rows` in the normal flow, so
	// opening it shoved the whole document down and closing it yanked it back. Measured after the
	// fix: an h1 sat at 386px both before and after opening.
	it('is positioned out of flow', () => {
		for (const open of [true, false]) {
			expect(sheetClass(open)).toContain('absolute');
			// The tell for the old approach coming back. A row-template animation only works in
			// flow, so its presence and `absolute` are mutually exclusive by construction.
			expect(sheetClass(open)).not.toContain('grid-rows');
			expect(sheetClass(open)).not.toContain('grid-template-rows');
		}
	});

	it('lets clicks through when it is closed', () => {
		// Both layers cover real estate. Without this the scrim eats every tap on the page and the
		// sheet eats every tap just under the header, invisibly.
		expect(sheetClass(false)).toContain('pointer-events-none');
		expect(overlayClass(false)).toContain('pointer-events-none');
		expect(sheetClass(true)).not.toContain('pointer-events-none');
		expect(overlayClass(true)).not.toContain('pointer-events-none');
	});

	it('sits under the pill in the stack, never over it', () => {
		// The pill holds the control that CLOSES the menu. A scrim painted over it left the
		// wordmark, the theme control and the close button all blurred behind their own menu.
		const z = (cls: string): number => Number(/\bz-(\d+)\b/.exec(cls)?.[1] ?? '0');
		expect(z(overlayClass(true))).toBeLessThan(z(pillClass(true)));
		expect(z(pillClass(true))).toBeGreaterThan(0);
	});

	it('moves on the named curves', () => {
		for (const cls of [sheetClass(true), overlayClass(true)]) {
			expect(cls).toContain('ease-(--ease-');
			expect(cls).not.toMatch(/\bease-(out|in|in-out|linear)\b/);
		}
	});

	it('never paints a nav item in a provider colour', () => {
		// `design.md`: a line colour identifies a PROVIDER everywhere it appears. Painting the
		// menu's stations with them would say the docs page is ScraperAPI. The same mistake was
		// already made once, with focus and selection drawn in `--color-line-1`.
		const src = readFileSync(join(HERE, 'components', 'site-header.tsx'), 'utf8');
		expect(src).toContain('data-[status=active]');
		// The PAINT form, not the word. A blanket ban on the token failed on the comment two lines
		// above that explains the rule, and `Mark` legitimately draws the tri-line station in those
		// colours from its own file. What must never appear here is a nav item wearing one.
		expect(src).not.toMatch(/\[color:var\(--color-line-\d/);
	});
});

describe('every nav destination is a route that exists', () => {
	// A nav link to a deleted page is a 404 on every page of the site at once, which is the worst
	// possible blast radius for a rename. `content:lint` makes the same check for symptom pages.
	const source = readdirSync(join(HERE, 'components'))
		.filter((f) => f === 'site-header.tsx')
		.map((f) => readdirSync(join(HERE, 'components')).includes(f)).length;

	it('reads the header source, so this cannot pass vacuously', () => {
		expect(source).toBeGreaterThan(0);
	});

	it('points only at routes on disk', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(join(HERE, 'components', 'site-header.tsx'), 'utf8');
		const targets = [...src.matchAll(/\bto="(\/[a-z0-9/-]*)"/g)].map((m) => m[1] as string);
		expect(targets.length).toBeGreaterThan(0);

		const known = new Set<string>(['/']);
		const walk = (dir: string, prefix: string): void => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				if (e.isDirectory()) {
					known.add(`${prefix}/${e.name}`);
					walk(join(dir, e.name), `${prefix}/${e.name}`);
				} else if (e.name.endsWith('.tsx')) {
					const base = e.name.replace(/\.tsx$/, '');
					known.add(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
				}
			}
		};
		walk(ROUTES, '');

		for (const t of targets) {
			expect(known, `nav links to ${t}`).toContain(t);
		}
	});
});
