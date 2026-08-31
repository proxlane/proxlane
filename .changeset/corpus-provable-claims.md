---
'@proxlane/detect': patch
---

The verified-rules table now claims only what a retained capture can prove. It cited six captures across five rules and one of those artefacts still existed; the rest were lost with no backup, while the docs site went on reporting those rules as confirmed. `verified.ts` is generated precisely so a claim names an artefact, so a claim whose artefact is gone is not verified — the table reads 2 of 6, and `imperva-incapsula` joins it on a positive capture taken from live traffic. `corpus:verify` also names which claims a mounted corpus cannot back on its read-only path, rather than calling a shrinking table and a growing one both "stale".
