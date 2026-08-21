---
'@proxlane/gateway': minor
'@proxlane/web': patch
---

Every attempt now records the provider's reported cost, our own table's prediction for the same
request shape, and which of the two the figure came from. Responses carry `X-Cost-Source`:
`reported` when the provider told us, `estimated` when we worked it out. This is what makes a
wrong cost table findable from live traffic instead of by re-reading a vendor's pricing page.
