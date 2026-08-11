---
'proxlane': minor
'@proxlane/scripts': patch
---

`proxlane doctor` now diagnoses routing state: where it lives, whether an empty `PROXLANE_VALKEY_URL` is being read as unset, whether the replica count matches the state backing, which of health and cooldowns are on, and whether a configured Valkey is actually reachable.
