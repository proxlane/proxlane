---
'@proxlane/web': patch
---

The homepage boot banner printed the provider table's order and called it the routing order. The
gateway routes Scrapfly ahead of ScrapingBee, so the page named the wrong provider as first to be
tried and paid. The provider table is now derived from the capability registry rather than typed
out — two of its cells were wrong, ScrapingBee's geography and Scrapfly's rendering multiplier.
