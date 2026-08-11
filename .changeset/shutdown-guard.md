---
'@proxlane/shared': patch
---

A gateway shutting down while Valkey is unreachable no longer crashes: `redis.quit()` rejects on a broken socket, and each shutdown step is now independent.
