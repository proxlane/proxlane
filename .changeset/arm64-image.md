---
"@proxlane/gateway": patch
---

Publish the container image for arm64 on a native arm64 runner instead of emulating it. The
previous multi-arch build ran under QEMU and did not finish, which left the published image
two minor versions behind npm. Self-hosters on Pi and Ampere are the reason arm64 ships at
all, so the image being stale mattered most to exactly them.
