// The route diagram, against its own rendered SVG.
//
// It had no tests at all, and the bug that prompted these is the reason it needed them: a shed
// request — zero attempts, refused at the in-flight ceiling — was drawn running the full width
// to the terminus column, which is the geometry of the leg that WON. In a transit diagram
// length is distance covered, so the one request that entered no provider's line at all was
// drawn travelling further than a failed provider and further than a single-hop success. The
// panel whose entire point is "nothing was tried and nothing was charged" showed the longest
// journey on the page, and nothing could catch it: no test rendered this component.
//
// Asserted on the MARKUP rather than on a snapshot. A snapshot would go green on any change
// that someone accepted, which is the opposite of what is wanted here — these are claims about
// what the drawing means, and each one should fail with a sentence saying which claim broke.
//
// It lives in `apps/web` rather than in `packages/route-viz` because react-dom is already a
// dependency here and is not one there. Adding a renderer to a package that does not render is
// a worse trade than putting the test next to the app that mounts it.

import { RouteDiagram } from '@proxlane/route-viz';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const render = (props: Parameters<typeof RouteDiagram>[0]): string =>
	renderToStaticMarkup(RouteDiagram(props));

/** Every `<line>`'s x-extent, so a claim about distance can be made about the drawing. */
function lines(svg: string): { x1: number; x2: number; stroke: string; dashed: boolean }[] {
	return [...svg.matchAll(/<line[^>]*>/g)].map((m) => {
		const tag = m[0];
		const attr = (n: string /** biome-ignore lint/performance/useTopLevelRegex: per-attr */) =>
			new RegExp(`${n}="([^"]*)"`).exec(tag)?.[1] ?? '';
		return {
			x1: Number(attr('x1')),
			x2: Number(attr('x2')),
			stroke: attr('stroke'),
			// The ATTRIBUTE's value, not merely its presence. React emits an empty
			// `stroke-dasharray=""` for `undefined`, so an `includes` check read every solid leg as
			// dashed and quietly made the distance assertions compare the wrong lines.
			dashed: attr('stroke-dasharray') !== '',
		};
	});
}

/** The rightmost point any SOLID ink or provider-coloured line reaches. */
const travelled = (svg: string): number =>
	Math.max(
		...lines(svg)
			.filter((l) => !l.dashed && l.stroke !== 'var(--color-slate)')
			.map((l) => Math.max(l.x1, l.x2)),
	);

const SHED = { attempts: [], outcome: 'GATEWAY_BUSY', status: 429 } as const;
const SERVED = {
	attempts: [{ provider: 'scraperapi', outcome: 'OK', line: 1 as const, latencyMs: 980 }],
	outcome: 'OK',
	status: 200,
} as const;
const FAILED_THEN_SERVED = {
	attempts: [
		{ provider: 'scraperapi', outcome: 'SOFT_BLOCK', line: 1 as const, latencyMs: 1420 },
		{ provider: 'scrapfly', outcome: 'OK', line: 3 as const, latencyMs: 1840 },
	],
	outcome: 'OK',
	status: 200,
} as const;

describe('distance means distance', () => {
	it('draws a shed request shorter than one that reached a provider', () => {
		// THE REGRESSION. A shed request is refused before a provider is chosen, so it must not
		// be drawn covering more ground than a request that was actually served.
		const shed = travelled(render({ ...SHED, presentation: true }));
		const served = travelled(render({ ...SERVED, presentation: true }));
		expect(shed).toBeLessThan(served);
	});

	it('draws it shorter than a leg that failed, too', () => {
		// A failed provider leg stops short of the terminus because it did not deliver — but it
		// did reach a provider. A shed request did not get that far, and the drawing has to
		// agree with that ordering rather than merely with the success case.
		const shed = travelled(render({ ...SHED, presentation: true }));
		const failed = travelled(render({ ...FAILED_THEN_SERVED, presentation: true }));
		expect(shed).toBeLessThan(failed);
	});

	it('still puts the outcome label in the same column as every other scenario', () => {
		// The reason the old version ran full width was a real one: an outcome label stranded far
		// from the end of its line reads as a rendering fault. The fix was to say what the empty
		// space is, not to fill it — so the label column must not have moved.
		const x = (svg: string) => /<text x="(\d+(?:\.\d+)?)"[^>]*>\d{3} /.exec(svg)?.[1];
		expect(x(render({ ...SHED, presentation: true }))).toBe(
			x(render({ ...SERVED, presentation: true })),
		);
	});

	it('fills the gap with a dashed rule rather than leaving it blank', () => {
		// The same hairline leader a failed leg draws to its outcome column. Without it the plate
		// is a thin line in a void, which is what the full-width version was avoiding. Slate, not
		// `--color-rule`: rule is 1.25:1 on the light ground, i.e. absent rather than faint.
		const shed = render({ ...SHED, presentation: true });
		const ghost = lines(shed).filter((l) => l.dashed && l.stroke === 'var(--color-slate)');
		expect(ghost).toHaveLength(1);
	});
});

describe('a request belongs to no provider until it enters a line', () => {
	it('draws nothing in a provider colour when no provider was tried', () => {
		// The colour change at the first station is the moment the request becomes somebody's
		// line. A shed request never gets one, so no line colour may appear.
		const shed = render({ ...SHED, presentation: true });
		expect(shed).not.toMatch(/--color-line-\d/);
	});

	it('describes a shed request as untried for a screen reader', () => {
		const described = render({ ...SHED, presentation: false });
		expect(described).toContain('No provider was tried');
	});
});
