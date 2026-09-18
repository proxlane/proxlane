---
'@proxlane/gateway': minor
---

Sandbox mode: `PROXLANE_SANDBOX_KEY` is a second key that can never spend. With it, `X-Proxlane-Simulate: <OUTCOME>` answers `/v1` from the outcome table, with the real headers, and calls no provider. The live key is refused with 400 if it sends the header.
