---
'@proxlane/gateway': patch
---

The release now tags the gateway image with the version it actually released. It read the
working tree, which `changeset version` had already bumped, so every push to main published an
image tagged with the *pending* version — `0.3.3` and `0.4.0` exist on ghcr while main has been
`0.3.2` throughout — and re-pointed that tag at a new digest each time.
