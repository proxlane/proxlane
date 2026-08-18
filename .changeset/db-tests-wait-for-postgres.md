---
'@proxlane/db': patch
---

The migration suite waits for Postgres to be ready rather than merely listening. It started the
container with no wait strategy, so the default returned as soon as the port bound — before
`initdb` finished — and all 17 partition tests failed at once with `57P03: the database system is
starting up`.
