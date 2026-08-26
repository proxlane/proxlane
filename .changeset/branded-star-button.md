---
'@proxlane/ui': patch
'@proxlane/web': patch
---

The header's star link carries GitHub's own mark rather than a generic star glyph. The path is
Octicons' `mark-github-16`, read from source and committed, not embedded: GitHub ships a star
button and it is an iframe from a third-party host, which is the thing `design.md` self-hosts the
fonts to avoid.

`--color-brand-github` is the one brand token whose dark value is a different colour rather than
a lighter one. GitHub's published black is `#181717`, which measures 17.1:1 on the light ground
and 1.01:1 on the ink ground, where it vanishes. Their mark inverts by design, so the token does
too, and `tokens:check` holds both values to the same floor as the deploy buttons.

Still no count: a build-time one goes stale between deploys, a live one needs the embed, and a
small number beside an ask reads worse than no number.
