---
'@proxlane/gateway': minor
---

The background prober lifts demoted providers back into rotation: paced by the documented backoff, leased when several replicas share a Valkey, and pointed at the same stable target the canary uses. `GET /health/cooldowns` shows the cooldowns actually held, split by namespace, so an operator can see why a provider is being skipped.
