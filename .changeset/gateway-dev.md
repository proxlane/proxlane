---
"@proxlane/gateway": patch
---

Fix `pnpm dev` for the gateway. It ran `node --watch src/index.ts`, which could never work:
application source imports siblings as `./app.js`, and Node's type stripping does not rewrite
that to `.ts`, so the process died on its first import. It builds and runs the output now.
`repo:check` assertion 27 fails on any script that runs bare node against `src/**` TypeScript.
