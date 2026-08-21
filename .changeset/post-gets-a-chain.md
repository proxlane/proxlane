---
'@proxlane/adapters': minor
---

ScraperAPI, ScrapingBee and Scrapfly now forward a POST body to the target. All four providers
document POST support and only one adapter implemented it, so a POST request reached exactly one
provider and could not fail over at all. Recorded `post` fixtures for all three, echoed back by
the target to prove the body arrived.
