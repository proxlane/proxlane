/**
 * Search across the docs, entirely in the browser.
 *
 * NO SERVICE, and that is a product decision rather than a cost one. This site's pitch is
 * that it does not leak — it self-hosts its fonts for the same reason — and a hosted search
 * box sends every question a reader types about a scraping gateway to a third party. The
 * whole corpus is seven pages; the index is smaller than one of the photographs a typical
 * docs site ships without thinking about it.
 *
 * BUILT ON THE NATIVE `<dialog>`. Focus trapping, Escape, the backdrop, making the rest of
 * the page inert and restoring focus on close are all behaviours it already has and that a
 * hand-rolled modal gets wrong in at least one of those five ways. `packages/ui` is where a
 * wrapped Base UI primitive would live, but it holds only tokens today, and half-wrapping a
 * dialog as a side effect of adding search would be the wrong place to make that decision.
 */

import index from 'virtual:docs-search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Hit {
	readonly path: string;
	readonly page: string;
	readonly heading: string;
	readonly excerpt: string;
	readonly score: number;
}

/**
 * Rank a record against the query.
 *
 * Deliberately simple and deliberately explainable: every term must appear somewhere, and
 * where it appears decides the weight. A heading match outranks a body match because someone
 * typing "backpressure" wants the section called Backpressure, not the paragraph elsewhere
 * that mentions it in passing.
 *
 * No stemming and no fuzzy matching. Both would turn a predictable tool into one that
 * sometimes surprises you, over a corpus small enough that exact substring matching finds
 * everything a reader is likely to type.
 */
function score(record: (typeof index)[number], terms: readonly string[]): number {
	const heading = record.heading.toLowerCase();
	const page = record.page.toLowerCase();
	const text = record.text.toLowerCase();
	let total = 0;
	for (const term of terms) {
		const inHeading = heading.includes(term);
		const inPage = page.includes(term);
		const inText = text.includes(term);
		if (!inHeading && !inPage && !inText) return 0; // Every term must match somewhere.
		if (inHeading) total += heading.startsWith(term) ? 12 : 8;
		if (inPage) total += 3;
		if (inText) total += 1;
	}
	return total;
}

/** A window of the body around the first match, so a hit shows why it matched. */
function excerpt(text: string, term: string): string {
	const at = text.toLowerCase().indexOf(term);
	if (at === -1) return text.slice(0, 120);
	const from = Math.max(0, at - 40);
	const slice = text.slice(from, from + 150).trim();
	return `${from > 0 ? '…' : ''}${slice}${from + 150 < text.length ? '…' : ''}`;
}

function search(query: string): Hit[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];
	const first = terms[0] as string;
	return index
		.map((record) => ({ record, score: score(record, terms) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 8)
		.map(({ record, score: s }) => ({
			path: record.path,
			page: record.page,
			heading: record.heading,
			excerpt: excerpt(record.text, first),
			score: s,
		}));
}

export function DocSearch() {
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState('');
	const [cursor, setCursor] = useState(0);
	const navigate = useNavigate();

	const hits = useMemo(() => search(query), [query]);

	const open = useCallback(() => {
		setQuery('');
		setCursor(0);
		dialog.current?.showModal();
		// After `showModal`, or focus lands on the dialog rather than the field.
		input.current?.focus();
	}, []);

	const close = useCallback(() => dialog.current?.close(), []);

	const go = useCallback(
		(path: string) => {
			close();
			// A fragment needs the browser's own anchor handling, and TanStack's `to` takes the
			// two apart. Splitting here keeps client-side routing for the page change and still
			// lands on the heading.
			const [to, hash] = path.split('#');
			void navigate({ to: to as string, ...(hash === undefined ? {} : { hash }) });
		},
		[close, navigate],
	);

	// Cmd+K, Ctrl+K, and `/` — the three bindings a developer will try without being told.
	// `/` is ignored while typing, or it would hijack every slash in a form field.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const typing =
				e.target instanceof HTMLElement &&
				(e.target.tagName === 'INPUT' ||
					e.target.tagName === 'TEXTAREA' ||
					e.target.isContentEditable);
			if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
				e.preventDefault();
				open();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open]);

	const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setCursor((c) => (hits.length === 0 ? 0 : (c + 1) % hits.length));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setCursor((c) => (hits.length === 0 ? 0 : (c - 1 + hits.length) % hits.length));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const hit = hits[cursor];
			if (hit !== undefined) go(hit.path);
		}
	};

	return (
		<>
			{/* An explicit label rather than `aria-hidden` on the `<kbd>`. Hiding part of a
			    focusable element's content truncates its accessible name, and the shortcut is
			    worth announcing anyway — it is the fastest way in for the people most likely to
			    be using a screen reader with a keyboard. */}
			<button
				type="button"
				onClick={open}
				className="doc-search-trigger"
				aria-label="Search the documentation. Shortcut: Command or Control K"
			>
				<span>Search</span>
				<kbd>⌘K</kbd>
			</button>

			{/* `closedby="any"` gives click-outside-to-dismiss without a backdrop listener.
			    `onClose` resets, so reopening never shows the previous query's results. */}
			<dialog
				ref={dialog}
				className="doc-search-dialog"
				aria-label="Search documentation"
				onClose={() => {
					setQuery('');
					setCursor(0);
				}}
			>
				<div className="doc-search-field">
					<input
						ref={input}
						type="search"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setCursor(0);
						}}
						onKeyDown={onInputKey}
						placeholder="Search the docs"
						aria-label="Search the docs"
						autoComplete="off"
						spellCheck={false}
					/>
					<button type="button" onClick={close} className="doc-search-close">
						esc
					</button>
				</div>

				{query.trim() !== '' && (
					<ul className="doc-search-results">
						{hits.length === 0 && (
							<li className="doc-search-empty">
								No match for “{query}”. Try an outcome name, a parameter, or a header.
							</li>
						)}
						{hits.map((hit, i) => (
							<li key={hit.path}>
								<button
									type="button"
									onClick={() => go(hit.path)}
									onMouseEnter={() => setCursor(i)}
									data-active={i === cursor ? '' : undefined}
								>
									<span className="doc-search-heading">{hit.heading}</span>
									<span className="doc-search-page">{hit.page}</span>
									<span className="doc-search-excerpt">{hit.excerpt}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</dialog>
		</>
	);
}
