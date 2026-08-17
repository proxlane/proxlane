---
'@proxlane/adapters': minor
---

Bright Data gets its own line colour. It shared slot 1 with ScraperAPI, because `line` was
typed `1 | 2 | 3` and taking an existing slot was the only way to compile — so the two were
drawn in the same colour and a failover between them was invisible. `pnpm tokens:check` now
fails on a shared slot or a slot with no token behind it.
