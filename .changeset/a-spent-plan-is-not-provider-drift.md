---
"@proxlane/adapters": patch
---

`pnpm record --diff` no longer reports an exhausted provider plan as fixture drift. A spent
account answers 403 or 429 to every category, so `parse()` returns `RATE_LIMITED` where a target
fact was expected; those categories are now reported as NOT CHECKED rather than as changed
outcomes, and a run where nothing could be compared still fails.
