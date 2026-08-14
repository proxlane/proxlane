---
"@proxlane/web": minor
---

Add an OpenAPI 3.1 description at `/openapi.json`, generated from the gateway's own outcome
taxonomy so its status codes and enums are the ones the router actually uses. Validates clean
against Redocly. `docs:check` assertion 12 fails when the spec and the handler disagree about
a parameter, a response header or a route.
