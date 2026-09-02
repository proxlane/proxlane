---
'@proxlane/adapters': minor
'@proxlane/shared': patch
---

ScraperAPI now reports an exhausted credit balance as `RATE_LIMITED` rather than `AUTH_FAILED`. The old line said "Credits exhausted for the cycle" in a comment and then returned the outcome for a rejected key, so an operator whose monthly quota ran out was told their credential was dead and sent to regenerate a key that was fine. Both outcomes are account-scoped and both fail over, so routing is unchanged; what changes is that the caller gets 429 with the wallet's retry semantics instead of 502 "the provider is broken", and a working key stops being marked unhealthy. `RATE_LIMITED`'s stated meaning now covers a spent plan quota, which two adapters already mapped to it.
