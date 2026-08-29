// `pnpm capture-block` — turn a real HTTP response into a block-page corpus entry.
//
// THE ONE PATH IN THIS PRODUCT WITH NO REAL EVIDENCE BEHIND IT. There are 43 recorded fixtures
// across four adapters and not one of them is a block page, and `/detect` ships six rules with
// `verifiedAgainstRealCapture: false` on all six. Everything proxlane is sold on — the 200 that
// is really a captcha — rests on string matches nobody has ever tested against the thing they
// describe.
//
// `record.ts` already says how this is supposed to work: "real block pages come from real
// targets that fight back... Those fixtures are captured from live traffic via `--from-exchange`,
// not invented here." That flag appeared exactly once in the repository, inside that comment. The
// mechanism was never built, so the gap could not close even when somebody had a capture in hand.
//
// WHY A SEPARATE SCRIPT and not that flag. `record` spends provider credits against a fixed
// matrix of stable targets; this spends nothing and takes bytes you already have. Bolting an
// offline importer onto a live recorder would give one command two jobs and one `--dry-run` that
// means two things.
//
// SECTION 19 IS ENFORCED HERE, not remembered. `plan.md` bars recording named commercial targets
// into this repo, because a dated, self-published capture of a named site's defences is evidence
// of automated access against a property with paying customers. So the destination is decided by
// the target, never by the caller: a purpose-built endpoint may land in the public corpus, and
// anything else requires a private directory and refuses without one. A reviewer cannot forget a
// rule the tool will not let them break.
//
// Run:  pnpm capture-block --in=<response.json> --rule=<id|none> --class=<target-class>

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTIFYING_FIELDS, REDACTED, sanitizeBody, sanitizeHeaders } from './record.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_CORPUS = join(ROOT, 'packages/detect/corpus');

/**
 * Hosts that exist to be scraped, and may therefore be named in a public capture.
 *
 * The test is not "is it safe to scrape" but "does this site invite it in writing". Each of
 * these publishes itself as a scraping sandbox, so a stored response names nobody's commercial
 * property and dates no access anybody objects to. `web-scraping.dev` is already the source of
 * the one real capture in the repo.
 *
 * NOTHING HERE SERVES A VENDOR CHALLENGE, which is the honest limit of the public half: you
 * cannot summon a Cloudflare interstitial from a sandbox. Purpose-built hosts give the no-fire
 * corpus and the bespoke-block case; the vendor fingerprints have to come from live traffic,
 * which is exactly why the private destination exists.
 */
const PURPOSE_BUILT: readonly string[] = [
	'web-scraping.dev',
	'httpbin.dev',
	'httpbin.org',
	'books.toscrape.com',
	'quotes.toscrape.com',
	'scrapethissite.com',
];

/** `https://a.b.web-scraping.dev/x` -> `web-scraping.dev`, for the allowlist test. */
export function registrableHost(url: string): string | undefined {
	try {
		const h = new URL(url).hostname.toLowerCase();
		return PURPOSE_BUILT.find((p) => h === p || h.endsWith(`.${p}`));
	} catch {
		return undefined;
	}
}

/**
 * Every spelling of the captured host, longest first.
 *
 * `www.a.example.com` yields the full hostname AND `a.example.com` and `example.com`, because a
 * block page references its own site in several forms — a canonical link, a support URL, a
 * cookie domain — and stripping only the exact `Host:` value leaves the others behind.
 */
export function hostForms(url: string): string[] {
	let h: string;
	try {
		h = new URL(url).hostname.toLowerCase();
	} catch {
		return [];
	}
	const parts = h.split('.');
	const forms = new Set<string>();
	for (let i = 0; i + 2 <= parts.length; i++) forms.add(parts.slice(i).join('.'));
	return [...forms].sort((a, b) => b.length - a.length);
}

/**
 * Remove the target's name from bytes that are about to be stored.
 *
 * SECTION 19 SAYS THE HOST IS DROPPED "EVEN IN THE PRIVATE HALF", and until now that was true
 * of the `url` FIELD and false of everything else. `sanitizeBody` redacts secrets, not names, so
 * a captured block page kept every mention of the site it came from — and the stated reason for
 * dropping the host is that a private corpus should be publishable later without re-sanitising.
 * A capture whose body still names the target cannot be.
 *
 * Found by the caller who supplied the first live-traffic capture, who checked before handing it
 * over and counted three occurrences of their target in the body.
 */
export function scrubHost(bytes: Uint8Array, url: string): Uint8Array {
	const forms = hostForms(url);
	if (forms.length === 0) return bytes;
	// Latin-1 round-trips arbitrary bytes through a string unchanged, so a page in any charset
	// survives this: a hostname is ASCII, and every non-ASCII byte is preserved byte for byte.
	let text = Buffer.from(bytes).toString('latin1');
	for (const form of forms) {
		text = text.replace(
			new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
			REDACTED,
		);
	}
	return new Uint8Array(Buffer.from(text, 'latin1'));
}

export type Destination =
	| { readonly kind: 'public'; readonly dir: string; readonly host: string }
	| { readonly kind: 'private'; readonly dir: string }
	| { readonly kind: 'refused'; readonly why: string };

/**
 * Where a capture of this URL is allowed to land.
 *
 * The whole of section 19 in one function, so it is testable and so no call site can route
 * around it. `privateDir` is passed in rather than read from the environment here, because a
 * decision this important should be a pure function of its inputs.
 */
export function destinationFor(url: string, privateDir: string | undefined): Destination {
	const host = registrableHost(url);
	if (host !== undefined) return { kind: 'public', dir: PUBLIC_CORPUS, host };
	if (privateDir !== undefined && privateDir.trim() !== '') {
		return { kind: 'private', dir: privateDir };
	}
	return {
		kind: 'refused',
		why:
			'that target is not a purpose-built scraping sandbox, so plan.md section 19 keeps the ' +
			'capture out of this repository. Set PROXLANE_PRIVATE_CORPUS to a directory outside ' +
			'the working tree and run it again.',
	};
}

/** What a capture file holds. No URL, ever — see `targetClass`. */
export interface Capture {
	readonly kind: 'block-capture';
	readonly capturedAt: string;
	/** The rule this is expected to fire, or `none` for a page that must NOT be called a block. */
	readonly rule: string;
	/**
	 * A CLASS of target, never a name. Section 19: "Public pages, scoreboards and comparisons
	 * report classes of target, never names." The host is dropped even in the private half, so a
	 * corpus that later becomes publishable does not have to be re-sanitised.
	 */
	readonly targetClass: string;
	readonly source: 'purpose-built' | 'live-traffic';
	readonly status: number;
	readonly contentType: string | undefined;
	readonly headers: Readonly<Record<string, string>>;
	readonly bodyBase64: string;
}

/** The input: a response somebody already has. Deliberately the least it can be. */
interface Exchange {
	readonly url: string;
	readonly status: number;
	readonly headers?: Record<string, string>;
	/** Either is accepted; `bodyBase64` wins, because bytes survive a charset the text form loses. */
	readonly body?: string;
	readonly bodyBase64?: string;
}

export function buildCapture(
	ex: Exchange,
	opts: { readonly rule: string; readonly targetClass: string; readonly now: string },
	secrets: readonly string[],
): Capture {
	const headers = Object.fromEntries(
		Object.entries(sanitizeHeaders(ex.headers ?? {}, secrets)).map(([k, v]) => [
			k,
			Buffer.from(scrubHost(new TextEncoder().encode(v), ex.url)).toString('utf8'),
		]),
	);
	// BOTH PATHS THROUGH ONE SANITISER. `bodyBase64` is the documented preferred input — bytes
	// survive a charset the text form loses — and it used to bypass sanitisation entirely, so
	// the default path stored the body exactly as given. Neither path ever called
	// `sanitizeBody`, the function that redacts `client_ip`, `project_uuid`, `user_uuid` and
	// `account_id`: the same fields whose leak into six committed Scrapfly fixtures is why that
	// function exists. A capture is a real response from real traffic, so it is MORE likely to
	// carry an egress address than a recording against a fixed test target, and this one had no
	// redaction at all.
	const raw =
		ex.bodyBase64 !== undefined
			? new Uint8Array(Buffer.from(ex.bodyBase64, 'base64'))
			: new TextEncoder().encode(ex.body ?? '');
	// SECRETS FIRST, THEN THE NAME. Two different rules: `sanitizeBody` redacts credentials and
	// identifying fields, `scrubHost` removes what section 19 bars — the target's name. Neither
	// covers the other, and the file's own docstring promised the second one before it existed.
	const bodyBase64 = Buffer.from(scrubHost(sanitizeBody(raw, secrets), ex.url)).toString(
		'base64',
	);
	return {
		kind: 'block-capture',
		capturedAt: opts.now,
		rule: opts.rule,
		targetClass: opts.targetClass,
		source: registrableHost(ex.url) === undefined ? 'live-traffic' : 'purpose-built',
		status: ex.status,
		contentType: headers['content-type'],
		headers,
		bodyBase64,
	};
}

// ---------------------------------------------------------------- cli
//
// Guarded so the tests can import the pure halves without the script running.

if (import.meta.filename === process.argv[1]) {
	const args = process.argv.slice(2);
	const arg = (n: string): string | undefined =>
		args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

	const inFile = arg('in');
	const rule = arg('rule');
	const targetClass = arg('class');

	if (inFile === undefined || rule === undefined || targetClass === undefined) {
		process.stderr.write(
			[
				'usage: pnpm capture-block --in=<response.json> --rule=<id|none> --class=<target-class>',
				'',
				'  --in     a JSON exchange: { url, status, headers?, body? | bodyBase64? }',
				'  --rule   the /detect rule this should fire, or `none` for a page that must not',
				'  --class  what KIND of site this was. Never a name — plan.md section 19.',
				'',
				'A purpose-built scraping sandbox lands in packages/detect/corpus.',
				'Anything else needs PROXLANE_PRIVATE_CORPUS set, and never enters this repo.',
				'',
			].join('\n'),
		);
		process.exit(2);
	}

	if (!existsSync(inFile)) {
		process.stderr.write(`no such file: ${inFile}\n`);
		process.exit(2);
	}

	let ex: Exchange;
	try {
		ex = JSON.parse(readFileSync(inFile, 'utf8')) as Exchange;
	} catch (e) {
		process.stderr.write(`${inFile} is not JSON: ${e instanceof Error ? e.message : e}\n`);
		process.exit(2);
	}

	if (typeof ex.url !== 'string' || typeof ex.status !== 'number') {
		process.stderr.write('the exchange needs at least a `url` string and a `status` number\n');
		process.exit(2);
	}
	if (ex.body === undefined && ex.bodyBase64 === undefined) {
		// A capture with no body cannot exercise a detector, which is the only thing it is for.
		process.stderr.write('the exchange has no `body` or `bodyBase64` — nothing to detect on\n');
		process.exit(2);
	}
	if (/[^a-z0-9-]/.test(targetClass)) {
		// A class is a category. A hostname would slip through as one if this let it.
		process.stderr.write(`--class must be lowercase kebab-case, got "${targetClass}"\n`);
		process.exit(2);
	}

	const dest = destinationFor(ex.url, process.env.PROXLANE_PRIVATE_CORPUS);
	if (dest.kind === 'refused') {
		process.stderr.write(`\n  refusing to store this capture: ${dest.why}\n\n`);
		process.exit(1);
	}

	// Every provider key on the machine, so a body echoing one back cannot be committed.
	const secrets = Object.entries(process.env)
		.filter(([k, v]) => /_KEY$/.test(k) && typeof v === 'string' && v.length > 8)
		.map(([, v]) => v as string);

	const capture = buildCapture(
		ex,
		{ rule, targetClass, now: new Date().toISOString() },
		secrets,
	);

	// ASSERT THE SANITISER WORKED RATHER THAN TRUSTING IT, the same guard `record.ts` carries.
	// A leaked key or egress address in a committed capture is unrecoverable once pushed, and
	// this script writes into a corpus whose whole purpose is to be shared.
	//
	// SCANNED OVER THE DECODED BODY, not the serialized capture. The body is stored base64, so
	// a scan of the JSON is blind to everything in it — which is exactly how `record.ts`'s
	// first version of this check missed the one place nothing else was looking.
	const scannable = `${JSON.stringify(capture)}\n${new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(capture.bodyBase64, 'base64'))}`;
	const leaked = IDENTIFYING_FIELDS.filter((field) =>
		new RegExp(`"${field}"\\s*:\\s*"(?!${REDACTED})`).test(scannable),
	);
	for (const secret of secrets) {
		if (secret.length >= 8 && scannable.includes(secret)) leaked.push('a provider key');
	}
	// AND THE TARGET'S NAME, which section 19 bars from a stored capture in either half. Asserted
	// rather than assumed for the same reason as the rest: `scrubHost` is a string replacement,
	// and a page can spell its own host in a form the URL did not — punycode, an entity, a split
	// across an attribute. Refusing is correct; a capture is cheap to retake and a name in a
	// corpus that later becomes publishable is not cheap to remove.
	for (const form of hostForms(ex.url)) {
		if (new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(scannable)) {
			leaked.push(`the target host (${form.length} chars)`);
			break;
		}
	}
	if (leaked.length > 0) {
		process.stderr.write(
			`\n  REFUSING TO WRITE: ${leaked.join(', ')} survived redaction.\n` +
				'  This is a bug in sanitizeBody(); fix it before capturing again.\n\n',
		);
		process.exit(1);
	}

	mkdirSync(dest.dir, { recursive: true });
	// A CONTENT DIGEST IN THE NAME, because rule + class + date is not unique. Two ordinary pages
	// from the same vendor site, captured the same day, produced the same filename and the second
	// silently overwrote the first — losing a capture taken from a different network, which was
	// the whole point of taking it. The digest also makes a re-capture of the SAME bytes a no-op
	// rather than a duplicate.
	const digest = createHash('sha256').update(capture.bodyBase64).digest('hex').slice(0, 8);
	const name = `${rule === 'none' ? 'no-fire' : rule}-${targetClass}-${capture.capturedAt.slice(0, 10)}-${digest}.json`;
	const out = join(dest.dir, name);
	writeFileSync(out, `${JSON.stringify(capture, null, '\t')}\n`);

	process.stdout.write(
		`\n  wrote ${dest.kind} capture: ${out}\n` +
			`    rule   ${rule}\n` +
			`    class  ${targetClass}\n` +
			`    source ${capture.source}\n` +
			(dest.kind === 'private'
				? '\n  This is outside the repository on purpose. Commit the manifest, never the body.\n\n'
				: '\n'),
	);
}
