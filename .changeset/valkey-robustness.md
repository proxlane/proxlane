---
'@proxlane/gateway': patch
---

Valkey store robustness: the observation buffer is bounded and no longer amplifies load against a struggling store, in-flight batches stay visible to reads, a throwing error reporter can no longer kill the process, the claim script fails open on an unreadable record like the JS side does, and the gateway drains on SIGTERM instead of dropping buffered work.
