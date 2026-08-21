/**
 * The artifacts a page is built from: a labelled frame, a copy control, a terminal transcript.
 *
 * THEY WERE TRAPPED IN `routes/index.tsx`, all four of them, declared inside a 1,239-line route
 * module and exported nowhere. The landing page could use them and nothing else could, so the
 * second page that needed a code block had a choice between importing a route or writing the
 * frame again. That is how a design system becomes two design systems.
 *
 * Nothing here is new and nothing changed. This is the same code, moved so it can be imported,
 * which is the whole point of the commit that created this file.
 *
 * NOT `packages/ui`. That layer wraps Base UI and owns the token primitives. These are app
 * compositions built ON those primitives, and the boundary is worth keeping: a `Panel` knows
 * what a transcript looks like on this site, which is not a thing a component library should
 * have an opinion about.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Real output from `proxlane outcomes SOFT_BLOCK --json`, pasted verbatim.
 *
 * Every CLI command takes `--json`, which is the whole agent story and is shipped today — so
 * this is a transcript, not a mock-up. `chargeable: false` is hosted billing, which only ever
 * charges on OK; the provider still charged for the attempt, which is what `x-cost-estimate`
 * reports.
 */
export interface Block {
	readonly cmd?: string;
	readonly out?: string;
}

/**
 * Copy to clipboard, with the one state that matters shown.
 *
 * A code block a developer cannot copy is a picture of code. The confirmation is a label
 * change rather than a toast: the feedback belongs on the control that was pressed, and
 * `aria-live` is what carries it to anyone who cannot see the swap.
 */
export function CopyButton({ text, what }: { readonly text: string; readonly what: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Clearing on unmount is not tidiness: a section can leave the tree while the 2s timer is
	// still pending, and setting state after that logs a warning and leaks the handle.
	useEffect(() => () => clearTimeout(timer.current), []);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Denied permission, or no clipboard in this context. Say nothing rather than claim
			// a copy that did not happen — a false "Copied" is worse than a button that did not
			// visibly respond, because the paste fails somewhere else entirely.
			return;
		}
		setCopied(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), 2000);
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={`Copy ${what}`}
			// 44px, and the panel bar carries no padding of its own so this control sets the bar's
			// height rather than stacking with it.
			className={`-mr-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-card px-2 font-mono text-xs transition-colors ${copied ? 'text-[color:var(--color-accent)]' : 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'}`}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{copied ? (
					<path d="M3 8.5 6.5 12 13 4.5" />
				) : (
					<>
						<rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5" />
						<path d="M10.25 3.25a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5" />
					</>
				)}
			</svg>
			<span aria-live="polite">{copied ? 'copied' : 'copy'}</span>
		</button>
	);
}

/**
 * A terminal session: the command types, the output streams in line by line, the caret keeps
 * blinking.
 *
 * TYPING IS CHARACTER-WISE ON COMMANDS AND LINE-WISE ON OUTPUT, because that is how a shell
 * behaves — you type an instruction, the program emits rows. Revealing the output as one block
 * made the panel jump fifteen lines taller the instant it appeared, and character-typing it
 * would hold a reader off the content for the sake of an effect.
 *
 * THE HEIGHT IS RESERVED. A hidden copy of the finished transcript sits in the same grid cell,
 * so the panel is full height from the first frame and nothing below it moves. `visibility`
 * rather than `opacity`, because only the former keeps the box while dropping it from the
 * accessibility tree.
 *
 * It starts on scroll-into-view, once. State begins COMPLETE so the server renders the whole
 * transcript and hydration matches; an effect rewinds it before typing, so there is no flash
 * of finished text and no animation at all when JavaScript never arrives or motion is refused.
 *
 * The visible copy is `aria-hidden` with the full text alongside in an `sr-only` node:
 * mid-animation the DOM genuinely holds a truncated command, and a screen reader must never be
 * handed half an instruction.
 */
export const CHARS_PER_TICK = 2;

export function Transcript({ blocks }: { readonly blocks: readonly Block[] }) {
	const units = blocks.map((b) =>
		b.cmd === undefined
			? (b.out ?? '').split('\n').length
			: Math.ceil(b.cmd.length / CHARS_PER_TICK),
	);
	const total = units.reduce((n, u) => n + u, 0);
	const [step, setStep] = useState(total);
	const ref = useRef<HTMLDivElement | null>(null);
	const plan = useRef({ blocks, units });
	plan.current = { blocks, units };

	useEffect(() => {
		const node = ref.current;
		if (node === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		setStep(0);
		let timer: ReturnType<typeof setTimeout> | undefined;
		// A row of output should not arrive as fast as a keystroke; the two rates are what make
		// it read as a program answering rather than as text appearing.
		const paceAt = (n: number): number => {
			const { blocks: bs, units: us } = plan.current;
			let acc = 0;
			for (let i = 0; i < bs.length; i++) {
				acc += us[i] ?? 0;
				if (n < acc) return bs[i]?.cmd === undefined ? 46 : 26;
			}
			return 26;
		};
		const tick = (n: number): void => {
			if (n >= total) return;
			timer = setTimeout(() => {
				setStep(n + 1);
				tick(n + 1);
			}, paceAt(n));
		};
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					tick(0);
				}
			},
			{ threshold: 0.25 },
		);
		io.observe(node);
		return () => {
			io.disconnect();
			clearTimeout(timer);
		};
	}, [total]);

	const full = blocks.map((b) => (b.cmd === undefined ? b.out : `$ ${b.cmd}\n`)).join('');
	const preClass =
		// `whitespace-pre`, NOT `pre-wrap`. This is a terminal. `break-words` was splitting
		// `curl -sD- "localhost:8787/v1?api_key=...` across two lines mid-URL on a phone, which is
		// a command nobody can copy by eye and a transcript that never happened. A real terminal
		// scrolls sideways, so this one does too: `Panel`'s body is already `overflow-x-auto`, with
		// the raspberry scrollbar saying there is more to the right.
		'col-start-1 row-start-1 whitespace-pre font-mono text-[0.8125rem] leading-[1.9]';

	const endsOnOutput = blocks[blocks.length - 1]?.cmd === undefined;
	let before = 0;
	const shown = blocks.map((b, i) => {
		const start = before;
		const size = units[i] ?? 0;
		before += size;
		const local = Math.max(0, Math.min(step - start, size));
		if (local === 0) return null;
		const key = `${i}-${(b.cmd ?? b.out ?? '').slice(0, 24)}`;

		if (b.cmd === undefined) {
			return (
				<span key={key} className="text-[color:var(--color-slate)]">
					{(b.out ?? '').split('\n').slice(0, local).join('\n')}
				</span>
			);
		}
		return (
			<span key={key}>
				<span className="select-none text-[color:var(--color-accent)]">$ </span>
				<span className="font-medium">{b.cmd.slice(0, local * CHARS_PER_TICK)}</span>
				{local === size ? '\n' : ''}
			</span>
		);
	});

	return (
		<div ref={ref} className="grid">
			<p className="sr-only">{full}</p>
			<pre aria-hidden="true" className={`${preClass} invisible`}>
				{full}
			</pre>
			<pre aria-hidden="true" data-transcript className={preClass}>
				<code>
					{shown}
					{/* A shell that has finished printing returns to a fresh prompt on its own line.
					    Left inline the caret sat against the closing brace of the JSON, which reads
					    as a cursor stuck mid-token rather than a session waiting for you. A
					    transcript ending on a command needs no new prompt: you are still typing it. */}
					{endsOnOutput && step >= total && (
						<>
							{'\n'}
							<span className="select-none text-[color:var(--color-accent)]">$ </span>
						</>
					)}
					<span className="proxlane-caret text-[color:var(--color-accent)]">▊</span>
				</code>
			</pre>
		</div>
	);
}

/**
 * The frame every artifact on this page shares.
 *
 * A bare `<pre>` on the page background is what a text file looks like. The label bar names
 * what the block IS — `curl`, `HTTP/1.1 200 OK` — which is the line a developer reads first,
 * and it gives the copy control somewhere to live that is not floating over the code.
 *
 * Opaque, and lifted. The field runs behind the whole document, so a transparent panel would
 * have grid lines running under its code; the ground plus a shadow is what makes it paper on
 * top of a drawing surface rather than a rectangle drawn on one.
 */
export function Panel({
	label,
	copy,
	what,
	bodyClass = 'p-4',
	children,
}: {
	readonly label: string;
	readonly copy?: string;
	readonly what?: string;
	/** Override when the body brings its own vertical rhythm, as a ruled list does. */
	readonly bodyClass?: string;
	readonly children: ReactNode;
}) {
	return (
		<div
			data-panel
			className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel transition-[border-color,box-shadow] duration-300 hover:border-[color:var(--color-slate)]"
		>
			{/* min-h on the BAR, not on the copy button. The bar used to take its height from the
			    button, which meant a panel without one — the registry — had a label sitting flat on
			    the border with no padding at all. Height must not depend on an optional child. */}
			<div className="flex min-h-11 items-center justify-between gap-4 border-[color:var(--color-rule)] border-b pr-2.5 pl-4">
				<span className="font-mono text-[color:var(--color-slate)] text-xs">{label}</span>
				{copy !== undefined && what !== undefined && <CopyButton text={copy} what={what} />}
			</div>
			<div className={`overflow-x-auto ${bodyClass}`}>{children}</div>
		</div>
	);
}
