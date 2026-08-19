---
'@proxlane/adapters': minor
'@proxlane/gateway': minor
---

A cost number now carries its unit, and units are never summed together. Three launch providers
sell credits and Bright Data bills cents, so `X-Cost-Estimate` was adding one provider credit to
fifteen hundredths of a cent and reporting the result as a quantity. `CostTable.unit` is required,
the gateway emits `X-Cost-Unit` beside the figure, and a chain that spent in two units reports
`mixed` rather than an invented total.
