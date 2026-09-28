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
 * Elements whose contents are text, not markup, in a browser's parser: a class name inside them is
 * not an element on the page. `noscript` matters most, because a rendered page often carries a
 * fallback copy of its own markup there, with the same classes, and counting it would say `true`
 * for a page that lacks the element. `plaintext` never closes.
 */
const RAW_TEXT = new Set([
	'script',
	'style',
	'template',
	'noscript',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'plaintext',
]);
const RAW_CLOSE = new Map(
	[...RAW_TEXT].map((t) => [t, new RegExp(`</${t}(?=[\\s/>])`, 'gi')] as const),
);

/**
 * The largest page this judges, in bytes. Above it the answer is `undefined`, never `false`: a
 * page too big to scan within the hot path's budget is reported unverified rather than failed
 * over. `detect()` bounds itself the same way with SCAN_BYTES.
 *
 * Measured 2026-09-28 on the maintainer's laptop, median of ten runs at this size: a page made
 * of nothing but `<a>` tags, the most tags a target can pack into it, 22ms; one tag with the most
 * distinct attribute names, 9ms; an ordinary page of rows and links, 9ms. A garbage collection
 * during a run can add more; the test holds the worst shape under 250ms so CI noise does not flake.
 */
export const MAX_SELECTOR_SCAN_BYTES = 2 * 1024 * 1024;

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c: number) => isAlpha(c) || (c >= 48 && c <= 57) || c === 45;

/** The entities an attribute value is likely to carry; anything else is compared as written. */
function decodeEntities(v: string): string {
	if (!v.includes('&')) return v;
	return v.replace(
		/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g,
		(m, d, h, n) => {
			if (n !== undefined)
				return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n as 'amp'];
			const code = d !== undefined ? Number(d) : Number.parseInt(h as string, 16);
			return code <= 0x10ffff ? String.fromCodePoint(code) : m;
		},
	);
}

/**
 * Every start tag, with the attributes in `wanted`, in ONE LINEAR PASS over the page as it is.
 *
 * No lowercased copy: `toLowerCase()` can change a string's length (Turkish `İ` becomes two code
 * units), so positions found in a copy do not point into the original. No stripped copy either:
 * comments and raw-text elements are skipped in place. Quote-aware, so a `>` inside
 * `title="a > b"` does not end the tag, and every quoted value is skipped with `indexOf`, so an
 * unterminated one ends the scan rather than being rescanned. Only the attributes a selector can
 * ask about are kept, so a tag with a million distinct attribute names costs a scan, not a Map.
 */
const NO_ATTRS: ReadonlyMap<string, string> = new Map();

function scanStartTags(
	html: string,
	wanted: ReadonlySet<string>,
	/** Return true to stop: the element was found. `tag` is '' when `needTag` is false. */
	visit: (tag: string, attrs: ReadonlyMap<string, string>) => boolean,
	needTag: boolean,
): void {
	const n = html.length;
	let i = html.indexOf('<');
	while (i !== -1) {
		// A comment, from `<!--` to the first `-->` after `<!`: `<!-->` and `<!--->` are empty
		// comments in the spec, and searching from after the opener swallowed the page up to the
		// next one.
		if (html.startsWith('<!--', i)) {
			const end = html.indexOf('-->', i + 2);
			if (end === -1) return;
			i = html.indexOf('<', end + 3);
			continue;
		}
		let j = i + 1;
		if (!isAlpha(html.charCodeAt(j))) {
			i = html.indexOf('<', j);
			continue;
		}
		while (j < n && isNameChar(html.charCodeAt(j))) j++;
		const nameEnd = j;
		// Allocated only when a wanted attribute turns up: most tags on a page carry none, and a
		// Map per tag was most of the cost on a page made of nothing but tags.
		let attrs: Map<string, string> | undefined;
		for (;;) {
			let c = html.charCodeAt(j);
			while (j < n && (isSpace(c) || c === 47)) c = html.charCodeAt(++j);
			if (j >= n || c === 62 || c === 60) break;
			const nameStart = j;
			while (j < n && !isSpace(c) && c !== 61 && c !== 62 && c !== 47 && c !== 60) {
				c = html.charCodeAt(++j);
			}
			const name = html.slice(nameStart, j);
			while (j < n && isSpace(c)) c = html.charCodeAt(++j);
			let value = '';
			if (c === 61) {
				c = html.charCodeAt(++j);
				while (j < n && isSpace(c)) c = html.charCodeAt(++j);
				if (c === 34 || c === 39) {
					const close = html.indexOf(c === 34 ? '"' : "'", j + 1);
					if (close === -1) return;
					value = html.slice(j + 1, close);
					j = close + 1;
				} else {
					const vStart = j;
					while (j < n && !isSpace(c) && c !== 62) c = html.charCodeAt(++j);
					value = html.slice(vStart, j);
				}
			}
			if (name === '') continue;
			const key = name.toLowerCase();
			// The first occurrence wins, as it does in a browser's parser.
			if (wanted.has(key)) {
				attrs ??= new Map();
				if (!attrs.has(key)) attrs.set(key, decodeEntities(value));
			}
		}
		// The raw-text check needs the name; no raw-text element is longer than 9 characters, so
		// longer names skip the copy unless the selector itself names a tag.
		const tag = needTag || nameEnd - i - 1 <= 9 ? html.slice(i + 1, nameEnd).toLowerCase() : '';
		if (visit(needTag ? tag : '', attrs ?? NO_ATTRS)) return;
		const close = RAW_CLOSE.get(tag);
		if (close !== undefined) {
			// Its contents are text. Skip to its end tag, found case-insensitively in the page as it
			// is; `plaintext`, or a raw element that never closes, runs to the end of the page.
			if (tag === 'plaintext') return;
			close.lastIndex = j;
			const m = close.exec(html);
			if (m === null) return;
			i = html.indexOf('<', m.index + 2);
			continue;
		}
		i = html.indexOf('<', j);
	}
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
 * is beyond what this judges or the page is beyond what it scans. See the file header for why
 * undefined is an answer.
 */
export function elementPresent(html: string, selector: string): boolean | undefined {
	const compounds = parseSimpleSelector(selector);
	if (compounds === undefined) return undefined;
	if (html.length > MAX_SELECTOR_SCAN_BYTES) return undefined;
	const wanted = new Set([
		'id',
		'class',
		...compounds.flatMap((c) => c.attrs.map((a) => a.name)),
	]);
	const needTag = compounds.some((c) => c.tag !== undefined);
	let found = false;
	scanStartTags(
		html,
		wanted,
		(tag, attrs) => {
			found = compounds.some((c) => matches(c, tag, attrs));
			return found;
		},
		needTag,
	);
	return found;
}

/** The same check on bytes, decoded the way `detect()` decodes: the page's charset, or UTF-8. */
export function elementPresentIn(
	body: Uint8Array,
	charset: string | undefined,
	selector: string,
): boolean | undefined {
	// Before decoding, so an oversized page costs nothing at all.
	if (body.byteLength > MAX_SELECTOR_SCAN_BYTES) return undefined;
	let html: string;
	try {
		html = new TextDecoder(charset ?? 'utf-8', { fatal: false }).decode(body);
	} catch {
		html = new TextDecoder('utf-8', { fatal: false }).decode(body);
	}
	return elementPresent(html, selector);
}
