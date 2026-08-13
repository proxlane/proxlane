// `@proxlane/ui` — Base UI wrapped once, plus the token layer.
//
// `design.md`: application code imports only from here. That wrapper IS the design system, and
// it keeps a future primitive swap to one package. Explicitly not shadcn — same primitives, one
// layer lower, because a shared starting point is why a thousand sites share a silhouette.
//
// The tokens are CSS, imported by the consuming app:
//
//   import '@proxlane/ui/theme.css';
//
// They are not re-exported from this module, because a `.css` import from a `.ts` barrel would
// force every consumer through a bundler that understands it.
export const PACKAGE_NAME = '@proxlane/ui';
