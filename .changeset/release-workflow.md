---
'@proxlane/scripts': patch
---

Add the release workflow, which never existed: changesets publish with npm provenance, a GitHub Release, and multi-arch ghcr images. `repo:check` assertion 22 now fails when the ownership table names a file that does not exist, which is how this went unnoticed.
