---
'@proxlane/shared': patch
---

Valkey-backed health and cooldown stores, so more than one gateway replica can share routing state. Set `PROXLANE_VALKEY_URL` to use them; unset, both stay in-process and the server still refuses to boot with `PROXLANE_REPLICAS>1`.
