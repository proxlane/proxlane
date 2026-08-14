/**
 * Keep every code tab set on the same language, and remember the choice.
 *
 * PURE ENHANCEMENT. Switching already works without this: the tabs are a radio group and four
 * static CSS rules, so with JavaScript off or still loading the page is fully operable. What
 * this adds is the behaviour a reader expects once there is more than one sample on a page —
 * picking Python at the top should not leave the example three sections down showing cURL.
 *
 * Matched by LABEL, not by index. The groups do not all offer the same languages in the same
 * order, so syncing position would switch a two-tab group to whatever happens to sit at index
 * two elsewhere.
 */
const KEY = 'proxlane-docs-lang';

function selectLanguage(root: HTMLElement, lang: string): void {
	for (const group of Array.from(root.querySelectorAll<HTMLElement>('.doc-tabs'))) {
		const label = group.querySelector<HTMLLabelElement>(
			`.doc-tab[data-lang="${CSS.escape(lang)}"]`,
		);
		if (label === null) continue; // This group does not offer it. Leave it alone.
		const input = group.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`);
		if (input !== null) input.checked = true;
	}
}

/**
 * Wire one docs page. Returns a teardown.
 *
 * The stored choice is applied on mount, which is a deliberate hydration mismatch: the server
 * cannot know it, so the first tab renders checked and is corrected here. Radios are not
 * React-controlled, so this costs no re-render and produces no warning.
 */
export function syncCodeTabs(root: HTMLElement): () => void {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(KEY);
	} catch {
		// Private mode, or storage disabled. The tabs still work; they just do not persist.
	}
	if (stored !== null) selectLanguage(root, stored);

	const onChange = (event: Event) => {
		const input = event.target;
		if (!(input instanceof HTMLInputElement) || !input.classList.contains('doc-tab-input'))
			return;
		const label = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
		const lang = label?.dataset.lang;
		if (lang === undefined) return;
		selectLanguage(root, lang);
		try {
			localStorage.setItem(KEY, lang);
		} catch {
			// As above. Syncing this page still worked.
		}
	};

	// Delegated, so groups rendered later are covered without rebinding.
	root.addEventListener('change', onChange);
	return () => root.removeEventListener('change', onChange);
}
