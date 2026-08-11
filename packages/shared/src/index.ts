// @proxlane/shared — the base layer. Depends on nothing internal, by rule: see CLAUDE.md's
// package layering, repo:check assertion 20, and the biome override on this package.
export const PACKAGE_NAME = '@proxlane/shared';
export * from './edge-guard.js';
export * from './health.js';
export * from './outcome.js';
