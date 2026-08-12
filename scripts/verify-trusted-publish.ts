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

	const packages = parsePublished(raw);
	if (packages.length === 0) {
		// Non-zero denominator. Called only when `published == 'true'`, so an empty list means
		// the wiring is wrong, not that there is nothing to check.
		process.stderr.write(
			'::error::no published packages to verify — this check proved nothing\n',
		);
		process.exit(1);
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
