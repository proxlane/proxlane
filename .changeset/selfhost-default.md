---
'@proxlane/gateway': patch
---

Fix the default self-host deployment, which built a Redis client for an empty `PROXLANE_VALKEY_URL` and returned 500 from `/health/providers`. Compose now passes every variable the gateway reads, empty is treated as unset, and `/health/providers` fails open like the routing path.
