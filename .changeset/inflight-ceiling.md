---
"@proxlane/shared": minor
"@proxlane/gateway": minor
"proxlane": minor
---

Enforce the in-flight ceiling. Past `PROXLANE_MAX_INFLIGHT` concurrent `/v1` requests the
gateway answers 429 `GATEWAY_BUSY` with `Retry-After` and sheds, rather than queueing —
a queued scrape burns its own deadline waiting and the queue is memory the ceiling bounds.
`/health` is never shed. The variable was documented since the scaffold and read by nothing.

`GATEWAY_BUSY` is a new outcome, class `gateway`. Deliberately not `RATE_LIMITED`, which is
class `provider`, writes an account cooldown and fails over — all three wrong when the
gateway itself is full. `OutcomeClass` does not grow, so a caller branching on the class is
unaffected.
