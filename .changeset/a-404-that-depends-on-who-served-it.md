---
'@proxlane/adapters': minor
---

Bright Data now returns the target's body for every outcome the taxonomy says carries one. A
target 404 came back empty from Bright Data and full from the other three, so what a caller
received depended on which provider won the chain. An error code arriving without a message
header also fell through to OK — `reject_block` with no message was returned as a successful
scrape of a challenge page.

The conformance check that exists to catch exactly this only enforced the `OK` case.
