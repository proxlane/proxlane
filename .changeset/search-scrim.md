---
"@proxlane/ui": patch
"@proxlane/web": patch
---

Fix the search dialog's backdrop in dark mode. It was mixed from `--color-ink`, which inverts
with the theme, so on dark it was 45% near-white and fogged the page grey instead of dimming
it. Adds a `--color-scrim` token that darkens in both themes, deeper on dark where the page is
already dark.
