---
'@proxlane/detect': minor
'@proxlane/shared': patch
'@proxlane/gateway': minor
---

A challenge page served with a target 5xx is now recognised as a block instead of being reported as
`TARGET_ERROR`. The detector only ever examined `OK` responses, so Cloudflare's under-attack mode —
which answers 503 — came back as "the site is broken" when the truth was that the site's defences
refused every provider. It also armed no cooldown, so every later request re-bought the same
failures.

A claimed success that returned zero bytes is no longer billed as a successful scrape.
