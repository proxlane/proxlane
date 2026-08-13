import { useEffect, useState } from 'react';

/**
 * Light / dark, stored and remembered.
 *
 * `design.md` chooses light-first deliberately — it is the least AI-default direction in a
 * category where every competing link is dark — and requires the dark variant be built in the
 * same pass rather than retrofitted. A toggle is what makes that a real choice for the viewer
 * instead of an assertion about taste.
 *
 * The initial value is stamped on `<html>` by a blocking script in `__root.tsx`, before first
 * paint. This component only reads it back and writes changes, so there is no flash and no
 * state that disagrees with what is on screen.
 */
type Theme = 'light' | 'dark';

const KEY = 'proxlane-theme';

function current(): Theme {
	if (typeof document === 'undefined') return 'light';
	return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
	// `undefined` until mounted: the server cannot know which theme the client picked, and
	// rendering a guess would make the button briefly say the wrong thing.
	const [theme, setTheme] = useState<Theme | undefined>(undefined);

	useEffect(() => {
		setTheme(current());
	}, []);

	function toggle() {
		const next: Theme = current() === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', next);
		try {
			localStorage.setItem(KEY, next);
		} catch {
			// Private browsing, or storage disabled. The toggle still works for this page; it
			// just will not be remembered. Failing the click over it would be worse.
		}
		setTheme(next);
	}

	return (
		<button
			type="button"
			onClick={toggle}
			// The label states what it will DO, not what is currently on. "Dark" as a label is
			// ambiguous about whether it describes the state or the action.
			aria-label={
				theme === undefined
					? 'Switch theme'
					: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
			}
			className="rounded-[--radius-card] px-2 py-1 text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]"
		>
			{theme === undefined ? '◐' : theme === 'dark' ? '☀' : '☾'}
		</button>
	);
}
