---
'@proxlane/web': patch
---

The 406 that markdown negotiation returns now says why. Two of the ten docs pages —
`/docs/outcomes` and `/docs/changelog` — are generated from the outcome taxonomy and from the
package changelogs rather than written in `content/docs/`, so they have no markdown source to
serve. The code claimed a missing twin meant a broken build; it does not, and the response body
now names the reason and points at `llms-full.txt`, which does carry that content.
