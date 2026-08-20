// `pnpm tokens:check` — the design spec, enforced rather than remembered.
//
// `docs/design.md` names three failure conditions and says outright that they are "checked by
// `pnpm tokens:check`, not by eye": the ground is never `#0A0A0A`, the paper is never
// `#F4F1EA`, and no serif appears anywhere. Those are the AI-default clusters the direction
// was chosen to avoid, and they are the ones that creep back one convenient commit at a time.
//
// It checks four more things, each because the alternative is a claim nobody verifies:
//
//   the palette matches design.md      a spec and an implementation that disagree mean one of
//                                      them is decoration. Parsed from the doc, not copied.
//   both variants define every token   a role missing from dark renders as `inherit`, which
//                                      looks fine on the developer's machine and wrong on the
//                                      viewer's.
//   contrast, per role                 design.md requires "contrast checked on both variants".
//                                      Text is held to 4.5:1, graphical strokes to 3:1.
//   no raw hex outside the token file  the single thing that stops drift. A component reaching
//                                      for `#3b82f6` is how a design system becomes a suggestion.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = join(ROOT, 'packages/ui/src/theme.css');
const SPEC = join(ROOT, 'docs/design.md');

const failures: string[] = [];
const fail = (msg: string): void => {
	failures.push(msg);
};

// ---------------------------------------------------------------- colour maths

/** Relative luminance, WCAG 2.1. */
function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------- parsing

/** `--color-ink: #14171a;` pairs inside one CSS block. */
function tokensIn(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
		const name = m[1];
		const value = m[2];
		if (name !== undefined && value !== undefined) out[name] = value.trim().toLowerCase();
	}
	return out;
}

/**
 * Source with comments removed.
 *
 * The banned-value scan fired on its first run against the comment that documents the ban:
 * `theme.css` says "never becomes #F4F1EA", and a naive `includes()` cannot tell an
 * explanation from a violation. This repo has hit that exact shape before, in the structural
 * test that matched the pattern quoted in its own comment.
 *
 * Stripping is the fix rather than deleting the comment, because the comment is the reason
 * anyone will understand the rule in six months.
 */
export function code(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The body of the first block whose selector matches `marker`.
 *
 * A REGEX, not a literal. This matched the literal `[data-theme='dark']` until Biome
 * reformatted the file to double quotes, at which point the dark block silently parsed as
 * empty and the check reported missing tokens that were right there. A parser that a
 * formatter can defeat is a parser that will be defeated.
 */
function blockAfter(source: string, marker: RegExp): string {
	const found = marker.exec(source);
	const at = found?.index ?? -1;
	if (at === -1) return '';
	const open = source.indexOf('{', at);
	if (open === -1) return '';
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}') {
			depth--;
			if (depth === 0) return source.slice(open + 1, i);
		}
	}
	return '';
}

/** The palette block in `design.md`, which is the source of truth for the light variant. */
function specPalette(): Record<string, string> {
	const doc = readFileSync(SPEC, 'utf8');
	const out: Record<string, string> = {};
	for (const m of doc.matchAll(/--map-([a-z0-9-]+)\s+(#[0-9a-fA-F]{6})/g)) {
		const name = m[1];
		const value = m[2];
		if (name !== undefined && value !== undefined) out[name] = value.toLowerCase();
	}
	return out;
}

// ---------------------------------------------------------------- the checks

if (!existsSync(THEME)) {
	process.stderr.write(`tokens:check: no token file at ${relative(ROOT, THEME)}\n`);
	process.exit(1);
}

const cssRaw = readFileSync(THEME, 'utf8');
// Comments stripped BEFORE any scan: see `code()`.
const css = code(cssRaw);
const light = tokensIn(blockAfter(css, /@theme\b/));
const dark = tokensIn(blockAfter(css, /\[data-theme=['"]dark['"]\]/));

// Non-zero denominator, twice. A regex that silently matched nothing would make every
// assertion below vacuous, and a green check that examined no tokens is the exact shape of
// vacuous pass this repo is arranged against.
if (Object.keys(light).length < 8)
	fail(`parsed only ${Object.keys(light).length} light tokens`);
if (Object.keys(dark).length < 4) fail(`parsed only ${Object.keys(dark).length} dark tokens`);

// 1-2. The two banned grounds, from design.md's own failure conditions.
for (const [banned, why] of [
	['#0a0a0a', 'the near-black AI cluster'],
	['#f4f1ea', 'the cream AI cluster'],
] as const) {
	if (css.toLowerCase().includes(banned)) fail(`${banned} appears in theme.css — ${why}`);
}

// 3. No serif anywhere. It is what tips this palette into the cream cluster.
for (const m of css.matchAll(/--font-[a-z-]*:\s*([^;]+);/g)) {
	const stack = (m[1] ?? '').toLowerCase();
	// `ui-sans-serif` and `sans-serif` both contain "serif"; only a real serif is a failure.
	const cleaned = stack.replace(/\b(ui-)?sans-serif\b/g, '');
	if (/\bserif\b|georgia|times|garamond|playfair|merriweather/.test(cleaned)) {
		fail(`a serif appears in a font token: ${stack}`);
	}
}

// 3b. `@theme static`, not a bare `@theme`.
//
// This check reads the SOURCE, and Tailwind decides what reaches the OUTPUT. A bare `@theme`
// emits only variables its scanner sees in a utility class, so a token used in an SVG
// attribute is dropped — present here, absent in the bundle, and this check green either way.
// That is exactly the shape of a measurement narrower than the claim it supports: two line
// colours shipped missing and the diagram rendered a provider's leg invisible.
if (!/@theme\s+static\b/.test(css)) {
	fail(
		'theme.css uses a bare `@theme`; use `@theme static` or Tailwind tree-shakes tokens that are only referenced outside utility classes',
	);
}

// 4. The palette agrees with design.md, parsed rather than trusted.
const spec = specPalette();
if (Object.keys(spec).length < 5) fail('parsed fewer than 5 colours from design.md');
const SPEC_TO_TOKEN: Record<string, string> = {
	ink: 'color-ink',
	slate: 'color-slate',
	paper: 'color-ground',
	'line-1': 'color-line-1',
	'line-2': 'color-line-2',
	'line-3': 'color-line-3',
	'line-4': 'color-line-4',
	accent: 'color-accent',
	surface: 'color-surface',
};
for (const [specName, tokenName] of Object.entries(SPEC_TO_TOKEN)) {
	const want = spec[specName];
	const got = light[tokenName];
	if (want === undefined) fail(`design.md no longer defines --map-${specName}`);
	else if (got === undefined) fail(`theme.css is missing --${tokenName}`);
	else if (got !== want) fail(`--${tokenName} is ${got}, design.md says ${want}`);
}

// 5. Every colour role exists in both variants. One missing from dark inherits the light
//    value and looks correct to whoever is not in dark mode.
for (const name of Object.keys(light)) {
	if (!name.startsWith('color-')) continue;
	if (!(name in dark)) fail(`--${name} has no dark value`);
}

// 6. Contrast, on both grounds, at the threshold the role actually needs.
//    Text is 4.5:1. Provider lines are graphical objects at 3:1 — they are 3px strokes on a
//    diagram, and holding a stroke to body-text contrast would force the palette pale.
const ROLES: ReadonlyArray<readonly [string, number, string]> = [
	['color-ink', 4.5, 'body text'],
	['color-slate', 4.5, 'secondary text'],
	['color-line-1', 3, 'diagram stroke'],
	['color-line-2', 3, 'diagram stroke'],
	['color-line-3', 3, 'diagram stroke'],
	['color-line-4', 3, 'diagram stroke'],
	// Type, fills and the focus ring — never a stroke on the map — so it is held to the text
	// floor rather than the graphical one.
	['color-accent', 4.5, 'accent text and focus ring'],
];
for (const [variant, tokens] of [
	['light', light],
	['dark', dark],
] as const) {
	const ground = tokens['color-ground'];
	if (ground === undefined) {
		fail(`${variant} has no --color-ground`);
		continue;
	}
	// AGAINST EVERY GROUND TEXT ACTUALLY LANDS ON, not just the page one. Panels are drawn on
	// `--color-surface`, so checking only `--color-ground` would be a measurement narrower than
	// the claim it supports: the palette would pass while the code inside every panel — which
	// is most of the text on the marketing page — went unchecked.
	const surface = tokens['color-surface'];
	const grounds: ReadonlyArray<readonly [string, string]> = [
		['ground', ground],
		...(surface === undefined ? [] : ([['surface', surface]] as const)),
	];
	for (const [groundName, groundValue] of grounds) {
		for (const [role, min, what] of ROLES) {
			const value = tokens[role];
			if (value === undefined) continue;
			const got = contrast(value, groundValue);
			if (got < min) {
				fail(
					`${variant}: --${role} ${value} on ${groundName} ${groundValue} is ` +
						`${got.toFixed(2)}:1, below ${min}:1 for ${what}`,
				);
			}
		}
	}
}

// 7. The favicon is drawn from the palette and nothing else.
//    It is a standalone SVG, so it cannot read the token layer and has to write every colour
//    literally — the one file where the brand can drift alone and silently while the palette
//    stays self-consistent. It carries a `prefers-color-scheme` block of its own, because a
//    favicon sits on browser chrome this project does not control, so BOTH variants count as
//    legitimate. Anything outside the two is a colour nobody chose.
//
//    THE SOCIAL CARD IS THE SAME KIND OF FILE and is checked the same way. It is standalone SVG
//    rendered to `og.png`, so it writes every colour literally too, and it is the file with the
//    worst drift record in the repo: the previous card was a sourceless PNG that spent six days
//    showing a wordmark the project had already retired. Its own header comment promises this
//    check runs over it, so it does.
const STANDALONE_SVG = [
	'apps/web/public/favicon.svg',
	'apps/web/src/og-card.svg',
	// Pure white is not a palette token and is legitimate here: the card's diagram sits on a
	// raised panel, which `design.md` draws above `--color-ground` rather than in it.
] as const;
{
	const palette = new Set(
		[...Object.values(light), ...Object.values(dark)]
			.filter((v) => /^#[0-9a-fA-F]{6}$/.test(v))
			.map((v) => v.toLowerCase()),
	);
	palette.add('#ffffff');
	if (palette.size < 8) fail(`parsed only ${palette.size} palette colours to check against`);
	let scanned = 0;
	for (const rel of STANDALONE_SVG) {
		const file = join(ROOT, rel);
		if (!existsSync(file)) continue;
		const found = [...readFileSync(file, 'utf8').matchAll(/#[0-9a-fA-F]{6}/g)].map((m) =>
			m[0].toLowerCase(),
		);
		if (found.length === 0) fail(`${rel} declares no colour at all`);
		const stray = [...new Set(found)].filter((h) => !palette.has(h));
		if (stray.length > 0)
			fail(`${rel} uses ${stray.join(', ')}, which the palette does not define`);
		scanned += 1;
	}
	// Both files are tracked, so a zero here means the list stopped matching the tree.
	if (scanned === 0) fail('no standalone SVG was scanned — this check stopped checking');
}

// 8. No raw hex outside the token file. The one check that stops the system becoming a
//    suggestion: a component reaching for `#3b82f6` bypasses every rule above.
const SEARCH = ['packages/ui/src', 'packages/route-viz/src', 'apps/web/src'];
let scanned = 0;
function walk(dir: string): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			walk(path);
			continue;
		}
		if (!['.ts', '.tsx', '.css'].includes(extname(entry))) continue;
		if (path === THEME) continue;
		scanned++;
		// Comments stripped for the same reason: a comment naming a colour it forbids
		// must not be reported as using it.
		const text = code(readFileSync(path, 'utf8'));
		for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
			const hex = m[0];
			// `#fff` inside a URL fragment or an id selector is not a colour; require a
			// colour-ish context to avoid crying wolf.
			const around = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
			if (/(color|fill|stroke|background|shadow|border)/i.test(around)) {
				fail(`${relative(ROOT, path)} hardcodes ${hex} — use a token`);
			}
		}
	}
}
for (const dir of SEARCH) walk(join(ROOT, dir));

// 8. ONE LINE SLOT PER PROVIDER, and a token behind every slot in use.
//
//    The failure this exists for already happened. `line` was typed `1 | 2 | 3` while a fourth
//    adapter was being written, so Bright Data took slot 1 — the only way to compile — and was
//    drawn in ScraperAPI's teal. A failover between those two rendered as one unbroken colour,
//    which is the single event the diagram exists to make visible, and every check passed:
//    `tokens:check` verified the tokens that existed, conformance never looks at colour, and
//    the type system was satisfied because the collision was legal.
//
//    Parsed from the capabilities files rather than imported, so this runs without a build and
//    cannot be defeated by a stale `dist`.
const capsDir = join(ROOT, 'packages/adapters/src');
const slots = new Map<number, string[]>();
for (const entry of readdirSync(capsDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const file = join(capsDir, entry.name, 'capabilities.ts');
	if (!existsSync(file)) continue;
	const m = /^\s*line:\s*(\d+)\s*,/m.exec(readFileSync(file, 'utf8'));
	if (m === null) {
		fail(`${entry.name} declares no line slot in capabilities.ts`);
		continue;
	}
	const n = Number(m[1]);
	slots.set(n, [...(slots.get(n) ?? []), entry.name]);
}
if (slots.size === 0) fail('parsed zero provider line slots — the capabilities glob is wrong');
for (const [n, owners] of [...slots].sort((a, b) => a[0] - b[0])) {
	if (owners.length > 1) {
		fail(
			`line slot ${n} is claimed by ${owners.join(' and ')} — they would be drawn in the same colour, ` +
				'so a failover between them is invisible',
		);
	}
	if (!(`color-line-${n}` in light))
		fail(`${owners.join(', ')} uses line ${n}, which has no token`);
}

// ---------------------------------------------------------------- report

if (failures.length > 0) {
	process.stderr.write('\n  tokens:check failed\n\n');
	for (const f of failures) process.stderr.write(`    ${f}\n`);
	process.stderr.write('\n  docs/design.md is the spec.\n\n');
	process.exit(1);
}

process.stdout.write(
	`\n  tokens ok — ${Object.keys(light).length} light, ${Object.keys(dark).length} dark, ` +
		`contrast checked on page and panel grounds, ${scanned} source file(s) free of raw hex\n\n`,
);
