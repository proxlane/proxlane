# The self-host image. `docker compose -f docker/compose.yml up`
#
# Node is pinned to the digit-for-digit version in .nvmrc, and repo:check asserts they
# match — a Dockerfile on Node 22 while the repo targets 24 is a drift that only shows up
# as a syntax error in production.

# ---------------------------------------------------------------- build
FROM node:24.19.0-alpine AS build
RUN corepack enable
WORKDIR /app

# The whole workspace, then one install. Copying per-package manifests first would cache
# better, but it means a list of COPY lines that silently rots every time a package is
# added — and a wrong image is more expensive than a slow build.
COPY . .
RUN pnpm install --frozen-lockfile
# TURBO's filter, not pnpm's. `pnpm --filter @proxlane/gateway` builds only the gateway,
# and `...@proxlane/gateway` selected only the gateway here too — verified in the container.
# Either way the image builds fine and then dies at RUNTIME on a missing
# @proxlane/adapters/dist, which is the worst place to discover it. Turbo walks the
# dependency graph, which is why it is the repo's build orchestrator in the first place.
RUN pnpm exec turbo run build --filter=@proxlane/gateway

# `pnpm deploy` resolves the workspace links into a real node_modules tree, which is the
# only way a workspace app runs outside the workspace. --prod drops devDependencies.
RUN pnpm --filter @proxlane/gateway deploy --prod --legacy /out

# ---------------------------------------------------------------- runtime
FROM node:24.19.0-alpine AS runtime
WORKDIR /app

# Not root. The gateway fetches URLs a stranger chose; if anything ever goes wrong in that
# path, it should go wrong as a user who owns nothing.
RUN addgroup -S proxlane && adduser -S proxlane -G proxlane
COPY --from=build --chown=proxlane:proxlane /out/node_modules ./node_modules
COPY --from=build --chown=proxlane:proxlane /out/dist ./dist
COPY --from=build --chown=proxlane:proxlane /out/package.json ./package.json
USER proxlane

ENV NODE_ENV=production
EXPOSE 8787

# No shell form: exec form makes PID 1 the node process, so SIGTERM reaches it and
# `docker compose down` is a clean stop rather than a ten-second kill.
CMD ["node", "dist/index.mjs"]
