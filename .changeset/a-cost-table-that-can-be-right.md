---
'@proxlane/adapters': minor
'proxlane': minor
---

`CostTable` stops being `base × multipliers` and becomes a matrix: one cost per proxy tier and
render state, exhaustive, `null` where the provider does not sell that combination. No provider
prices multiplicatively, so every adapter had been writing the closest product it could and
leaving a note about it. Scrapfly is additive and was estimated 4.17× too high on residential
plus rendering; ScrapingBee's premium tier is 25 credits with rendering, not 10. `proxlane
providers --json` now emits the matrix and, for the first time, the cost `unit` alongside it.
