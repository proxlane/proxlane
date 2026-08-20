---
'@proxlane/gateway': minor
'@proxlane/shared': patch
---

The global deadline defaults to 120s, which `operations.md` decided some time ago and the
gateway never picked up. At 90s a three-hop chain gave the terminal provider 38s of its 70s cap,
because the budget reserves time for every hop still to come. The hop that exists to rescue a
failing request was the one being cut short.

Callers still ask for less via `timeout` and never for more. The operator's deadline is the
ceiling, because it bounds how long one request holds an in-flight slot.
