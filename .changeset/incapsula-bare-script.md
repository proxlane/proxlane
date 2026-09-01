---
'@proxlane/detect': patch
---

Imperva serves two block shapes and the rule only knew one. A caller captured both from the same endpoint twenty minutes apart: the framed form we already matched, and a 212-byte page with no iframe and no incident id, just a bare `<script src="/_Incapsula_Resource?…">`. The second reached them through a provider as an ordinary body rather than a flagged block, so a pipeline spent twelve hundred provider requests in a night on pages it believed were fine — the exact failure this detector exists to prevent. What separates a block from a served page turns out not to be the tag or the token: a served page from an unrelated protected site carried the very same token value. It is the query shape, so the rule now reads that instead, and a served page carrying the shared token is pinned as a no-fire test.
