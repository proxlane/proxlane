import type { Adapter } from './contract.js';

// Keyless adapters that exist to EXERCISE the machinery, not to serve traffic.
//
// Deliberately a separate file and a separate export from REGISTRY, for two reasons:
//
//   1. Product surfaces — the router, the /providers pages, the docs generator, the
//      scoreboard — read REGISTRY. A test service listed there would be advertised as a
//      supported provider, which is a lie shipped to the marketing site. Separate exports
//      make that leak structurally impossible rather than a thing to remember.
//   2. `pnpm new-adapter` only ever appends to registry.ts, so the two never interact and
//      no fragile ordering has to hold.
//
// repo:check asserts nothing outside this file imports from `_dev/`.

export interface DevAdapterEntry {
	readonly load: () => Promise<Adapter>;
	/** Why it is here — printed by `pnpm record` so nobody mistakes it for a provider. */
	readonly why: string;
	/**
	 * No credential required. This is the property that makes the entry useful: it lets the
	 * whole record path be exercised before a single provider trial key exists, and lets a
	 * contributor with no keys check their setup.
	 */
	readonly keyless: boolean;
}

export const DEV_REGISTRY: Record<string, DevAdapterEntry> = {
	jina_reader: {
		load: () => import('./_dev/jina-reader/index.js').then((m) => m.JinaReaderAdapter),
		why: 'keyless end-to-end subject for the recorder — r.jina.ai, not a supported provider',
		keyless: true,
	},
};
