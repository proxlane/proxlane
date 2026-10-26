# @proxlane/sdk

An MCP server that gives an AI agent a web-fetch tool that fails honestly.

A plain fetch hands an agent a 200 with a captcha in the body, and the agent summarises the
captcha. This tool fetches through your own [Proxlane](https://proxlane.dev) gateway, which fails
over between scraping APIs and checks every response for block pages. The agent gets the page as
readable text, or a failure that says what happened and whether retrying is worth it. A block page
is never returned as content.

## Set up

You need a running gateway with at least one provider key. That is one container:
[proxlane.dev/docs/quickstart](https://proxlane.dev/docs/quickstart).

Then add the server to your MCP client. Claude Code:

```bash
claude mcp add proxlane --env PROXLANE_URL=http://localhost:8787 --env PROXLANE_API_KEY=your-gateway-key -- npx -y @proxlane/sdk@0.1
```

Claude Desktop, Cursor and other clients take the same three things in their JSON config:

```json
{
  "mcpServers": {
    "proxlane": {
      "command": "npx",
      "args": ["-y", "@proxlane/sdk@0.1"],
      "env": {
        "PROXLANE_URL": "http://localhost:8787",
        "PROXLANE_API_KEY": "your-gateway-key"
      }
    }
  }
}
```

`PROXLANE_API_KEY` is the gateway's own key, not a provider's. Provider keys stay on the gateway.
Pin the version, as above: `npx -y` otherwise runs whatever was published last, with that key in
its environment.

**Every call spends provider credits**, several times more with `render` or `wait_for`. The tool
is deliberately not marked read-only, so clients that auto-approve read-only tools still ask.

## The tool

`fetch_page`

| Argument | | |
|---|---|---|
| `url` | required | http or https |
| `render` | optional | run JavaScript first; costs several times more |
| `wait_for` | optional | a CSS selector to wait for; implies `render`, and the page is a failure if it never appears |
| `country` | optional | two-letter code, e.g. `us` |
| `format` | `text` (default) or `html` | |
| `max_chars` | default 20000 | longer results are truncated, and say so |

On failure the result is marked as an error and reads:

```json
{ "ok": false, "outcome": "SOFT_BLOCK", "class": "blocked", "retryable": true, "chain": "scraperapi:SOFT_BLOCK>brightdata:SOFT_BLOCK" }
```

`class` is one of six that never grows, and `retryable` follows from it: the site's own answer
(`target`) and a bad request (`client`) are not worth retrying; a block or a provider problem may
be, later. The gateway has already tried every provider it could, so an immediate retry is not.

## In your own process

```ts
import { createServer } from '@proxlane/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

await createServer({ gatewayUrl: 'http://localhost:8787', apiKey: process.env.PROXLANE_API_KEY! })
	.connect(new StdioServerTransport());
```

Apache-2.0.
