# proxlane

One endpoint in front of every scraping API. This is the CLI.

```bash
npx proxlane --help
```

No install, no signup, no account. **BYOK**: you bring provider keys, proxlane never holds
one for you.

## Built for programs first

The primary caller is a script or an agent, not a person. That drives four properties, each
of which is a thing that breaks machine consumption when it is missing:

- **`--json` on every command.** Not a formatting option — a contract. Pretty output is for
  the human running it once; JSON is what gets parsed, diffed and pasted into an issue.
- **stdout is data, stderr is commentary.** `proxlane x --json | jq` never receives a
  progress line on stdout, and a *failure* is still parseable JSON on stderr.
- **No prompts, no spinners, anywhere.** A prompt hangs a process with nobody to answer it;
  a spinner writes thousands of escape codes into a captured log.
- **Exit codes are public API.** Branch on them.

| Code | Meaning |
|---|---|
| `0` | the answer is good |
| `1` | the command ran and the answer is **bad** — blocked, unhealthy, not `OK`. Not a crash. |
| `2` | the **invocation** was wrong: unknown command, missing or bad argument |
| `3` | the **environment** is wrong: no API key. Fix the setup, not the call. |

The `1` versus `2` split is the one that matters when automating: `1` means *try something
else*, `2` means *you called it wrong and retrying will not help*.

## Commands

### `proxlane scrape <url> --provider=<id>`

One real attempt through one real adapter, and the name proxlane gives the result.

```bash
proxlane scrape https://example.com --provider=scrapingbee --json
```

```json
{
  "ok": true,
  "command": "scrape",
  "data": {
    "outcome": "OK",
    "upstreamStatusCode": 200,
    "httpStatus": "upstream",
    "failover": false,
    "chargeable": true,
    "latencyMs": 1730,
    "bodyBytes": 6258,
    "cost": { "microcredits": 1000000, "source": "reported" }
  }
}
```

**`--provider` is required, and that is deliberate.** There is no routing yet, so nothing
can choose for you — a default would imply a choice was made on your behalf. Failover,
cooldowns and block detection live in the gateway; this command is one provider, one
attempt, honestly labelled.

| Option | |
|---|---|
| `--render-js` | run the page's JavaScript first |
| `--premium=<tier>` | `none` \| `residential` \| `stealth` (default `none`) |
| `--country=<cc>` | ISO 3166-1 alpha-2 |
| `--timeout=<ms>` | per-attempt budget; defaults to the provider's own ceiling |
| `--body` | print the page as well as the verdict |

### `proxlane outcomes [name]`

The whole error taxonomy, as data. **This is the command written for an agent.**

Every request resolves to exactly one of 16 outcomes, and handling one correctly needs
three things that are not guessable from its name: whether it fails over, whether you are
charged, and what status the caller sees.

```bash
proxlane outcomes --json | jq '.data[] | select(.failover != false) | .outcome'
proxlane outcomes SOFT_BLOCK
```

Most outcomes **cannot be provoked on demand** — you cannot summon a `SOFT_BLOCK` — so the
table is published rather than left to be discovered by trial. It is generated from the same
`FAILOVER` table the router consults, so it cannot drift from the behaviour it documents.

### `proxlane providers`

What each adapter can actually do, read from the registry the router filters on. Includes
cost tables, timeout budgets and the env var each key is read from.

```bash
proxlane providers --json | jq '.data[] | select(.renderJs) | .id'
```

### `proxlane doctor`

Diagnoses this environment. Every check prints **what it checked**, not just pass or fail —
"Postgres: ok" is useless in an issue thread.

```bash
proxlane doctor --json    # paste this when opening an issue
```

Keys are reported by **length only**, never by value or prefix. A missing key is reported as
information, not a failure: BYOK means nobody is expected to hold every provider's key, and
a diagnostic that cries wolf stops being read.

## Keys

Set `<PROVIDER>_KEY` — `SCRAPERAPI_KEY`, `SCRAPINGBEE_KEY`, `SCRAPFLY_KEY`. Run
`proxlane providers` to see the exact variable for each.

A `.env.local` **in the current directory** is read if present, so keys need not live in
shell history. It never overrides an already-set variable, so `KEY=… proxlane …` and CI
secrets both still win. Note it is resolved against the working directory, not the install
location.

## Environment

| | |
|---|---|
| `NO_COLOR` | any value, **including empty**, disables colour ([no-color.org](https://no-color.org)) |
| `FORCE_COLOR` | colour even when stdout is not a terminal |

Colour is off by default whenever stdout is not a TTY, so piped and captured output is plain
without asking.

## Licence

AGPL-3.0-only. The adapter and SDK packages are Apache-2.0 — you can write an adapter
without inheriting copyleft.
