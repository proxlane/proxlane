---
'@proxlane/adapters': minor
---

Scrapfly and ScraperAPI now report a spent plan as `QUOTA_EXHAUSTED` (class `gateway`, 502) instead of `RATE_LIMITED` (class `provider`, 429). Both providers tell the two apart themselves: Scrapfly with `ERR::SCRAPE::QUOTA_LIMIT_REACHED` versus its concurrency code, ScraperAPI with a 403 carrying no `sa-statuscode` versus a 429. A caller can now fall back on `gateway` when every free tier is spent. ScrapingBee and Bright Data are unchanged, because neither response distinguishes a spent plan in a way the adapter can read without guessing. The live canary now exempts only `QUOTA_EXHAUSTED`, so a concurrency cap during a run is reported rather than silently skipped.
