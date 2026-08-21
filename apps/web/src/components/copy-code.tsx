/**
 * A copy button on every code block.
 *
 * Table stakes on a reference page: the whole reason a snippet exists is to end up in
 * someone's terminal, and selecting a multi-line block by hand is the one interaction that
 * makes documentation feel unfinished.
 *
 * ATTACHED AFTER RENDER RATHER THAN AUTHORED INTO THE HTML. The markdown is turned into
 * finished HTML at build time by `vite-plugin-docs.ts`, and it has no React in it — Shiki
 * emits `<pre class="shiki"><code>`. Rendering a React button *inside* that string is not
 * possible without parsing the HTML back into components, which would throw away the reason
 * the pipeline is build-time. So this walks the rendered tree once on mount and adds one
 * button per `<pre>`.
 *
 * Progressive enhancement by construction: with JavaScript off the page is complete and the
 * code is selectable, exactly as it is now.
 */
import { useEffect, useRef } from 'react';
import { syncCodeTabs } from './tab-sync.js';

export function useCopyButtons(scope: React.RefObject<HTMLElement | null>) {
	useEffect(() => {
		const root = scope.current;
		if (root === null) return;
		// `navigator.clipboard` is absent on insecure origins. Adding a button that silently
		// does nothing is worse than not adding one.
		if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;

		const cleanups: (() => void)[] = [];
		for (const pre of Array.from(root.querySelectorAll('pre'))) {
			// INTO THE BAR, not over the code. The button used to be appended inside `<pre>` and
			// positioned absolutely in the corner, hidden until hover — a second design for the
			// control `artifacts.tsx` already owns, and hover-only puts the most keyboard-reachable
			// thing on a reference page behind a pointer.
			//
			// `.doc-panel-bar` is the frame the markdown plugin now emits around a lone fence, and
			// `.doc-tabs` has had its own bar since it shipped. Falling back to the `<pre>` keeps
			// this working for any code block that reaches the page some other way.
			const panel = pre.closest('.doc-panel, .doc-tabs');
			const bar = panel?.querySelector('.doc-panel-bar');
			// A TAB GROUP'S BAR IS ITS TAB STRIP. There is no `.doc-panel-bar` to find, so the
			// button is inserted before the first panel, which puts it in the label row — the
			// group is a flex-wrap container and the labels come first in DOM order. `margin-left:
			// auto` in the CSS pushes it to the right end of that row.
			//
			// One button per GROUP, not per tab: switching language should not move the control.
			const strip = panel?.classList.contains('doc-tabs') === true ? panel : undefined;
			const host: Element = bar ?? strip ?? pre;
			if (host.querySelector('[data-copy]') !== null) continue;
			if (host === pre) pre.classList.add('doc-pre');

			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.copy = '';
			button.className = 'doc-copy';
			// The same icon-then-label the React `CopyButton` renders, so the two are one control
			// in two places rather than two controls that resemble each other.
			button.innerHTML =
				'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
				'aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>' +
				'<path d="M10.5 3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5"/></svg>' +
				'<span data-copy-label>copy</span>';
			button.setAttribute('aria-label', 'Copy code to clipboard');

			let timer: ReturnType<typeof setTimeout> | undefined;
			const onClick = () => {
				const code = pre.querySelector('code')?.textContent ?? '';
				void navigator.clipboard.writeText(code).then(
					() => {
						const label = button.querySelector('[data-copy-label]');
						if (label !== null) label.textContent = 'copied';
						button.dataset.state = 'done';
						clearTimeout(timer);
						timer = setTimeout(() => {
							const back = button.querySelector('[data-copy-label]');
							if (back !== null) back.textContent = 'copy';
							delete button.dataset.state;
						}, 1600);
					},
					() => {
						// A denied clipboard permission must say so rather than appear to succeed.
						button.textContent = 'failed';
						clearTimeout(timer);
						timer = setTimeout(() => {
							const back = button.querySelector('[data-copy-label]');
							if (back !== null) back.textContent = 'copy';
						}, 1600);
					},
				);
			};
			button.addEventListener('click', onClick);
			if (host === strip) {
				host.insertBefore(button, host.querySelector('.doc-tab-panel'));
			} else {
				host.appendChild(button);
			}
			cleanups.push(() => {
				clearTimeout(timer);
				button.removeEventListener('click', onClick);
				button.remove();
			});
		}
		return () => {
			for (const c of cleanups) c();
		};
	}, [scope]);
}

/** Rendered markdown, with copy buttons attached once it is in the DOM. */
export function ProseWithCopy({ html }: { readonly html: string }) {
	const ref = useRef<HTMLDivElement>(null);
	useCopyButtons(ref);
	// Code tabs work without this; it only keeps several groups on one language. See tab-sync.
	useEffect(() => {
		const root = ref.current;
		return root === null ? undefined : syncCodeTabs(root);
	}, []);
	return (
		<div
			ref={ref}
			className="doc-prose max-w-[46rem]"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
