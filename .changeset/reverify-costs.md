---
'@proxlane/adapters': patch
'@proxlane/web': patch
---

All four cost tables re-read against the providers' own live documentation on 2026-08-31 and none had moved, so each `effectiveDate` advances and each carries a note of the figures the source states. ScraperAPI, ScrapingBee and Bright Data confirm every cell verbatim; Scrapfly's page shows the arithmetic the table encodes. Scrapfly's stealth column stays residential-equivalent because ASP "may dynamically upgrade the proxy pool" and therefore has no fixed published price, which is why cost from that provider arrives reported rather than estimated.


Reading the pricing pages as well as the docs turned up a limit the matrix cannot express, and the comparison page now says so: two of the four price partly on what the *target* does rather than on what you asked for. ScraperAPI adds ten credits per request when it bypasses Cloudflare, DataDome or PerimeterX, and Scrapfly's ASP may upgrade the proxy pool mid-request. Neither is a function of tier or rendering, which is the only thing a cost matrix is keyed on — which is the argument for preferring the reported figure over the estimated one, and for saying which you got.
