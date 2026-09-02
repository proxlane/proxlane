---
'@proxlane/adapters': patch
---

`pnpm conformance` now warns for a week before a deferred fixture comes due, instead of only failing on the day. The failure was well signposted once it fired — it names the category, the date, the command and the reason it was deferred — and completely silent until then, so a debt booked three weeks out arrives as a surprise red build on an ordinary morning. It now prints `DUE SOON` from seven days out, above the verdict rather than below it.
