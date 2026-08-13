---
"@proxlane/ui": patch
"@proxlane/route-viz": patch
---

`@theme static`, without which Tailwind tree-shook two provider line colours out of the built CSS and the route diagram rendered a provider's leg invisible. `tokens:check` now refuses a bare `@theme`.
