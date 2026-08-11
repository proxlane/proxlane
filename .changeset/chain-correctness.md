---
'@proxlane/gateway': patch
---

Six routing defects found by an independent review panel: a claimed cooldown probe was never released unless the outcome armed or was exactly `OK`, a concurrent success deleted the account cooldown another request had just armed, the demoted floor was computed before cooldowns and so could be routed past, the terminal hop's larger timeout went to the least healthy provider, an exhausted chain reported the previous provider's failure, and `Retry-After` could be `0`.
