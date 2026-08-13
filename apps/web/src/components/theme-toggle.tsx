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
			// 44px, like every other nav control. A 16px icon in a 24px box is a miss on a phone.
			className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-card text-[color:var(--color-slate)] transition-colors hover:text-[color:var(--color-ink)]"
		>
			{/* Drawn, not a glyph. ☀/☾ are unicode standing in for an icon system: they inherit
			    whatever the font does, they will not match a stroke weight, and on some platforms
			    they render as emoji. One consistent 1.5px stroke instead. */}
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				aria-hidden="true"
			>
				{theme === 'dark' ? (
					<>
						<circle cx="8" cy="8" r="3.25" />
						<path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
					</>
				) : (
					<path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
				)}
			</svg>
		</button>
	);
}
