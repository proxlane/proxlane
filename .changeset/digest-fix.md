---
"@proxlane/gateway": patch
---

Fix the image publish. The per-architecture digest was written to a filename containing a
colon, which `upload-artifact` rejects, so both builds succeeded and then failed at the upload
step. Native arm64 itself works: it produced a digest in under a minute, against the hour the
emulated build ran without finishing.
