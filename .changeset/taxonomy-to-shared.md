---
'@proxlane/adapters': minor
'@proxlane/shared': minor
---

The outcome taxonomy, `Outcome`, `FAILOVER` and `GatewayRequest` move from `@proxlane/adapters` to `@proxlane/shared`, so the base layer no longer depends on a leaf. `@proxlane/adapters` re-exports all of it, so adapter authors import exactly what they imported before.
