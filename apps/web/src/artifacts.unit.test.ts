// The page artifacts, against their own rendered markup.
//
// They had no tests, and could not have had any: `Panel`, `Transcript` and `CopyButton` were
// declared inside `routes/index.tsx` and exported nowhere, so nothing could import them to
// render. Moving them out is what made this file possible, and writing it is the reason the
// move was worth doing on its own rather than as a step inside a bigger change.
//
// Asserted on the MARKUP, like `route-diagram.unit.test.ts` next door and for the same reason:
// a snapshot goes green on any change somebody accepts, and these are claims about what the
// artifacts must always do.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

import { type Block, CopyButton, Panel, Transcript } from './components/artifacts.js';

/**
 * Rendered through `createElement`, NOT by calling the component as a function.
 *
 * `Panel` has no hooks so `renderToStaticMarkup(Panel(props))` happens to work, which is what
 * `route-diagram.unit.test.ts` next door does. `CopyButton` and `Transcript` both hold state,
 * and calling those directly runs the hooks outside any render: React throws "Invalid hook
 * call" and the test fails for a reason that has nothing to do with the component.
 */
// biome-ignore lint/suspicious/noExplicitAny: a render helper is generic over component props
const render = (c: any, props: any = {}): string =>
	renderToStaticMarkup(createElement(c, props));

describe('a panel names what the block is', () => {
	it('renders the label, because it is the line read first', () => {
		// `curl`, `HTTP/1.1 200 OK`. Without it a panel is a picture of a text file.
		const html = render(Panel, { label: 'HTTP/1.1 200 OK', children: 'body' });
		expect(html).toContain('HTTP/1.1 200 OK');
	});

	it('renders its children rather than swallowing them', () => {
		const html = render(Panel, { label: 'curl', children: 'the payload' });
		expect(html).toContain('the payload');
	});

	it('offers a copy control only when there is something to copy', () => {
		// A dead control is worse than no control: it invites a click that does nothing.
		// BOTH props are required, and asserting only the pair would miss the half-configured
		// case: `copy` with no `what` would render a button with no accessible name.
		const without = render(Panel, { label: 'curl', children: 'x' });
		const halfway = render(Panel, { label: 'curl', children: 'x', copy: 'x' });
		const with_ = render(Panel, {
			label: 'curl',
			children: 'x',
			copy: 'x',
			what: 'the command',
		});
		expect(without).not.toContain('<button');
		expect(halfway).not.toContain('<button');
		expect(with_).toContain('<button');
	});
});

describe('copy copies the whole thing', () => {
	it('copies the prop, never anything derived from what is on screen', () => {
		// THE FAILURE THIS GUARDS. A transcript animates: it renders a prefix of the command
		// while typing. If the copy control ever took what is on screen rather than what was
		// passed, a reader would paste half a command and it would look like it worked.
		//
		// READ FROM THE SOURCE, AND HERE IS WHY. The earlier version rendered the component and
		// asserted the markup did not contain a truncated copy — but `text` never reaches the
		// markup at all. It goes to `navigator.clipboard.writeText` and nowhere else, so the
		// assertion was true of every possible implementation, including one that copied a
		// slice. Same reasoning as the copy-code injector test: this is a click handler, the
		// unit project has no DOM, so the source is what can be checked.
		const src = readFileSync(join(HERE, 'components', 'artifacts.tsx'), 'utf8');
		expect(src).toMatch(/await navigator\.clipboard\.writeText\(text\);/);
		// And nothing between the prop and the clipboard. A slice, a trim or a lookup at the
		// rendered node is exactly the regression described above.
		expect(src).not.toMatch(/writeText\([^)]*\.(slice|substring|textContent|innerText)/);
	});

	it('says what it will copy, for anyone who cannot see the icon', () => {
		const html = render(CopyButton, { text: 'x', what: 'the response headers' });
		expect(html.toLowerCase()).toContain('the response headers');
	});
});

describe('a transcript shows every block it is given', () => {
	const BLOCKS: readonly Block[] = [
		{ cmd: 'npx proxlane doctor' },
		{ out: '  ok   cooldowns          on' },
		{ cmd: 'curl -sD- "localhost:8787/v1"' },
	];

	it('gives assistive tech the whole transcript, not a frame of the animation', () => {
		// WHAT THIS COMPONENT ACTUALLY OWES A READER, and it took three attempts to test it.
		//
		// `Transcript` renders the text three times: an `sr-only` paragraph with the complete
		// session, an `aria-hidden` <pre> reserving the final height so the panel does not grow
		// while typing, and the animated visual layer, which is also `aria-hidden` and starts
		// empty.
		//
		// So the first version asserted `html.toContain('cooldowns')` and proved nothing: three
		// copies, any one of them matches. Stripping the reservation <pre> was not enough either,
		// because the `sr-only` copy still carried everything. Truncating the render path left
		// this test green, which is how the hole was found.
		//
		// The contract worth pinning is the accessible one: someone who cannot watch the
		// animation still gets every command and every line of output.
		const html = render(Transcript, { blocks: BLOCKS });
		const sr = /<p class="sr-only">([\s\S]*?)<\/p>/.exec(html)?.[1];
		expect(sr, 'the screen-reader copy is missing entirely').toBeDefined();
		for (const needle of ['npx proxlane doctor', 'cooldowns', 'localhost:8787']) {
			expect(sr).toContain(needle);
		}
	});

	it('keeps the animated layer out of the accessibility tree', () => {
		// The visual types a prefix, so it would read as a truncated command. Both non-`sr-only`
		// copies must be hidden, or a screen reader announces the session twice and one of them
		// half-finished.
		const html = render(Transcript, { blocks: BLOCKS });
		expect((html.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it('survives an empty block list without throwing', () => {
		// Reachable: a scenario with nothing to show is a real state, and the animation divides
		// by a total that would be zero.
		expect(() => render(Transcript, { blocks: [] })).not.toThrow();
	});
});
