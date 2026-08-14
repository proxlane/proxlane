---
"@proxlane/web": patch
---

Restore the copy button's styles. They were deleted by an edit that truncated the stylesheet,
so the button shipped unstyled on every code block. `docs:check` assertion 9 now fails when a
class the component applies at runtime has no rule in the stylesheet.
