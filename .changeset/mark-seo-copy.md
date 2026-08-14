---
"@proxlane/web": minor
"proxlane": patch
---

A mark, honest SEO, and no em dashes in shipped copy.

The wordmark sets the interchange station as the `o` in proxlane, and the standalone mark is
three provider lines with a station on the middle one, which is the version that survives 16px
in a browser tab. No second typeface: design.md chooses one sans and says the diagram is the
display element.

Adds canonical, Open Graph and Twitter tags, our own robots.txt, and a sitemap, and points the
Worker at proxlane.dev. Without a robots.txt Cloudflare served its own, which was 25 lines of
AI content-signal terms nobody here wrote.

Removes em dashes from user-facing copy. Five of the six were real `proxlane doctor` output and
the exit-code table, so they are fixed at source rather than edited on the page, which would
have made a transcript into a mock-up.
