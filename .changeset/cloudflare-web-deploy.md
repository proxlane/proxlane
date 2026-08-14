---
"@proxlane/web": minor
---

Deploy the marketing site to Cloudflare Workers. Adds the Cloudflare Vite plugin, a
`wrangler.jsonc`, and a path-filtered deploy workflow. The gateway is explicitly not deployed
this way — Workers has no Node runtime and no undici, which is the reason the gateway runs on
Node at all.
