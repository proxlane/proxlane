---
'@proxlane/web': minor
---

The changelog says when. It had no dates anywhere, and its own comment explained why:
"changesets records no dates". True of changesets, false of this repo — every release cuts a git
tag and a tag has a date, so the order is read rather than invented.

A Recent section now merges the last twelve releases across every package, newest first, and the
intro states the last release date. The question a stranger arrives with is whether the project
is alive, and a page grouped into five per-package sections could not answer it without being
read five times and merged in your head.

The self-credit is stripped. `@changesets/changelog-github` writes "Thanks [@handle]!" on every
entry, which is the right default and the reason that generator was chosen — it credits
strangers. On a repo with one maintainer it rendered as the same person thanking themselves forty
times down one page. Stripped for that handle only, so the first outside contribution is credited
the moment it lands, and the CHANGELOG files keep the record either way.

The docs plugin throws when it finds no tags rather than shipping a dateless page, because
`actions/checkout` is shallow by default: this would have worked on a laptop and quietly lost the
dates in production.
