# proxlane

## 0.1.2

### Patch Changes

- Updated dependencies [d299128]
  - @proxlane/adapters@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [9e705a6]
- Updated dependencies [baa3c0f]
  - @proxlane/adapters@0.2.0

## 0.1.0

### Minor Changes

- 222a896: `proxlane doctor` now diagnoses routing state: where it lives, whether an empty `PROXLANE_VALKEY_URL` is being read as unset, whether the replica count matches the state backing, which of health and cooldowns are on, and whether a configured Valkey is actually reachable.

### Patch Changes

- 1dc6bc8: `proxlane --version` now reports the package's real version. It was hardcoded to `0.0.0` and printed that from a package published as `0.0.1`.
- 6df863c: A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.
- Updated dependencies [a611e21]
- Updated dependencies [023530d]
- Updated dependencies [1dc6bc8]
- Updated dependencies [6df863c]
- Updated dependencies [0e81564]
  - @proxlane/adapters@0.1.0
