---
"@proxlane/gateway": patch
---

Pin `changesets/action` back to v1. Its v2 requires Changesets CLI v3 and refuses to run
against the v2 CLI this repo pins, and it renames every input. Moving it is a release-path
migration behind a CLI major, not a version bump. v1 already targets Node 24, so it was never
part of the deprecation.
