---
'@proxlane/gateway': minor
---

`GET /health` now reports `usable` beside `providers`: how many configured providers are not currently in an account cooldown for this org, which is the number a request could actually be sent to. A caller ran for a week at zero effective capacity while `/health` said `providers: 4`, because four were configured. Still a count and no names, still no key, and `status` stays `ok` regardless, because liveness must not flap on provider state. The request log also marks a chain that ended with nothing but account faults as `legs: "account"`, the greppable signature of a gateway whose credentials or wallet, not the target, ended the request.
