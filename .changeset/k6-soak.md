---
"@proxlane/gateway": patch
---

Build the load harness `operations.md` section 9 asks for: a local mock provider that returns
slow responses, 429s, huge bodies and challenge pages on demand, the real gateway wired to it
over a real socket, and a k6 soak that gates on p95 of `Server-Timing: gw;dur=`, RSS slope
from minute 10, and the concurrency ceiling actually shedding. `pnpm k6:soak` is implemented;
22 of 25 commands are now real.

The gateway gains `./app` and `./transport` export paths so the harness can build the real app
from the shipped artifact rather than importing source.
