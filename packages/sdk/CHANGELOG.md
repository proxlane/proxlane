# @proxlane/sdk

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
