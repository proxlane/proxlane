---
'@proxlane/shared': minor
'@proxlane/adapters': patch
'@proxlane/gateway': patch
'proxlane': patch
---

One executor for every request. The gateway, `proxlane scrape`, `pnpm record`, the k6 harness and the live canary now all call `createFetchTransport()` from `@proxlane/shared/transport`, instead of each hand-rolling its own `fetch`. The canary's copy dropped `wire.body`, which only Bright Data sends, so it reported a working key as `AUTH_FAILED` on every run — `repo:check` assertion 50 and a new contract test now hold the line. `proxlane scrape` and `pnpm record` gain the capped streaming read and the timeout/abort discrimination they were missing.
