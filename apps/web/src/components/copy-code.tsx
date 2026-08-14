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

export function useCopyButtons(scope: React.RefObject<HTMLElement | null>) {
	useEffect(() => {
		const root = scope.current;
		if (root === null) return;
		// `navigator.clipboard` is absent on insecure origins. Adding a button that silently
		// does nothing is worse than not adding one.
		if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;

		const cleanups: (() => void)[] = [];
		for (const pre of Array.from(root.querySelectorAll('pre'))) {
			if (pre.querySelector('[data-copy]') !== null) continue;
			pre.classList.add('doc-pre');

			const button = document.createElement('button');
			button.type = 'button';
			button.dataset.copy = '';
			button.className = 'doc-copy';
			button.textContent = 'copy';
			// The button sits inside `<pre>`, so a screen reader would otherwise read it as part
			// of the code. The label says what it copies; the text is decoration.
			button.setAttribute('aria-label', 'Copy code to clipboard');

			let timer: ReturnType<typeof setTimeout> | undefined;
			const onClick = () => {
				const code = pre.querySelector('code')?.textContent ?? '';
				void navigator.clipboard.writeText(code).then(
					() => {
						button.textContent = 'copied';
						button.dataset.state = 'done';
						clearTimeout(timer);
						timer = setTimeout(() => {
							button.textContent = 'copy';
							delete button.dataset.state;
						}, 1600);
					},
					() => {
						// A denied clipboard permission must say so rather than appear to succeed.
						button.textContent = 'failed';
						clearTimeout(timer);
						timer = setTimeout(() => {
							button.textContent = 'copy';
						}, 1600);
					},
				);
			};
			button.addEventListener('click', onClick);
			pre.appendChild(button);
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
	return (
		<div
			ref={ref}
			className="doc-prose max-w-[46rem]"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
