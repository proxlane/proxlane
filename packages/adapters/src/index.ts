export * from './contract.js';
export { REGISTRY } from './registry.js';

// DEV_REGISTRY is deliberately NOT re-exported here.
//
// This package publishes to npm under Apache-2.0, and `files: ["dist"]` ships whatever the
// main entry pulls in. Exporting it from this file put `r.jina.ai` into the published
// bundle and `DEV_REGISTRY` into the public .d.mts — a test adapter downloaded by every
// consumer, and the third time this same leak reopened through a door the previous fix did
// not watch (first REGISTRY, then the fixture path, then the build output).
//
// So it builds to `dev-dist/` instead, which `files` cannot reach. Publication is now
// impossible rather than merely asserted against. `scripts/record.ts` loads it from there
// by path; nothing else should. Assertion 16 checks all three doors.
