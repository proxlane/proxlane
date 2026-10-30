# @proxlane/sdk

## 0.1.2

### Patch Changes

- [#451](https://github.com/proxlane/proxlane/pull/451) [`5f08871`](https://github.com/proxlane/proxlane/commit/5f08871231e51b7faccf225141a798596da94e7c) Thanks [@scarsam](https://github.com/scarsam)! - `fetch_page` passes on the gateway's own reason when it refuses a key or token, and marks a per-caller limit retryable with how long to wait.

- Updated dependencies [[`bc57b35`](https://github.com/proxlane/proxlane/commit/bc57b35e3fb11604d2b5449dbb1ce83df7d51226), [`db8d8f8`](https://github.com/proxlane/proxlane/commit/db8d8f83d65fc98fe6869cf6515a52e1db376ba8), [`c525593`](https://github.com/proxlane/proxlane/commit/c5255932b3001e60218f5ab541f174cc959697ba)]:
  - @proxlane/shared@0.16.0

## 0.1.1

### Patch Changes

- [#427](https://github.com/proxlane/proxlane/pull/427) [`58d4d6c`](https://github.com/proxlane/proxlane/commit/58d4d6cf0981c6edb85e77a1f5b19a0c82a5ae74) Thanks [@scarsam](https://github.com/scarsam)! - The MCP server is listed in the official MCP registry as `io.github.proxlane/proxlane`, and a refused key now says which key to set.

## 0.1.0

### Minor Changes

- [#418](https://github.com/proxlane/proxlane/pull/418) [`dfddebf`](https://github.com/proxlane/proxlane/commit/dfddebf39e43c9b2cd9430953e2f64ab5be39a8f) Thanks [@scarsam](https://github.com/scarsam)! - `@proxlane/sdk` is now an MCP server: `npx -y @proxlane/sdk` gives an agent a `fetch_page` tool through your own gateway, returning the page as text or a failure that says whether to retry, never a block page as content.

- [#416](https://github.com/proxlane/proxlane/pull/416) [`7ada88c`](https://github.com/proxlane/proxlane/commit/7ada88c95c2e72f08d9fe766a9c35263d6d9bd5e) Thanks [@scarsam](https://github.com/scarsam)! - `@proxlane/sdk` exports `htmlToText` and `titleOf`, which turn a fetched page into readable text for an agent.

### Patch Changes

- [#422](https://github.com/proxlane/proxlane/pull/422) [`a8c280c`](https://github.com/proxlane/proxlane/commit/a8c280c3cf1c305f77fcaf34dd775245ceb09742) Thanks [@scarsam](https://github.com/scarsam)! - Requires zod 4.6.6 or later, which fixes GHSA-mrhx-c7xc-m3w5.

## 0.0.2

### Patch Changes

- [#186](https://github.com/proxlane/proxlane/pull/186) [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c) Thanks [@scarsam](https://github.com/scarsam)! - Every published package now has a description, keywords, a homepage and a README. Four of the five
  rendered "ERROR: No README data found!" on npmjs.com — including `@proxlane/adapters`, the
  Apache-2.0 package this project most wants strangers to contribute to.
