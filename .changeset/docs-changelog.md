---
"@proxlane/web": minor
---

Add a changelog page, generated from the CHANGELOG.md files changesets already writes. It
cannot fall behind the code without the release process itself having failed. Dependency-bump
entries are filtered out, since they say a number moved rather than what changed, and a
release left with nothing is still listed so the version history has no apparent gaps.
