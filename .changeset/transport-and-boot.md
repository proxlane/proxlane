---
"@proxlane/gateway": patch
---

Cover the two things nothing tested. The real HTTP transport now has an e2e against a
deliberately hostile server, including a regression test for the measured bug where a body
trickling in after the headers ran six times its budget. And `build-docker` now boots the
image it builds, asserting the gateway refuses to start without a key, serves `/health`,
answers `/v1` with the taxonomy, and prints its banner. `selfhost:smoke` runs weekly.
