# Security

## Reporting a vulnerability

**Do not open a public issue.**

- [**Private vulnerability reporting**](https://github.com/proxlane/proxlane/security/advisories/new). Preferred.
- **security@proxlane.dev** if you would rather use email.

Tell us what you did, what happened, and what you expected. A proof of concept helps but is not required.

You get a reply from a human within **72 hours**. If you do not, the mail was lost. Open a public issue saying only "sent a security report on <date>, no reply", with no details.

## Timelines

| | |
|---|---|
| Acknowledgement | 72 hours |
| Severity and a plan | 7 days |
| Fix, or a written reason it needs longer | 90 days |
| Public advisory | when the fix ships, or at 90 days |

90 days is a ceiling, not a target. If it passes with no fix, the advisory publishes anyway with any known workaround. A quiet unfixed report is worse for people running this than a loud one.

Credit in the advisory unless you ask otherwise. No bounty: one maintainer, no revenue.

## Scope

Proxlane holds two things worth attacking. Other people's provider API keys, and the ability to fetch a URL the caller chooses. Reports touching either are read first.

**In scope**

- The edge guard. SSRF, private-range and cloud-metadata bypasses. `packages/shared/src/edge-guard.ts`, whose 53-vector suite is the bar to beat.
- Key handling: anywhere a key could be logged, returned by an API, written to a fixture, or compared in non-constant time.
- Auth on the gateway's HTTP surface.
- The published npm packages, and container images built from this repo.
- Supply chain: any path by which a fixture or workflow could execute attacker-controlled code.

**Out of scope**

- Bugs in the scraping providers themselves. Report those to the provider; ask us and we will help find the contact.
- Volumetric DoS against an instance you host and control.
- Missing hardening headers on endpoints serving no HTML.
- Scanner output with no demonstrated impact.

## What is deployed today

**No hosted service, and no third party's keys are held by us.** That is the sentence the two gaps below are scoped against, and it still holds: there is no endpoint you can sign up for and nothing of yours is stored anywhere we run.

What does run is one self-hosted instance, operated by the maintainer, holding only the maintainer's own provider keys — the same posture the guide describes for you. It is a target for the gaps below in exactly the way your own instance is, and no more.

The npm packages are published at real versions, not placeholders: `proxlane`, `@proxlane/sdk`, `@proxlane/adapters`, `@proxlane/detect` and `@proxlane/shared`. A supply-chain finding against a published tarball is in scope.

Two gaps, stated because their absence is the finding and you should not have to read the source to learn them:

**Provider keys are not encrypted at rest.** There is no store yet. BYOK self-hosting passes them as environment variables, which is exactly as strong as the host. The libsodium sealed-box design in `docs/operations.md` section 5 lands with the hosted tier.

**Revocation is unbounded, because there is nothing to revoke.** The gateway compares one presented key against one `PROXLANE_API_KEY`, in constant time via `timingSafeEqual` over SHA-256 digests. An earlier version short-circuited on length, which leaks key length; the claim now names the primitive rather than describing an intent. When a key store and cache land, that cache TTL becomes the revocation guarantee and gets a number here.

**Cooldown state is shared across callers on purpose, and is not abuse-metered.** `cd:blk:{provider}:{domain}` is keyed by domain and deliberately shared: a block is a property of the site, which is the point. With multiple tenants that becomes an amplification surface — a caller who can provoke a genuine block on a domain denies that domain to everyone on the instance, and holds it with a few requests per fifteen minutes. Launch is BYOK single-tenant, so today the only person who can do this is the operator. **It is in scope and unmitigated**, and the corroboration or per-tenant shadow-key design has to land with the hosted tier rather than after it. `operations.md` section 5 defers rate limiting to the same milestone.

Both lines change in the same PR as the code.

## Supported versions

Pre-1.0. Only the latest release gets fixes. No backports, no LTS line before 1.0.

| Version | Supported |
|---|---|
| latest release | yes |
| older | no, upgrade |
