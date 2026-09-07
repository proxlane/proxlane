---
'@proxlane/shared': minor
'@proxlane/gateway': minor
'proxlane': patch
---

`AUTH_FAILED` is now class `gateway`, not `provider`. A provider rejecting a key the gateway holds is the gateway's configuration failing, and the request never reached the target — so `X-Outcome-Class: gateway`, which is what a client branching on "is the gateway itself unusable" needs to see. Labelled `provider`, a rotated Bright Data key read as "the chain tried and the target declined", and a downstream caller's fallback to its own account stayed suppressed for a week. Failover, cooldown and the 502 are unchanged; only the class moved. `proxlane doctor` now fails a `BRIGHTDATA_KEY` that has no `<zone>:` prefix, since a bare token is sent with an empty zone and comes back as the same `AUTH_FAILED` a revoked key would.
