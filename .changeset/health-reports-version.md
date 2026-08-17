---
'@proxlane/gateway': minor
---

`GET /health` reports the running version, so a deploy can be verified. Publishing an image is
not deploying it — an orchestrator keeps serving the digest it started with — and there was no
way to ask what was live.
