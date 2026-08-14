---
"@proxlane/gateway": minor
---

Emit `Server-Timing: gw;dur=…, up;dur=…, total;dur=…` on every `/v1` response. `gw` is
gateway-internal time — the number `operations.md` section 1 gates p95 on, and the one a user
needs when asking whether the gateway or the provider was slow. Split by subtraction, so a
segment nobody instrumented lands in `gw` where it is visible rather than going unmeasured.

Each attempt now records `upstreamMs`, which is wall time inside the provider call and unlike
`latencyMs` is set even when the hop times out.
