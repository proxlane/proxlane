---
'@proxlane/adapters': patch
---

`post` and `sessions` now say what they mean: a claim about the adapter, not about the provider.
Both were undocumented booleans, and a research pass against the vendors' docs reported all four
as live bugs because every provider sells POST and sessions — while every value was correct, since
the field describes what `translate()` actually wires. Tests now hold each claim to the code that
implements it.
