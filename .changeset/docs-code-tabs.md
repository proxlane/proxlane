---
"@proxlane/web": minor
---

Add cURL, Python and Node tabs to the docs code samples. Switching is a hidden radio group
and static CSS, so it works with JavaScript off; a small script syncs every group on a page to
one language and remembers the choice. `docs:check` assertion 10 keeps the plugin's tab cap
and the stylesheet's rule pairs in agreement, because CSS cannot count and a fifth tab would
otherwise render a panel nothing can show.
