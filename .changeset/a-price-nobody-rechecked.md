---
'@proxlane/adapters': patch
---

Cost tables must now carry a source URL and the date somebody last read it, no two providers may
cite the same page, the scaffold's placeholder zeroes cannot ship, and a table nobody has re-read
in a year fails the build. No test can verify a price without fetching a vendor's marketing site
in CI, so this enforces the next best thing.
