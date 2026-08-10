<!--
Keep it short. Reviewers skim, and length hides the important line.
Delete any section that does not apply rather than writing "n/a".
-->

## What and why

<!-- One or two sentences. The diff shows what changed; say why it changed. -->

## How to verify

```
# the commands a reviewer should run, and what they should see
```

## Checklist

- [ ] `pnpm repo:check` `pnpm typecheck` `pnpm lint` `pnpm test:unit` pass
- [ ] Tests added or updated, and they are not mocks of our own code
- [ ] Changeset included, or this changes no shipped behaviour
- [ ] Docs updated **in this PR** if the public surface moved
- [ ] `pnpm conformance` green if an adapter changed
- [ ] No secrets in fixtures, and no hand-written fixtures
- [ ] Nothing here should stay private once the repo is public — no IPs, hostnames,
      `/root/` paths, commercial terms, or third-party personal data

<!--
Two things behave differently on a fork PR, both by design:

  - The live canary cannot run. GitHub does not expose secrets to forks, so a maintainer
    runs it on house keys before merge. A skipped canary is expected, not a failure.
  - `security-review` runs only when the diff touches scripts/security-review-paths.json.

Commands that exit 1 with NOT IMPLEMENTED are working as designed. Read the output — it
names the owner, the spec and the file that would flip it. Never make one exit 0.
-->
