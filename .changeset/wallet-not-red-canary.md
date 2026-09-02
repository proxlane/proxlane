---
'@proxlane/adapters': patch
---

The live canary now treats an exhausted provider account as a coverage gap rather than a failure. `RATE_LIMITED` is account-scoped and means the plan is spent, so the provider is reported UNCHECKED by name, exactly as a missing key already was. Nothing else is exempt — `PROVIDER_ERROR`, `PROVIDER_DRIFT`, `AUTH_FAILED` and `SOFT_BLOCK` all still fail the run — and if every configured provider lands there the canary fails, because a run that called nobody is not a green run.
