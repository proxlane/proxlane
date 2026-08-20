---
'@proxlane/web': patch
---

The response-header panel no longer breaks header names mid-word or clip long values. `x-chain`
is much longer than anything else on the page, and a `1fr` grid track will not shrink below its
content, so it took the width out of the name column beside it and still overflowed.
