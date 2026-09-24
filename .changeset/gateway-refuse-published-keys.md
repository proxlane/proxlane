---
"@proxlane/gateway": minor
"@proxlane/web": patch
---

The gateway refuses to start with a placeholder key such as `changeme`, or with any key that has appeared in a published example or CI workflow, and warns at boot when its key is under 24 characters.
