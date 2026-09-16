---
'@proxlane/adapters': patch
---

Fixtures re-recorded where the 2026-09-16 weekly diff found a changed shape, plus the missing ScrapingBee and Bright Data `deadline` fixtures. Every change was additive or target-side (Scrapfly added `config.unblocker`, the test target stopped echoing `Sec-Ch-Ua` client hints); every category still maps to the same outcome, and conformance passes on all four adapters.
