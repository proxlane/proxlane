---
'@proxlane/detect': patch
---

`imperva-incapsula` no longer fires on ordinary pages. It matched `_Incapsula_Resource`, which is
how any Incapsula-protected site loads Imperva's client script; it now keys on the structural
difference — a block page *frames* that resource, an ordinary page *scripts* it — which also
survives Imperva rotating the query parameter. `capture-block` names files by content digest, so
two captures can no longer overwrite each other.
