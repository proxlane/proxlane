---
"@proxlane/web": minor
---

Add search to the docs. The index is built from the same markdown the pages are, one record
per section rather than per page, and runs entirely in the browser: no third party sees what
a reader types about a scraping gateway. Cmd+K, Ctrl+K or `/` opens it. `docs:check` assertion
11 fails when a page is missing from the index, since a page that is silently unsearchable
reads as a page that does not exist.
