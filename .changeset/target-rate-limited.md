---
'@proxlane/shared': minor
'@proxlane/adapters': minor
'@proxlane/gateway': minor
'proxlane': patch
---

A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.
