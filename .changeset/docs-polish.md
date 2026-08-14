---
"@proxlane/web": minor
---

Fix the sitemap and close the gaps against reference documentation sites. Seven docs pages
shipped while `sitemap.xml` still listed one URL, so none of them were discoverable by
crawlers on a project whose growth model is search. `docs:check` assertion 7 now fails when a
page is missing from it.

Adds a copy button on every code block, an "Edit this page on GitHub" link, and prev/next
navigation. Adds the two agent-facing formats the ownership table has named since the
scaffold and nothing had built: `llms-full.txt`, and raw markdown at any docs URL plus `.md`.
Both are generated and asserted byte-identical, the same standard `CODEOWNERS` is held to.
