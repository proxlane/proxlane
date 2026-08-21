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
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { barClass, pillClass, STUCK_AT_FIRST_PAINT } from './components/site-header.js';

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
