---
'@proxlane/web': patch
---

Three FAQ entries, each answering a question the docs could already answer and a reader could
not find.

"What does it cost?" said Proxlane costs nothing, which is true and is not the question anyone
asks about a failover product. "Does failing over cost me more?" says yes, explains that
providers bill attempts rather than successes, and points at the two headers that show it. The
trade is stated rather than sold: failover buys success rate with money, and on easy targets one
provider is cheaper.

"Which provider does it try first, and why?" moves the reasoning out of a code comment. The
default order is deliberate but not evidence-based, a rival's benchmark is not a source to
reorder production traffic on, and measuring this is what the project is for.

"What happens when a provider changes their API?" was asked three separate times in the comments
of the closest comparable launch, and was answered nowhere a reader would look.
