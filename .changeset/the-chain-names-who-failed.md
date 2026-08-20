---
'@proxlane/gateway': minor
---

`X-Chain` names every attempt as `provider:outcome`, in order, and the request log carries it
too. `X-Provider-Used` names the winner, so a request that failed over and then succeeded came
back as a clean 200 that hid the provider which had just cost 22 seconds. Found on the live
gateway: four requests timed out at one provider, all four failed over and returned 200, and
identifying the culprit needed `/health/cooldowns`, which expires.
