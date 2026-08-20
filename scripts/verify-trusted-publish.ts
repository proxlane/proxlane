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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the registry says backed a published version, strongest first. */
export type TrustEvidence = 'trustedPublisher' | 'provenance' | 'none';

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

/**
 * Read the evidence, retrying while the registry catches up.
 *
 * The packument is not updated atomically with the publish, so a check that runs immediately
 * can see a missing version and conclude "no evidence" about a release that is fine. Absence
 * is therefore retried; a definite answer returns at once.
 */
export async function evidenceFor(
	pkg: Published,
	fetchVersions: Fetcher,
	opts: {
		readonly attempts: number;
		readonly waitMs: number;
		readonly sleep: (ms: number) => Promise<void>;
	},
): Promise<TrustEvidence> {
	let last: TrustEvidence = 'none';
	for (let i = 0; i < opts.attempts; i++) {
		const versions = await fetchVersions(pkg.name).catch(() => undefined);
		const manifest = versions?.[pkg.version];
		if (manifest !== undefined) {
			last = trustEvidence(manifest);
			if (last !== 'none') return last;
		}
		if (i < opts.attempts - 1) await opts.sleep(opts.waitMs);
	}
	return last;
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

	let regressed = 0;
	for (const pkg of packages) {
		const evidence = await evidenceFor(pkg, fetchVersions, {
			attempts: 5,
			waitMs: 6_000,
			sleep,
		});
		const label = `${pkg.name}@${pkg.version}`;
		if (evidence === 'trustedPublisher') {
			process.stdout.write(`  ok   ${label.padEnd(30)} ${describe(evidence)}\n`);
		} else {
			process.stdout.write(`  BAD  ${label.padEnd(30)} ${describe(evidence)}\n`);
			regressed++;
		}
	}

	if (regressed > 0) {
		process.stdout.write(
			`\n::error::${regressed} package(s) did not publish via trusted publishing.\n` +
				'::error::The packages ARE published — this is a credential regression, not a broken release.\n' +
				'::error::npm fell back to the static token, which means the OIDC exchange failed.\n' +
				'::error::Check: the trust config still exists (npm trust list <pkg>), and it names\n' +
				'::error::this workflow file. Renaming release.yml breaks the binding silently.\n',
		);
		process.exit(1);
	}
	process.stdout.write('\n  every published package authenticated with OIDC.\n');
}
