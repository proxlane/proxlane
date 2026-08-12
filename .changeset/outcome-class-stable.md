---
"@proxlane/shared": minor
"@proxlane/adapters": minor
"@proxlane/gateway": minor
---

Add `OutcomeClass`, a closed six-member classification alongside the open `Outcome` union, and send it as `X-Outcome-Class` and in the JSON error body. Branch on the class: it does not grow, so adding an outcome no longer breaks callers.
