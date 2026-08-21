---
'@proxlane/detect': minor
'@proxlane/web': patch
---

Whether a detection rule has been confirmed by a real block page is now derived from stored
captures rather than a hand-set boolean. `pnpm corpus:verify` runs every capture through the real
detector and generates the table, recording each capture's SHA-256, so a claim points at an
artefact. `cloudflare-challenge` is the first rule confirmed against the thing it describes.
