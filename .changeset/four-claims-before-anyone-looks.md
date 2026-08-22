---
'@proxlane/web': patch
---

The homepage's one copyable command pointed at a hostname that returns 401 to a service nobody can
sign up for. It now shows `localhost:8787`, which is what the README has always said. The detection
section no longer claims every competitor reports a block page as a success — that is false of a
provider we ship an adapter for, and `plan.md` had already retracted it once.
