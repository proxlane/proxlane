---
'@proxlane/gateway': minor
---

A hard block now says who blocked you. `HARD_BLOCK` is the provider reporting a block — for three of the four adapters that is literally `status === 403` — and the detector never ran on it, so the response carried `X-Outcome: HARD_BLOCK` with no `X-Detect-Rule` beside it. On the product whose pitch is naming the defence, the one outcome that *is* a block could not name it. The outcome is deliberately unchanged; this only adds the label, and a page no rule recognises gets no label rather than a guess.
