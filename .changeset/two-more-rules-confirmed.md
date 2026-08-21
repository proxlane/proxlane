---
'@proxlane/detect': patch
---

`datadome` is confirmed against real DataDome block markup, taking the detector to two rules of
six backed by a capture. Documents a measured false positive in `imperva-incapsula`: the token it
matches appears on ordinary pages of Incapsula-protected sites, and only escapes firing because it
fell outside the scan window on the page tested.
