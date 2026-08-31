---
'@proxlane/web': patch
---

The route diagram now derives `x-cost-estimate` from its own attempts instead of stating it. The four figures it printed were hand-typed and each was about a thousand times too small: a single plain attempt on any credit provider costs `1.000000`, which is what the gateway returns, while the diagram showed `0.001400`. They read as dollars beside a header naming credits. The `Scenario` type no longer has a cost field, so a scenario cannot state a price its own chain would not produce.
