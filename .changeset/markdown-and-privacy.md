---
'@proxlane/web': minor
---

`Accept: text/markdown` on a docs page now returns the markdown. It returned the router's
serialised loader data, which is worse than a 404 because it looks like a successful answer. Both
branches send `Vary: Accept, Accept-Encoding` — without it the negotiation is correct exactly
until a CDN caches one variant and hands it to a caller who asked for the other.

The check is a q-value comparison, not a substring test. Every browser sends a wildcard, a
wildcard matches `text/markdown`, and a naive test would have served the site's own source to
every human visitor while passing any test written for the happy path.

New `/privacy`. "Nothing phones home" is on every other page and was unsubstantiated; this says
what actually happens, including the parts that are not flattering. Written from the code rather
than from intent: no cookies and no analytics were verified against the deployed site, and the
two localStorage keys are named rather than described as "preferences".
