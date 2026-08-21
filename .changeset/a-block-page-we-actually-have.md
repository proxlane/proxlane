---
'@proxlane/detect': patch
---

`pnpm capture-block` turns a real HTTP response into a block-page corpus entry. `plan.md` §19
decides where it lands: a purpose-built scraping sandbox may enter this repository, anything else
requires a private directory and is refused without one. Captures store a class of target, never
a hostname, and are scrubbed of provider keys.
