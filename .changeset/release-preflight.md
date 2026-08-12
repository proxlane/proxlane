---
'@proxlane/scripts': patch
---

The release workflow now proves the npm credential before versioning anything, so an expired token fails with an actionable message instead of after the release PR has merged.
