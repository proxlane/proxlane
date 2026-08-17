import { createRequire } from 'node:module';

/**
 * The gateway's own version, read from `package.json` rather than written down.
 *
 * A literal here would drift on every release, and it drifts SILENTLY: nothing fails, the
 * number is simply wrong in the one field anyone checks first. The CLI already learned this —
 * it reported 0.0.0 from a package published as 0.0.1 — so this is the same fix in the same
 * shape, deliberately.
 *
 * `createRequire` because this bundles to ESM, where `import.meta.resolve` on a JSON file is
 * not the simple path it appears to be. `../package.json` resolves from `dist/` in the image
 * and from `src/` in the test run, and the Dockerfile copies `package.json` next to `dist/`
 * precisely so the first of those holds.
 *
 * Falls back rather than throwing. A gateway that refuses to boot because it cannot introspect
 * its own version number would be trading a working proxy for a cosmetic field.
 */
function read(): string {
	try {
		return (
			(createRequire(import.meta.url)('../package.json') as { version?: string }).version ??
			'unknown'
		);
	} catch {
		return 'unknown';
	}
}

export const VERSION = read();
