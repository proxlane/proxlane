---
'@proxlane/detect': patch
---

Restores the five verified detection rules retracted earlier today. The captures behind them were never lost — they live in the private `proxlane/corpus` repository, which nothing in the repo mentioned, so an exhaustive search of one machine concluded the evidence was gone. All six rules are confirmed by a real capture, from nine captures in total. `corpus:verify`'s refusal now names the repo to clone before anyone reaches for `--allow-retractions` again.
