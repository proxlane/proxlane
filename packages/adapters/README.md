# @proxlane/adapters

Provider adapters, the capability registry and the cost tables behind
**[Proxlane](https://proxlane.dev)** — one endpoint in front of ScraperAPI, ScrapingBee, Scrapfly
and Bright Data, with automatic failover and honest block detection.

**Apache-2.0**, deliberately. The gateway is AGPL; this package is permissive because adapters are
the thing we most want written by people who are not us.

## What is in here

An adapter is two pure functions and a capability declaration:

```ts
translate(request, key) -> ProviderHttpRequest   // build the provider's request
parse(response)         -> ParsedResult          // read it back as an outcome
```

Nothing else. No network, no retries, no state — the gateway owns all of that, so every provider
fails over the same way.

The capability declaration is data, not code: rendering, premium tiers, sessions, POST, binary,
country codes, mutually-exclusive combinations, and a cost matrix with the vendor page and date it
came from. The router filters on it, the CLI prints it and the website renders it, so a provider
that cannot serve your request is excluded before it is paid for.

```ts
import { CAPABILITIES, costOf, REGISTRY } from '@proxlane/adapters';

const scrapfly = CAPABILITIES.find((c) => c.id === 'scrapfly');
costOf(scrapfly.costTable, { premium: 'residential', renderJs: true });
```

## Writing one

`pnpm new-adapter <id>` scaffolds it and `pnpm conformance --adapter=<id>` holds it to the
contract. **You do not need a provider API key to contribute** — the contract suite replays
recorded fixtures, so Node, pnpm and Docker are enough.

See [CONTRIBUTING.md](https://github.com/proxlane/proxlane/blob/main/CONTRIBUTING.md).
