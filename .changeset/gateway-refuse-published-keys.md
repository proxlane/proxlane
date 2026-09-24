---
"@proxlane/gateway": minor
"@proxlane/shared": minor
"proxlane": minor
"@proxlane/web": patch
---

The gateway now refuses to start when `PROXLANE_API_KEY` is empty, a placeholder such as `changeme`, or a value published in an example or CI workflow: if your running deployment uses one, it will stop starting after this upgrade until you set a generated key. It warns at boot for a key under 24 characters or a published sandbox key, and `proxlane doctor` reports all of these.
