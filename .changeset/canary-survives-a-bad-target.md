---
'@proxlane/adapters': patch
---

The live canary retries once when the TARGET failed, and says so loudly.

`operations.md` section 9 counts three consecutive *scheduled* greens, and a manual re-dispatch
does not repair a red one. So a third-party page having a bad minute on a Monday morning resets a
three-week launch clock and nothing done afterwards fixes it. That happened twice in one morning
on 2026-08-25, on two different providers, against a demo site answering in half a second from a
laptop.

`TARGET_ERROR` is the one outcome that says the failure was not the provider's, and this canary
exists to ask whether the provider still behaves. Only that outcome is retried; everything the
provider is blamed for is reported on the first attempt. The three tests expect `OK`,
`TARGET_NOT_FOUND` and `OK`, so a retry cannot paper over an assertion.
