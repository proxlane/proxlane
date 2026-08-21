---
'@proxlane/gateway': minor
---

The request-body cap now stops the read instead of measuring it afterwards. `c.req.text()`
resolved only once the whole body was in memory, so an oversized POST was refused having already
paid the allocation the cap exists to prevent.

A client that disconnects now aborts the in-flight provider request instead of leaving the chain
walking every provider for the full deadline. It is reported as its own outcome, never as
`PROVIDER_TIMEOUT` — blaming a healthy provider for a caller hanging up would cool it and feed the
health statistic a failure nobody caused.
