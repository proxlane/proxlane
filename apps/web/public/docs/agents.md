<!-- Source: https://proxlane.dev/docs/agents — edit apps/web/content/docs/agents.md -->
---
title: Using Proxlane from an agent
summary: How to give an AI agent a scraping tool that fails honestly.
---

Agents are bad at ambiguous failure. Give one a scraper that returns 200 with a challenge
page and it will summarise the challenge page. Proxlane exists to make the failure legible,
which is exactly what an agent needs.

## As an MCP server

`@proxlane/sdk` is an MCP server with one tool, `fetch_page`, that fetches through your gateway.
Claude Code, Claude Desktop, Cursor and any other MCP client can use it.

```bash
claude mcp add proxlane --env PROXLANE_URL=http://localhost:8787 --env PROXLANE_API_KEY=your-gateway-key -- npx -y @proxlane/sdk@0.1
```

The agent gets the page as readable text, or a failure marked as an error:

```json
{ "ok": false, "outcome": "SOFT_BLOCK", "class": "blocked", "retryable": true }
```

A block page is reported as a failure, never handed over as content, and `retryable` follows
the rule below. Other clients and the full argument list:
[the package README](https://github.com/proxlane/proxlane/tree/main/packages/sdk#readme).

The rest of this page is for building the same thing yourself over HTTP.

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

There is no client library beyond the MCP server. Over HTTP, use the endpoint directly: it is a
single GET, and the headers are the interface.
