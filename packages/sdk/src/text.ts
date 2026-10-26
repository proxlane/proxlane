// A page as text, for an agent that pays per token.
//
// Raw HTML is mostly markup, scripts and styles; handing it to a model spends its context on
// things it cannot use. This keeps the words, the title, and the line breaks block elements imply,
// and nothing else. It is not a readability engine and does not try to guess which part of a page
// is the article: an agent asked for a page gets the page.
//
// LINEAR, like detect's element check, because the input is whatever a target sent. Comments and
// raw-text elements are skipped with indexOf, never a lazy regex that rescans an unclosed one.

/** Elements whose contents are code or data, not reading text, and how each one closes. */
const SKIPPED = new Map<string, RegExp>([
	...['script', 'style', 'noscript', 'template', 'svg'].map(
		(t) => [t, new RegExp(`</${t}(?=[\\s/>])`, 'gi')] as const,
	),
	// `</head>` is optional and minified pages leave it out: skipping to it alone dropped the whole
	// page and still reported success. The body opening ends the head as well.
	['head', /<\/head(?=[\s/>])|<body(?=[\s/>])/gi],
]);

/** Elements that start a new line when they open or close. */
const BLOCK =
	/^(?:p|div|br|hr|li|ul|ol|tr|table|section|article|header|footer|nav|aside|main|h[1-6]|blockquote|pre|dd|dt|dl|figure|figcaption|form|fieldset|address)$/;

const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

function decodeEntities(s: string): string {
	return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (m, d, h, n) => {
		if (n !== undefined) return ENTITIES[(n as string).toLowerCase()] ?? m;
		const code = d !== undefined ? Number(d) : Number.parseInt(h as string, 16);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
	});
}

/** The document's `<title>`, if it has one. */
export function titleOf(html: string): string | undefined {
	// Bounded: `[^>]*` also matches `<`, so `<title` repeated with no `>` rescanned to the end of the
	// page from every start, quadratic on a page a target controls.
	const m = /<title\b[^<>]{0,256}>([^<]{0,500})<\/title\s*>/i.exec(html);
	const t = m?.[1] === undefined ? '' : decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
	return t === '' ? undefined : t;
}

/** The readable text of an HTML page, with block elements as line breaks. */
export function htmlToText(html: string): string {
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
			const end = html.indexOf('-->', lt + 2);
			i = end === -1 ? html.length : end + 3;
			continue;
		}
		// A `<` is markup only when a tag could start there. `3 < 5` in prose or code is text, and
		// jumping to the next `>` from it swallowed everything up to the next tag.
		if (!/[a-zA-Z/!?]/.test(html[lt + 1] ?? '')) {
			out += '<';
			i = lt + 1;
			continue;
		}
		const gt = html.indexOf('>', lt + 1);
		if (gt === -1) break;
		// The whole name, to whitespace, `/` or `>`, as a browser reads it: stopping at the first
		// character outside [a-z0-9-] would read `<script_x>` as a script and drop what follows.
		// A `>` inside a quoted attribute ends the tag early here; for reading text that only leaks
		// a fragment of the attribute, never a whole skipped element.
		const tag = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, Math.min(gt + 1, lt + 64)));
		const name = tag?.[1]?.toLowerCase();
		const closing = html[lt + 1] === '/';
		const skip = name === undefined || closing ? undefined : SKIPPED.get(name);
		if (skip !== undefined) {
			// Skip to its end tag, found case-insensitively in the page AS IT IS. Never in a
			// lowercased copy: `toLowerCase()` can change the length (Turkish İ), and positions found
			// in the copy would not point into the original. detect learned that in review (#387).
			skip.lastIndex = gt + 1;
			const close = skip.exec(html);
			const after = close === null ? -1 : html.indexOf('>', close.index);
			i = after === -1 ? html.length : after + 1;
			continue;
		}
		if (name !== undefined && BLOCK.test(name)) out += '\n';
		i = gt + 1;
	}
	return decodeEntities(out)
		.replace(/[ \t\f\v\r]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
