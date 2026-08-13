---
"@proxlane/web": patch
---

Implement `pnpm lighthouse:assert` against a real production build, and add the favicon whose
absence it found: browsers requested `/favicon.ico`, took a 404, and logged a console error
that cost the best-practices score. `tokens:check` asserts the favicon's hex still matches
`--map-accent`, since a standalone SVG cannot read the token layer and is the one file where
the brand can drift alone.
