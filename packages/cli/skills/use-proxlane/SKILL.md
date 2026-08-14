---
name: use-proxlane
description: Use proxlane from a script or an agent: scrape a URL through a provider, choose a provider by capability, look up what an outcome means for retry and billing, or diagnose a broken setup. Covers both surfaces (the CLI and the self-hosted HTTP gateway), the JSON contract, and the exit codes.
---

# Using proxlane

Two surfaces, same semantics underneath. Pick by what you have:

| | use it when |
|---|---|
| **CLI**, `npx proxlane` | one-off work, debugging, or you have no gateway running |
| **HTTP**, `GET /v1` | you are self-hosting the gateway and want failover across providers |

The CLI runs **one provider, one attempt**. The gateway runs the **failover chain**. That is the real difference; everything else matches.

## The two things to get right

**Branch on the exit code (CLI) or the status (HTTP), never on the text.**

| exit | HTTP | means |
|---|---|---|
| `0` | 2xx | good, proceed |
| `1` | 4xx/5xx | the command worked, the **answer** is bad. Read the outcome. **Not a crash.** |
| `2` | 400 | you called it wrong. Retrying the same call will not help. |
| `3` | 401 | the environment is wrong, no key. Stop and fix setup. |

Conflating `1` and `2` is the common mistake: it turns "this URL is blocked" into "my invocation is broken", and produces retry loops that can never succeed.

**Read the envelope, not the prose.** CLI success is `{ok, command, data}` on **stdout**; failure is `{ok:false, command, error:{code, message}}` on **stderr**, still JSON, so parse stderr rather than giving up on it.

## Learn the taxonomy once, at the start

```bash
proxlane outcomes --json
```

Sixteen outcomes. Each carries `failover`, `chargeable`, `httpStatus`, `cooldown`, `pages` and `meaning`. Cache it — it is generated from the router's own table, so it is authoritative rather than documentation that might be stale.

You need it because **you cannot discover these by experiment**: most outcomes cannot be provoked on demand. Nothing you do will reliably produce a `SOFT_BLOCK`.

The three fields that should drive your logic:

- `failover: true` → another provider may succeed.
- `failover: false` → **do not retry anywhere.** A `TARGET_NOT_FOUND` is a 404 at every provider, and retrying spends money to reach the same answer.
- `pages: true` → our bug or a provider contract break. Report it; do not work around it.

## CLI

```bash
proxlane scrape <url> --provider=<id> --json
proxlane providers --json          # capabilities the router filters on
proxlane outcomes --json           # the taxonomy
proxlane doctor --json             # what is wrong with this environment
```

`--provider` is **required**. The CLI has no routing, so nothing can choose for you, and a default would imply a choice no component made. Get valid ids from `proxlane providers`.

Filter on capability before scraping rather than learning a limitation from a failed request:

```bash
proxlane providers --json | jq -r '.data[] | select(.renderJs) | .id'
```

## HTTP gateway

Deliberately ScraperAPI-shaped, so migrating is a hostname change:

```bash
curl "http://localhost:8787/v1?api_key=$PROXLANE_API_KEY&url=https://example.com"
```

| parameter | |
|---|---|
| `api_key` | **required** — authenticates you to the gateway, not to a provider |
| `url` | **required** |
| `render` | `true` to run the page's JavaScript |
| `premium` | `none` \| `residential` \| `stealth` |
| `country_code` | ISO 3166-1 alpha-2 |
| `provider` | force one, for benchmarking. Skips routing. |

Response headers: `X-Outcome`, `X-Provider-Used`, `X-Attempts`, `X-Cost-Estimate`. **`X-Cost-Estimate` covers every attempt, not just the winning one** — a failover that spent two charged hops reports both.

The body is the page when the outcome carries one. Otherwise it is JSON with `outcome`, `reason` and the full `attempts` list, so you can see which providers were tried and what each said.

**The status is the target's** when the outcome passes it through — a 404 from the target reaches you as a 404. That is the drop-in promise: code that already branches on status keeps working.

## Keys

`<PROVIDER>_KEY` — `SCRAPERAPI_KEY`, `SCRAPINGBEE_KEY`, `SCRAPFLY_KEY`. Run `proxlane providers` for the exact variable per provider. BYOK: proxlane never holds a key for you.

The gateway additionally needs `PROXLANE_API_KEY`, which authenticates **callers to it**. It refuses to start without one, deliberately — an open gateway is a proxy funded by whoever deployed it.

A `.env.local` in the working directory is read if present, and never overrides an already-set variable.

## Rules

- **Never echo a key.** Not in a log line, not in an error, not in a command you print. `doctor` reports key length only; hold to that standard.
- **Do not parse human output.** It has no stability guarantee. `--json` does.
- Do not set `FORCE_COLOR`. Escape codes in a captured log are noise you then have to strip.
- On exit `2`, read `error.code` — it names the problem exactly (`MISSING_PROVIDER`, `UNKNOWN_PROVIDER`, `BAD_PREMIUM`, `BAD_TIMEOUT`, `MISSING_URL`).

## What does not exist yet

Block detection, so `SOFT_BLOCK` is never returned; provider cooldowns and health-based ordering; any request log or dashboard; hosted credits. The gateway's provider order is the order they are configured in.

If a task needs one of those, say so rather than approximating it — an approximation that drifts from the real behaviour is worse than an honest gap.
