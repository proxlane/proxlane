---
title: Using Proxlane from an agent
summary: How to give an AI agent a scraping tool that fails honestly.
---

Agents are bad at ambiguous failure. Give one a scraper that returns 200 with a challenge
page and it will summarise the challenge page. Proxlane exists to make the failure legible,
which is exactly what an agent needs.

## The one rule

Branch on `X-Outcome-Class`, and give the agent a different instruction per class.

```typescript
const res = await fetch(
  `${GATEWAY}/v1?url=${encodeURIComponent(url)}`,
  { headers: { Authorization: `Bearer ${key}` } },
);

switch (res.headers.get('x-outcome-class')) {
  case 'ok':
    return { text: await res.text() };
  case 'target':
    // The site answered. Do not retry, do not try another tool.
    return { error: 'page does not exist or refused access', retryable: false };
  case 'blocked':
  case 'provider':
  case 'gateway':
    // Proxlane already failed over. Back off, do not loop.
    return { error: 'temporarily unavailable', retryable: true };
  case 'client':
    return { error: 'the URL was rejected as invalid', retryable: false };
}
```

Six classes, and the set never grows. New outcomes land inside existing classes, so this
switch does not need revisiting.

## Why `retryable` matters

An agent that cannot tell "blocked" from "not found" does one of two bad things. It retries a
404 until it runs out of budget, or it gives up on a page that was merely blocked once.

`X-Outcome-Class` answers that in one string. `X-Outcome` tells you why, if you want it in
the log.

## Tell the agent what it got

Pass the outcome through to the model rather than swallowing it. A tool result of

```json
{ "ok": false, "outcome": "HARD_BLOCK", "attempts": 3, "retryable": true }
```

produces better behaviour than an empty string, because the model can say "that site is
blocking us" instead of inventing a summary of nothing.

`X-Attempts` and `X-Cost-Estimate` are worth logging for the same reason. An agent loop that
quietly costs three times what you expected is a failover loop nobody surfaced.

## From the command line

The CLI is a usable tool surface for agents that shell out.

```bash
proxlane scrape https://example.com --provider=scraperapi --json
```

`--json` is the point. Every command supports it, and it is the form a tool wrapper should
parse. Exit codes distinguish usage errors from scrape failures.

```bash
proxlane outcomes --json     # the full taxonomy, for building a retry policy
proxlane providers --json    # which providers are configured
proxlane doctor --json       # diagnose a deployment
```

`proxlane scrape` calls a provider directly using keys from the environment. It does not go
through the gateway, so there is no failover. It is a debugging and inspection tool, not a
production path.

## Machine-readable docs

`llms.txt` at the site root lists every documentation page in a form intended for models:

```
https://proxlane.dev/llms.txt
```

## What does not exist yet

There is **no MCP server** and no published SDK. `@proxlane/sdk` is a placeholder.

Use the HTTP endpoint. It is a single GET, it needs no client library, and the headers are
the interface.
