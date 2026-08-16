---
"@proxlane/gateway": patch
---

Publish the image on a gateway release. The image job was gated on npm having published
something, but the gateway is `private: true` and never publishes, so every gateway-only
release skipped it and ghcr fell two minor versions behind. The image is also now tagged with
the gateway's own version rather than the CLI's.
