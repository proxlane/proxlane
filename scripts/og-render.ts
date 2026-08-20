// Render the social card: apps/web/src/og-card.svg -> apps/web/public/og.png
//
// WHY A RENDER STEP AT ALL, when the SVG is right there. Every platform that matters for
// `og:image` — X, Facebook, LinkedIn, Slack — refuses SVG. The card has to ship as a raster, so
// the only question is whether the raster has a source. It did not: `og.png` was committed once
// as bytes and went stale twice within three days, still drawing a wordmark that had been
// retired and claiming three providers when four shipped, with nothing able to read either.
//
// WHY `rsvg-convert` AND NOT A DEPENDENCY. It is a brew/apt binary, like k6, and for the same
// reason: the alternative is pulling a browser or a native rasteriser into `pnpm install` for a
// command almost nobody runs. `CLAUDE.md` already refused that trade once, when `@lhci/cli` put
// four Dependabot alerts on a public repo to support a check one role runs locally. So this
// reports the absence plainly instead of installing its way around it.
//
// THE `.sha` SIDECAR IS THE POINT. It records the digest of the SVG this PNG came from, and
// `repo:check` asserts the two still agree. Without it, editing the drawing and forgetting to
// re-render is invisible — which is precisely the failure that made this file necessary.
//
// Run:  pnpm og:render

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(ROOT, 'apps/web/src/og-card.svg');
const PNG = join(ROOT, 'apps/web/public/og.png');
const SHA = `${PNG}.sha`;

/** 2x the 1200x630 every platform crops to, so the card stays sharp on a retina timeline. */
const WIDTH = 2400;
const HEIGHT = 1260;

export function svgDigest(svg: string): string {
	return createHash('sha256').update(svg).digest('hex');
}

function have(cmd: string): boolean {
	try {
		// `sh -c` with the command as ONE argument, not `shell: true` with args — Node deprecated
		// the latter (DEP0190) because it concatenates rather than escapes.
		execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

if (process.argv[1]?.endsWith('og-render.ts')) {
	if (!existsSync(SVG)) {
		process.stderr.write(`\n  ${SVG} is missing — there is nothing to render.\n\n`);
		process.exit(1);
	}
	if (!have('rsvg-convert')) {
		// Honest about the absence, in the shape `k6:soak` and `lighthouse:assert` already use.
		// Exits non-zero: a render that silently did not happen leaves a stale card, which is the
		// whole problem this file exists to end.
		process.stderr.write(
			'\n  rsvg-convert is not installed, so the card cannot be rendered.\n\n' +
				'    macOS   brew install librsvg\n' +
				'    Debian  apt install librsvg2-bin\n\n' +
				'  It is a system binary rather than a dependency on purpose: the alternative is a\n' +
				'  browser or a native rasteriser in every contributor’s `pnpm install`, for a\n' +
				'  command that runs when the card changes and at no other time.\n\n',
		);
		process.exit(1);
	}

	const svg = readFileSync(SVG, 'utf8');
	execFileSync(
		'rsvg-convert',
		['-w', String(WIDTH), '-h', String(HEIGHT), '-f', 'png', '-o', PNG, SVG],
		{ stdio: 'inherit' },
	);
	writeFileSync(SHA, `${svgDigest(svg)}\n`);
	const bytes = readFileSync(PNG).byteLength;
	process.stdout.write(
		`  wrote apps/web/public/og.png  ${WIDTH}x${HEIGHT}, ${(bytes / 1024).toFixed(0)} KB\n` +
			'  wrote apps/web/public/og.png.sha\n',
	);
}
