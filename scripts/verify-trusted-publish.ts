// Did the release that just happened actually authenticate with OIDC?
//
// This exists because a green release is NOT evidence of one. npm prefers trusted publishing
// and falls back to a static `_authToken` when the exchange fails — a revoked trust config, a
// renamed workflow, a registry hiccup. The publish succeeds either way, so the credential
// posture can silently regress to the long-lived token with nothing in the log to say so.
//
// The registry records which was used. pnpm's own `trustPolicy` reads exactly this:
//
//   getTrustEvidence(manifest) {
//     if (manifest._npmUser?.trustedPublisher) return 'trustedPublisher'
//     if (manifest.dist?.attestations?.provenance) return 'provenance'
//   }
//
// Verified against the registry: `proxlane@0.1.0`, published with a token, carries
// `_npmUser: {name, email}` and provenance only. `tuf-js`, `sigstore` and `nanoid` carry
// `_npmUser.trustedPublisher = {id: 'github', oidcConfigId: 'oidc:<uuid>'}`.
//
// NOTE the field is in the FULL packument. `npm view <pkg> _npmUser` renders it as the string
// "name <email>" and the abbreviated packument omits it, so both are useless here.
//
// AND THE PACKUMENT LAGS THE PUBLISH. The 0.16.0 release (2026-09-08) failed here with
// "@proxlane/adapters@0.10.2 no trust evidence at all" and four lines blaming a static token
// the repo no longer has. Twenty minutes later the same packument carried
// `trustedPublisher: {id: "github"}`. The check had retried 30 s per package, sequentially,
// and adapters was first in the list — checked within seconds of `changeset publish`
// returning, before the registry had caught up. The two packages checked after it passed,
// because by then it had. So the retry budget was per package while propagation is per
// publish, and the first name in the list always got the shortest effective wait.
//
// Two things follow. A version that has not appeared yet is a different fact from a version
// that has appeared with no trust evidence, and they get different words: the first cannot
// be verified, the second is the regression. And the whole list is retried in rounds, so a
// slow registry costs the release one wait rather than one wait per package.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the registry says backed a published version, strongest first. */
export type TrustEvidence = 'trustedPublisher' | 'provenance' | 'none';

/**
 * A lookup's answer. `absent` is not evidence about the publish; it means the registry never
 * showed the version inside the window, so nothing could be read. Conflating it with `none`
 * is what turned a propagation delay into "credential regression".
 */
export type Lookup = TrustEvidence | 'absent';

export interface VersionManifest {
	readonly _npmUser?: { readonly trustedPublisher?: { readonly id?: string } };
	readonly dist?: { readonly attestations?: { readonly provenance?: unknown } };
}

export function trustEvidence(manifest: VersionManifest | undefined): TrustEvidence {
	if (manifest?._npmUser?.trustedPublisher) return 'trustedPublisher';
	if (manifest?.dist?.attestations?.provenance) return 'provenance';
	return 'none';
}

export function describe(evidence: TrustEvidence): string {
	switch (evidence) {
		case 'trustedPublisher':
			return 'trusted publisher (OIDC)';
		case 'provenance':
			return 'provenance only — published with a static token, NOT OIDC';
		default:
			return 'no trust evidence at all';
	}
}

export interface Published {
	readonly name: string;
	readonly version: string;
}

/**
 * Is this a package the repo never publishes?
 *
 * Reads the workspace manifests once. A name with no manifest is treated as publishable, so an
 * unknown package is still checked — failing open here would let a real regression through,
 * which is the wrong direction for a credential check.
 */
let privateNames: Set<string> | undefined;
export function isPrivate(name: string, root = ROOT): boolean {
	if (privateNames === undefined) {
		privateNames = new Set();
		// WALK, rather than listing the directories packages live in. The first version of this
		// checked `packages`, `apps` and `tooling`, and missed `@proxlane/scripts` and
		// `@proxlane/k6-harness`, which live at `scripts/` and `test/k6/`. A hardcoded root list
		// is a thing that silently stops covering a workspace the moment someone adds one.
		const walk = (dir: string, depth: number): void => {
			if (depth > 3) return;
			let entries: string[];
			try {
				entries = readdirSync(dir);
			} catch {
				return;
			}
			if (entries.includes('package.json')) {
				try {
					const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
						name?: string;
						private?: boolean;
					};
					if (pkg.name !== undefined && pkg.private === true) privateNames?.add(pkg.name);
				} catch {
					// A manifest we cannot read is not evidence that its package is private.
				}
			}
			for (const entry of entries) {
				if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
				const child = join(dir, entry);
				try {
					if (statSync(child).isDirectory()) walk(child, depth + 1);
				} catch {
					// Unreadable, so not a package we can classify.
				}
			}
		};
		walk(root, 0);
	}
	return privateNames.has(name);
}

/** `changesets/action` emits `publishedPackages` as `[{name, version}, ...]`. */
export function parsePublished(raw: string): Published[] {
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) throw new Error('publishedPackages is not an array');
	return parsed.map((p) => {
		const { name, version } = p as Partial<Published>;
		if (typeof name !== 'string' || typeof version !== 'string') {
			throw new Error(`malformed entry: ${JSON.stringify(p)}`);
		}
		return { name, version };
	});
}

export type Fetcher = (name: string) => Promise<Record<string, VersionManifest> | undefined>;

/** A single read. `absent` when the version is not in the packument, or the fetch failed. */
async function lookup(pkg: Published, fetchVersions: Fetcher): Promise<Lookup> {
	const versions = await fetchVersions(pkg.name).catch(() => undefined);
	const manifest = versions?.[pkg.version];
	return manifest === undefined ? 'absent' : trustEvidence(manifest);
}

/** Settled: nothing a later read could change. `none` is retried in case the write was partial. */
const settled = (l: Lookup): boolean => l === 'trustedPublisher' || l === 'provenance';

/**
 * Read one package's evidence, retrying while the registry catches up.
 *
 * Kept for a single package; the release uses `verifyAll`, which retries the list in rounds.
 * Returns `absent` when the version never appeared, which is not the same answer as `none`.
 */
export async function evidenceFor(
	pkg: Published,
	fetchVersions: Fetcher,
	opts: {
		readonly attempts: number;
		readonly waitMs: number;
		readonly sleep: (ms: number) => Promise<void>;
	},
): Promise<Lookup> {
	const got = await verifyAll([pkg], fetchVersions, {
		rounds: opts.attempts,
		waitMs: opts.waitMs,
		sleep: opts.sleep,
	});
	return got.get(pkg.name) ?? 'absent';
}

/**
 * Read every package's evidence, retrying the UNSETTLED ones together in rounds.
 *
 * One wait per round, shared by everything still outstanding, so the budget is a property of
 * the publish rather than of a package's position in the list. A package drops out of the
 * rounds the moment it settles; on the happy path every package settles in round one and no
 * sleep happens at all.
 */
export async function verifyAll(
	packages: readonly Published[],
	fetchVersions: Fetcher,
	opts: {
		readonly rounds: number;
		readonly waitMs: number;
		readonly sleep: (ms: number) => Promise<void>;
	},
): Promise<Map<string, Lookup>> {
	const out = new Map<string, Lookup>();
	let pending = [...packages];
	for (let round = 0; round < opts.rounds && pending.length > 0; round++) {
		if (round > 0) await opts.sleep(opts.waitMs);
		const next: Published[] = [];
		for (const pkg of pending) {
			const got = await lookup(pkg, fetchVersions);
			// A version seen with no evidence keeps its `none`; an `absent` read after that does
			// not demote it back to "never appeared".
			if (got !== 'absent' || out.get(pkg.name) === undefined) out.set(pkg.name, got);
			if (!settled(got)) next.push(pkg);
		}
		pending = next;
	}
	return out;
}

if (import.meta.filename === process.argv[1]) {
	const raw = process.argv[2];
	if (raw === undefined) {
		process.stderr.write(
			'usage: verify-trusted-publish.ts \'[{"name":"x","version":"1.0.0"}]\'\n',
		);
		process.exit(2);
	}

	// PRIVATE PACKAGES ARE NOT ON npm, SO THERE IS NOTHING TO VERIFY ABOUT THEM.
	//
	// `changesets/action` lists everything it VERSIONED in `publishedPackages`, not everything
	// it published — and once `privatePackages.tag` was turned on, that started including the
	// ten private ones. They went nowhere near the registry, so every one of them came back
	// "no trust evidence at all" and failed a release whose three real publishes had all used
	// OIDC correctly.
	//
	// The distinction this check exists to make is "did npm fall back to a static token", which
	// is only a question for something npm received. Read from the manifest rather than by
	// asking the registry: a package absent from npm because it is private and a package absent
	// because the publish silently failed look identical over the network, and confusing those
	// two is exactly the regression this file is here to catch.
	const all = parsePublished(raw);
	const packages = all.filter((p) => !isPrivate(p.name));
	const skipped = all.length - packages.length;
	if (skipped > 0) {
		process.stdout.write(`  skipping ${skipped} private package(s), which never reach npm\n`);
	}
	// THE EMPTY LIST AND THE ALL-PRIVATE LIST ARE DIFFERENT THINGS, and conflating them failed a
	// release. The comment here used to read "called only when `published == 'true'`, so an empty
	// list means the wiring is wrong" — but `changesets/action` reports `published: true` once it
	// has VERSIONED and TAGGED something, and `privatePackages.tag` is deliberately on, so a
	// release where only private packages changed sets that flag while sending nothing to npm.
	//
	// That is exactly what 0.7.1 was: `@proxlane/gateway` and `@proxlane/web`, both `private`,
	// nothing publishable touched. The check filtered both out, saw zero, and failed a release
	// that had done everything right — after the tags were already cut, so it left the image
	// unbuilt and the deploy unrun.
	//
	// So the non-zero denominator applies to what changesets HANDED US, not to what survived the
	// private filter. An empty input still means the wiring is wrong; an input that was entirely
	// private means there was genuinely nothing for npm to receive.
	if (all.length === 0) {
		process.stderr.write(
			'::error::changesets reported a publish but named no packages — this check proved nothing\n',
		);
		process.exit(1);
	}
	if (packages.length === 0) {
		process.stdout.write(
			`  every one of the ${all.length} versioned package(s) is private, so nothing reached ` +
				'npm and there is no credential posture to verify.\n',
		);
		process.exit(0);
	}

	const fetchVersions: Fetcher = async (name) => {
		const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
			headers: { accept: 'application/json' },
		});
		if (!res.ok) return undefined;
		return ((await res.json()) as { versions?: Record<string, VersionManifest> }).versions;
	};
	const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

	// Up to two minutes, spent only while something is still missing. The 0.16.0 release
	// needed somewhere between 30 s and 20 min for its first package; two minutes is a guess
	// with one data point behind it, and the message below says what to do if it is short.
	const ROUNDS = 12;
	const WAIT_MS = 10_000;
	const results = await verifyAll(packages, fetchVersions, {
		rounds: ROUNDS,
		waitMs: WAIT_MS,
		sleep,
	});

	let regressed = 0;
	let unverified = 0;
	for (const pkg of packages) {
		const got = results.get(pkg.name) ?? 'absent';
		const label = `${pkg.name}@${pkg.version}`;
		if (got === 'trustedPublisher') {
			process.stdout.write(`  ok   ${label.padEnd(30)} ${describe(got)}\n`);
		} else if (got === 'absent') {
			process.stdout.write(`  ??   ${label.padEnd(30)} not in the registry yet\n`);
			unverified++;
		} else {
			process.stdout.write(`  BAD  ${label.padEnd(30)} ${describe(got)}\n`);
			regressed++;
		}
	}

	if (regressed > 0) {
		// Only claim a token fallback when a token exists to fall back to. With OIDC-only
		// publishing there is none, and the sentence that used to say so here was wrong on the
		// one release it was printed for.
		const fallback =
			process.env.NODE_AUTH_TOKEN !== undefined
				? '::error::NODE_AUTH_TOKEN is set, so npm fell back to it: the OIDC exchange failed.\n'
				: '::error::No NODE_AUTH_TOKEN is set, so a token fallback was impossible. Either the trust\n' +
					'::error::config changed, or the registry wrote the version before its provenance.\n';
		process.stdout.write(
			`\n::error::${regressed} package(s) did not publish via trusted publishing.\n` +
				'::error::The packages ARE published — this is a credential regression, not a broken release.\n' +
				fallback +
				'::error::Check: the trust config still exists (npm trust list <pkg>), and it names\n' +
				'::error::this workflow file. Renaming release.yml breaks the binding silently.\n',
		);
		process.exit(1);
	}
	if (unverified > 0) {
		// Not verified is not the same as verified, so this still fails — but it says what it
		// is: the registry had not shown the version within the window, and nothing was read.
		process.stdout.write(
			`\n::error::${unverified} package(s) never appeared in the registry within ` +
				`${(ROUNDS * WAIT_MS) / 1000}s, so their trust evidence could not be read.\n` +
				'::error::This is propagation, not a credential problem: nothing was checked, and nothing\n' +
				'::error::should be concluded. Confirm by hand once it lands —\n' +
				'::error::  curl -s https://registry.npmjs.org/<pkg> | jq \'.versions["<ver>"]._npmUser\'\n' +
				'::error::— then re-run the release workflow with rebuild_image: true to ship the image.\n',
		);
		process.exit(1);
	}
	process.stdout.write('\n  every published package authenticated with OIDC.\n');
}
