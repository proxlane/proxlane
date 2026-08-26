---
'@proxlane/web': patch
---

A JS-only page at `/canary/js.html`, served from this site so the live canary can stop depending
on somebody else's demo site to prove that providers still render JavaScript. The old target
failed twice in one morning on two different providers while answering in half a second from a
laptop, and `operations.md` section 9 counts three consecutive *scheduled* greens with no way for
a manual re-run to repair one, so a third party having a bad minute could reset a three-week
launch clock.

The marker it looks for appears nowhere in the served HTML — the script assembles it from two
halves — so a provider returning the unrendered source cannot accidentally satisfy the check.

The header links to GitHub as `star` rather than `github`. Not GitHub's own button: that is an
iframe from a third-party host, on a site whose argument is that it does not leak. No count
either, because a small number next to an ask reads worse than no number.
