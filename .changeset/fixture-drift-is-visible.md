---
'@proxlane/adapters': patch
---

A fixture shape change now opens an issue instead of reddening a scheduled run nobody watches.
The canary has reported that way since it was written; `record:diff` never did, and on 2026-08-26
three of four adapters failed there and it went unnoticed for two days. One issue per adapter,
with the shape diff in the body, and a comment rather than a duplicate on the next run.

Bright Data gains the POST fixture it never had — the only adapter of four declaring `post: true`
with no recorded evidence for it. Recorded against the live API; the target echoes the body back,
so the fixture proves the body arrived rather than only that the request succeeded.

Scrapfly's fixtures are re-recorded. Their request shape genuinely changed when `os` started
being pinned, and the fixtures had not caught up. ScrapingBee's are re-recorded too, though its
drift was the test target echoing a different set of request headers rather than anything
ScrapingBee did.
