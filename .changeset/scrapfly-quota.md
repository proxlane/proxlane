---
'@proxlane/adapters': patch
---

An exhausted Scrapfly plan is an account fact, not a provider outage. Scrapfly answers HTTP 429 with `ERR::SCRAPE::QUOTA_LIMIT_REACHED` and a null target status; unmapped, that fell through to `PROVIDER_ERROR`, which sits in the failure term of global provider health. One org running out of credits would therefore drive the health statistic down for every org and could demote Scrapfly out of every chain for hours — the same cross-org contamination already documented for `AUTH_FAILED`. It is now `RATE_LIMITED`, which cools per account and fails over to a provider that has credit.
