# lighthouse

`pnpm lighthouse:assert` runs Lighthouse against a production build of `apps/web` and asserts
the design quality floor in `lighthouserc.json`.

## The CLI is not a dependency of this repo

**Pinned version: `@lhci/cli@0.15.1`.** It is fetched with `pnpm dlx` at run time rather than
installed, the same call this repo makes for k6 and for the same reasons.

`@lhci/cli` depends on lighthouse, which depends on puppeteer-core and a Chrome downloader.
Vendoring it put four Dependabot alerts on a public repository — `extract-zip`, `tmp` twice and
`uuid`, one of them with no patch published — in support of a command that is `ci: none` and
that a designer runs by hand. It also meant every contributor downloaded browser-fetching
machinery during `pnpm install` for a check almost none of them would run.

The practical risk is unchanged either way: the code executes on the machine of whoever runs
the command. What changes is that it is no longer in the lockfile of everyone who does not.

## What it needs

- A local Chrome. `chrome-launcher` finds the system install; on macOS that is
  `/Applications/Google Chrome.app`.
- Nothing else. The script builds `apps/web`, serves the build, and refuses to audit a page
  whose HTML has no rendered hero — a shell scores well by having nothing in it, which is the
  false green the command exists to rule out.

To bump the pin, change it here and in `scripts/lighthouse-assert.ts`, and re-measure the
performance floor before raising it.
