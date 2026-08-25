---
'@proxlane/ui': patch
'@proxlane/web': patch
---

Two accessibility defects on the homepage, both found by running `pnpm lighthouse:assert` for the
first time in a while.

The deploy buttons printed their price at 60% of the host's brand colour, which measured 2.46:1.
DigitalOcean's published blue is 4.51:1 at full strength, so any dimming at all put it under the
floor. The price is smaller and lighter now rather than fainter, and both brand tokens are held
to 5:1 by `tokens:check` — above WCAG on purpose, because a threshold cleared by a hundredth is
satisfied and still fragile, which is exactly how this shipped.

The mobile menu was `aria-hidden` while closed and its links stayed focusable, so a keyboard user
tabbed into an invisible sheet. It is `inert` when closed now.

Accessibility is back to 100.
