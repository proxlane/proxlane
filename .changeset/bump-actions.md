---
"@proxlane/gateway": patch
---

Bump every GitHub Action to a major that targets Node 24. GitHub was already force-running the
Node 20 ones and warning on each release. Includes `changesets/action` v2, whose breaking
change moves the custom token from an environment variable to a `github-token` input — left
alone, the release PR would have silently reverted to the default token and arrived with no
checks.
