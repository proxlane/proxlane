---
'@proxlane/web': patch
---

Four things an agent reads are now correct or present.

`llms.txt` — the one file published for machines — summarised the gateway as fronting three
providers, and had done since the fourth shipped. Every human-facing surface had already been
corrected. `docs:check` now holds its summary block to the registry.

The 404 was the words "Not Found" inside the site chrome: a correct status and a dead end. It
names the docs index and the three machine-readable indexes by full URL, so something that
guessed a path wrong can recover instead of concluding the site is empty.

The homepage carries JSON-LD. `SoftwareApplication` rather than `Organization`, because an
Organization block is worth nothing without `contactPoint` and `address`, and there is no company
here to describe.

`GET /health/providers` and `GET /health/cooldowns` declared a 200 with no body schema, so a
generated client got `unknown` from the two calls it makes on a schedule. Both are typed from a
running container, and `docs:check` fails any operation whose 200 is untyped. The spec also now
states what is safe to depend on: `X-Outcome-Class` is closed, `X-Outcome` is not, and at 0.x a
breaking change to `/v1` arrives as a minor.
