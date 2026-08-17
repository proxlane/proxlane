---
'@proxlane/gateway': minor
'proxlane': minor
---

Retry the last provider in the chain once before giving up, on `PROVIDER_ERROR` and
`PROVIDER_TIMEOUT` only. Set `PROXLANE_TERMINAL_RETRIES` to change it, 0 to switch it off.
Everywhere else in the chain, failover is still the retry.
