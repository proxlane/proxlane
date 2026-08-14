---
"@proxlane/web": minor
"@proxlane/shared": minor
---

Add the docs site. `/docs` was linked from the header and the primary call to action and had
no route at all, so both 404ed on the live site.

Pages are markdown in `apps/web/content/docs`, versioned and reviewed like code, rendered to
HTML at build time by a Vite plugin. Neither `markdown-it` nor Shiki reaches the Worker
bundle. The outcome reference is generated from the taxonomy instead, because a hand-written
copy of the thing callers write switch statements against is the one page that must not drift.

`pnpm docs:check` is now real: it asserts every page has a file, a route and a nav entry,
that every query parameter and response header the gateway implements is documented, that
internal links resolve, and that `llms.txt` lists exactly the pages that exist.

`@proxlane/shared` gains a `./outcome` subpath export, so the taxonomy can be imported
without pulling the edge guard and `node:crypto` into a browser bundle.
