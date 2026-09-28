// Whether a page contains the element a caller asked the renderer to wait for.
//
// `wait_for` names the finish line, and a provider that honours it holds its snapshot until the
// element exists. Honouring is not the same as reaching it: measured 2026-09-28, Firecrawl waited
// about ten seconds for a selector that never appeared and then returned the page as a success.
// So the gateway checks the bytes, the same way it checks a 200 for a block page.
//
// NOT A CSS ENGINE, on purpose. Three answers, and the third is the honest one:
//
//   true       the selector is simple enough to judge, and an element matching it is present
//   false      it is simple enough to judge, and no element matches
//   undefined  it is not simple enough (a combinator, a pseudo-class), so nothing is claimed
//
// Simple means a compound of a tag, `#id`, `.class`, `[attr]` and `[attr=value]`, or a comma list
// of those. That covers the selectors people wait on (`#results`, `.listing`, `div.item`,
// `[data-loaded]`) without a parser dependency on the hot path. A selector this cannot judge is
// reported as unverified, never guessed at: a false `false` fails over a page that was fine.

/** One compound selector: `div.item#main[data-x="1"]`. */
interface Compound {
	readonly tag?: string;
	/** Every `#id` in the compound. Two different ones can never both match, and so never do. */
	readonly ids: readonly string[];
	readonly classes: readonly string[];
	readonly attrs: readonly { readonly name: string; readonly value?: string }[];
}

const IDENT = '-?[_a-zA-Z][-_a-zA-Z0-9]*';
const COMPOUND = new RegExp(
	`^(${IDENT}|\\*)?((?:#${IDENT}|\\.${IDENT}|\\[\\s*${IDENT}\\s*(?:=\\s*(?:"[^"]*"|'[^']*'|${IDENT})\\s*)?\\])*)$`,
);
const PART = new RegExp(
	`#(${IDENT})|\\.(${IDENT})|\\[\\s*(${IDENT})\\s*(?:=\\s*(?:"([^"]*)"|'([^']*)'|(${IDENT}))\\s*)?\\]`,
	'g',
);

function parseCompound(text: string): Compound | undefined {
	const m = COMPOUND.exec(text);
	if (m === null) return undefined;
	const tag = m[1] === undefined || m[1] === '*' ? undefined : m[1].toLowerCase();
	const ids: string[] = [];
	const classes: string[] = [];
	const attrs: { name: string; value?: string }[] = [];
	for (const p of (m[2] ?? '').matchAll(PART)) {
		if (p[1] !== undefined) ids.push(p[1]);
		else if (p[2] !== undefined) classes.push(p[2]);
		else if (p[3] !== undefined) {
			const value = p[4] ?? p[5] ?? p[6];
			attrs.push({ name: p[3].toLowerCase(), ...(value === undefined ? {} : { value }) });
		}
	}
	if (tag === undefined && ids.length === 0 && classes.length === 0 && attrs.length === 0) {
		return undefined;
	}
	return { ...(tag === undefined ? {} : { tag }), ids, classes, attrs };
}

/** A comma list of compounds, or undefined if any member is beyond what this can judge. */
export function parseSimpleSelector(selector: string): readonly Compound[] | undefined {
	const members = selector.split(',').map((s) => s.trim());
	if (members.some((s) => s === '')) return undefined;
	const out: Compound[] = [];
	for (const s of members) {
		const c = parseCompound(s);
		if (c === undefined) return undefined;
		out.push(c);
	}
	return out;
}

/**
 * Every start tag, with its attributes, by a hand-written scan rather than a regex.
 *
 * LINEAR, AND QUOTE-AWARE. A single regex for a start tag needs nested quantifiers, which
 * backtrack badly on a malformed multi-megabyte page, and the simple `<[^>]*>` ends a tag at the
 * first `>` even inside `title="a > b"` and loses every attribute after it. This walks each tag
 * once, skipping quoted values with `indexOf`.
 */
function* startTags(html: string): Generator<{ tag: string; attrs: Map<string, string> }> {
	const isSpace = (ch: string | undefined) =>
		ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
	let i = html.indexOf('<');
	while (i !== -1 && i < html.length) {
		let j = i + 1;
		if (!/[a-zA-Z]/.test(html[j] ?? '')) {
			i = html.indexOf('<', j);
			continue;
		}
		while (j < html.length && /[a-zA-Z0-9-]/.test(html[j] as string)) j++;
		const tag = html.slice(i + 1, j).toLowerCase();
		const attrs = new Map<string, string>();
		for (;;) {
			while (isSpace(html[j]) || html[j] === '/') j++;
			if (j >= html.length || html[j] === '>' || html[j] === '<') break;
			const nameStart = j;
			while (j < html.length && !isSpace(html[j]) && !'=>/<'.includes(html[j] as string)) j++;
			const name = html.slice(nameStart, j).toLowerCase();
			while (isSpace(html[j])) j++;
			let value = '';
			if (html[j] === '=') {
				j++;
				while (isSpace(html[j])) j++;
				const q = html[j];
				if (q === '"' || q === "'") {
					const close = html.indexOf(q, j + 1);
					const end = close === -1 ? html.length : close;
					value = html.slice(j + 1, end);
					j = end + 1;
				} else {
					const vStart = j;
					while (j < html.length && !isSpace(html[j]) && html[j] !== '>') j++;
					value = html.slice(vStart, j);
				}
			}
			// The first occurrence wins, as it does in a browser's parser.
			if (name !== '' && !attrs.has(name)) attrs.set(name, value);
		}
		yield { tag, attrs };
		i = html.indexOf('<', j);
	}
}

/**
 * Markup only: comments, and the contents of `script`, `style` and `template`, are removed first.
 * A class name inside a script's string literal is not an element on the page.
 */
function markupOnly(html: string): string {
	// A linear walk, not `<!--[\s\S]*?-->`: a lazy match against an unclosed comment or script
	// rescans to the end of the page from every opener, which is quadratic on a hostile page.
	const lower = html.toLowerCase();
	let out = '';
	let i = 0;
	while (i < html.length) {
		const lt = html.indexOf('<', i);
		if (lt === -1) {
			out += html.slice(i);
			break;
		}
		out += html.slice(i, lt);
		if (html.startsWith('<!--', lt)) {
			const end = html.indexOf('-->', lt + 4);
			i = end === -1 ? html.length : end + 3;
			continue;
		}
		const raw = /^<(script|style|template)\b/.exec(lower.slice(lt, lt + 10))?.[1];
		if (raw !== undefined) {
			const end = lower.indexOf(`</${raw}`, lt + raw.length + 1);
			const close = end === -1 ? -1 : lower.indexOf('>', end);
			i = close === -1 ? html.length : close + 1;
			continue;
		}
		out += '<';
		i = lt + 1;
	}
	return out;
}

function matches(c: Compound, tag: string, attrs: ReadonlyMap<string, string>): boolean {
	if (c.tag !== undefined && c.tag !== tag) return false;
	if (c.ids.some((id) => attrs.get('id') !== id)) return false;
	if (c.classes.length > 0) {
		const have = new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
		if (!c.classes.every((k) => have.has(k))) return false;
	}
	for (const a of c.attrs) {
		const v = attrs.get(a.name);
		if (v === undefined) return false;
		if (a.value !== undefined && v !== a.value) return false;
	}
	return true;
}

/**
 * Whether the decoded page holds an element matching `selector`, or undefined when the selector
 * is beyond what this judges. See the file header for why undefined is an answer.
 */
export function elementPresent(html: string, selector: string): boolean | undefined {
	const compounds = parseSimpleSelector(selector);
	if (compounds === undefined) return undefined;
	for (const { tag, attrs } of startTags(markupOnly(html))) {
		if (compounds.some((c) => matches(c, tag, attrs))) return true;
	}
	return false;
}

/** The same check on bytes, decoded the way `detect()` decodes: the page's charset, or UTF-8. */
export function elementPresentIn(
	body: Uint8Array,
	charset: string | undefined,
	selector: string,
): boolean | undefined {
	let html: string;
	try {
		html = new TextDecoder(charset ?? 'utf-8', { fatal: false }).decode(body);
	} catch {
		html = new TextDecoder('utf-8', { fatal: false }).decode(body);
	}
	return elementPresent(html, selector);
}
