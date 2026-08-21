// One window for code, asserted against the HTML the docs pipeline actually emits.
//
// THE SITE HAD THREE TREATMENTS for the same thing. The homepage put code in a `Panel`: a
// bordered card with a label bar naming the block and the copy control living in that bar. A tab
// group had the same frame with labels for tabs. A lone docs fence had neither — a bare bordered
// `<pre>` with a text-only copy button floating over the corner, appearing only on hover.
//
// Three chromes for one thing is the sort of drift nobody notices while writing it and everybody
// notices on the page. This holds the rendered output to one shape, which is the only level it
// can be checked at: the frame is added by a renderer rule at build time and the copy control is
// attached by a client effect, so neither is visible in the markdown or in a React tree.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderDoc } from '../vite-plugin-docs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CONTENT = join(ROOT, 'apps/web/content/docs');

/** A page with both shapes on it: lone fences and a tab group. */
const PAGE = 'quickstart.md';

describe('every code block on a docs page sits in a frame', () => {
	it('renders the page at all', async () => {
		// Non-zero denominator. Every claim below is vacuous over an empty render.
		const doc = await renderDoc(join(CONTENT, PAGE), 'quickstart');
		expect(doc.html.length).toBeGreaterThan(500);
		expect(doc.html).toContain('<pre');
	});

	it('leaves no <pre> outside a .doc-panel or a .doc-tabs', async () => {
		// THE ASSERTION THIS FILE EXISTS FOR. A lone fence used to render as a bare `<pre>`, so
		// the same content looked like a different component depending on whether the author
		// happened to write two fences in a row.
		const doc = await renderDoc(join(CONTENT, PAGE), 'quickstart');
		const total = [...doc.html.matchAll(/<pre\b/g)].length;
		expect(total, 'no code blocks on the page to check').toBeGreaterThan(0);

		// Count the `<pre>`s reachable inside each frame by slicing at the frame's opening tag and
		// stopping at the next one — crude, and enough: what matters is that the number of framed
		// blocks equals the number of blocks.
		const framed = doc.html
			.split(/<div class="doc-(?:panel|tabs)"/)
			.slice(1)
			.reduce((n, chunk) => n + [...chunk.matchAll(/<pre\b/g)].length, 0);
		expect(framed, `${total - framed} code block(s) render without a frame`).toBe(total);
	});

	it('names the language in the bar of a lone fence', async () => {
		// The label is what makes it a window rather than a box. `Panel` on the homepage names
		// what the block IS — `terminal`, `response body` — and a docs fence names its language.
		const doc = await renderDoc(join(CONTENT, PAGE), 'quickstart');
		const labels = [...doc.html.matchAll(/<span class="doc-panel-label">([^<]+)</g)].map(
			(m) => m[1],
		);
		expect(labels.length, 'no lone fences on this page').toBeGreaterThan(0);
		for (const l of labels) {
			expect(l?.trim(), 'an empty or placeholder label').not.toBe('');
			expect(l).not.toBe('code');
		}
	});

	it('never puts a bar inside a bar', async () => {
		// A tab group is already a frame, so its members must bypass the wrapper. Getting it wrong
		// nests a labelled panel inside every tab and doubles each border.
		//
		// ASSERTED ON WHAT DIRECTLY FOLLOWS A TAB PANEL, which is the precise form. Two earlier
		// versions were wrong in opposite directions: one sliced at the first `.doc-tab-panel` and
		// looked only BEFORE it, so a nested bar sailed through; the next searched for the bare
		// string `doc-panel`, which `doc-tab-panel` contains, so it failed on everything. A tab
		// panel opens straight onto its `<pre>` — anything between is the wrapper coming back.
		const doc = await renderDoc(join(CONTENT, PAGE), 'quickstart');
		const opens = [
			...doc.html.matchAll(/<div class="doc-tab-panel" data-panel="\d+">(.{0,24})/g),
		];
		expect(opens.length, 'no tab groups on this page to check').toBeGreaterThan(0);
		for (const m of opens) {
			expect(m[1], 'a tab panel does not open onto its code').toMatch(/^<pre\b/);
		}
		// And the frame really is used elsewhere, or this proves only that tabs exist.
		expect(doc.html).toContain('doc-panel-bar');
	});
});

describe('the copy control is one control, not two that resemble each other', () => {
	const injector = readFileSync(join(HERE, 'components', 'copy-code.tsx'), 'utf8');
	const react = readFileSync(join(HERE, 'components', 'artifacts.tsx'), 'utf8');

	it('chooses the bar over the code as its host', () => {
		// WHAT THIS CHECKS AND WHAT IT DOES NOT, because the first version overstated it. The
		// injector is a DOM effect and the unit project has no DOM, so this reads the source. A
		// looser version asserted only that the file mentions `doc-panel-bar`, which survives
		// changing the host back to `pre` — the strings stay in the comments. Verified by
		// mutation, which is how that was caught.
		//
		// The behavioural proof is a browser measurement, not this: at 1100px a docs page renders
		// 0 code blocks outside a frame and every frame's bar holds the control.
		expect(injector).toMatch(/const host: Element = bar \?\? strip \?\? pre;/);
		// Appended into the chosen host, not unconditionally into the `<pre>`.
		expect(injector).not.toMatch(/\bpre\.appendChild\(button\)/);
	});

	it('renders an icon and a label, like the React one', async () => {
		for (const src of [injector, react]) {
			expect(src).toContain('<svg');
		}
		expect(injector).toContain('data-copy-label');
	});

	it('is not hidden behind a pointer', async () => {
		// `opacity: 0` until `:hover` put the most keyboard-reachable control on a reference page
		// behind a mouse. The rule that did it is gone; this fails if it comes back.
		const css = readFileSync(join(ROOT, 'apps/web/src/styles/app.css'), 'utf8');
		const rule = /\.doc-copy\s*\{([^}]*)\}/.exec(css)?.[1];
		expect(rule, 'no .doc-copy rule at all').toBeDefined();
		expect(rule).not.toMatch(/opacity:\s*0\b/);
	});
});
