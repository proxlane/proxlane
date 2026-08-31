---
'@proxlane/web': patch
---

The docs nav disclosure gets a drawn chevron instead of the `⌄` character, which inherited whatever the font decided and rendered as a stray comma floating above the baseline. Same 16px box and 1.5px stroke as every other icon on the site — the reasoning `theme-toggle.tsx` already gives for not using ☀ and ☾.
