---
"@proxlane/route-viz": patch
"@proxlane/web": patch
---

Three fixes from a visual pass. The docs page title used an em dash as a separator, which
reads as part of the title in a truncated browser tab; it is a middle dot now. The shed
request in the route diagram stopped short of its own outcome label, leaving a line ending in
mid-air; it now reaches the terminus column, because a shed request has no provider to fall
short of. And a Python sample imported two modules on one line, against PEP 8.
