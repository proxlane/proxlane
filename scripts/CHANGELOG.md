# @proxlane/scripts

## 0.0.3

### Patch Changes

- Updated dependencies [d299128]
  - @proxlane/adapters@0.3.0

## 0.0.2

### Patch Changes

- Updated dependencies [9e705a6]
- Updated dependencies [baa3c0f]
  - @proxlane/adapters@0.2.0

## 0.0.1

### Patch Changes

- 222a896: `proxlane doctor` now diagnoses routing state: where it lives, whether an empty `PROXLANE_VALKEY_URL` is being read as unset, whether the replica count matches the state backing, which of health and cooldowns are on, and whether a configured Valkey is actually reachable.
- 0ba6c8d: The release workflow now proves the npm credential before versioning anything, so an expired token fails with an actionable message instead of after the release PR has merged.
- a22b520: Add the release workflow, which never existed: changesets publish with npm provenance, a GitHub Release, and multi-arch ghcr images. `repo:check` assertion 22 now fails when the ownership table names a file that does not exist, which is how this went unnoticed.
- b5492f5: The release credential check no longer prints an npm warning where the username should go.
- Updated dependencies [a611e21]
- Updated dependencies [023530d]
- Updated dependencies [1dc6bc8]
- Updated dependencies [6df863c]
- Updated dependencies [0e81564]
  - @proxlane/adapters@0.1.0
