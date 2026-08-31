---
'@proxlane/web': patch
'@proxlane/adapters': patch
---

Three fixes found by reading the site on a phone and by running the contributor onboarding path end to end. The docs page list was a wrapping row that broke into four ragged lines on a 390px screen, landing at arbitrary positions against the fixed grid field painted behind every page, so it read as a broken table; it is now a disclosure that opens into the same left-rule list the on-page contents already used. Reference tables were told to fit the viewport, which compressed the widest column — always the last, always the prose — into a ribbon wrapping every cell to three lines; they now take their natural width and scroll, with the first column pinned so a row stays identifiable while you read across it. And `pnpm conformance` on a freshly scaffolded adapter crashed with a Node stack trace pointing into a build artefact, because a scaffold's `translate` throws by design and only `parse` was guarded — it now names the file to implement.
