---
'@proxlane/shared': minor
'@proxlane/adapters': minor
'@proxlane/gateway': minor
'proxlane': minor
---

New outcome `QUOTA_EXHAUSTED`, class `gateway`, status 502: the plan's credits are spent for the billing cycle. `RATE_LIMITED` narrows to what it always mostly was, a provider concurrency cap, and stays class `provider`. A caller could not tell "slow down" from "we are out of budget", and a fallback keyed on `gateway` never fired on a night when every free tier was spent. Additive within an existing class. No adapter emits the new outcome yet; the request log, `pnpm record --diff` and the live canary already treat it as an account fact, so the adapters can start emitting it without any of those reading an empty wallet as a failure.
