---
'@proxlane/shared': minor
'@proxlane/gateway': minor
---

A block no longer cools every premium tier. `cd:blk` now carries the tier the request asked for, so
a plain request that gets blocked stops suppressing the stealth retry — the escalation most likely
to work, and the reason the tier exists. The implication still runs downward: a block at stealth
cools residential and plain too, because they are strictly weaker against the same defence.

`/health/cooldowns` reports the tier. Existing armed keys are in the old format and are ignored
rather than migrated; they expire on their own within the cap.
