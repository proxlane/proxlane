---
'@proxlane/detect': patch
---

A Cloudflare block page is now reported as `cloudflare-blocked` rather than
`cloudflare-challenge`. Real block pages carry both signatures, and rule order meant the block
rule could never fire — `X-Detect-Rule` named the wrong reason on every Cloudflare block. Five of
six detection rules are now confirmed against a real captured page.
