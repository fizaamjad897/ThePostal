# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Multi-stage build. The final image carries only production dependencies and
# compiled JavaScript — no TypeScript compiler, no test tooling, no sources.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
WORKDIR /app
ENV npm_config_update_notifier=false

# --- deps ------------------------------------------------------------------
# Manifests are copied on their own so this layer is cached until a dependency
# actually changes; editing source code does not trigger a reinstall.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# The shared package's `prepare` hook compiles it on install, which is the right
# behaviour for a developer running `npm install` but wrong here: its sources are
# not in this layer, and npm runs a workspace `prepare` even under
# `--ignore-scripts`. Stripping the hook is the only reliable way to opt out.
RUN node -e "const f='packages/shared/package.json',j=require('/app/'+f);delete j.scripts.prepare;require('fs').writeFileSync(f,JSON.stringify(j,null,2))"

RUN npm ci --workspace @postal/server --include-workspace-root --ignore-scripts

# --- build -----------------------------------------------------------------
FROM deps AS build
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN npm run build --workspace @postal/shared \
 && npm run build --workspace @postal/server

# --- runtime ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Same reason as above, and load-bearing here: this stage omits devDependencies,
# so `tsc` does not exist and the hook would fail the build outright.
RUN node -e "const f='packages/shared/package.json',j=require('/app/'+f);delete j.scripts.prepare;require('fs').writeFileSync(f,JSON.stringify(j,null,2))"

RUN npm ci --workspace @postal/server --include-workspace-root --omit=dev --ignore-scripts \
 && npm cache clean --force

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist

# The base image ships an unprivileged `node` user; running as root would give
# a container escape the run of the host filesystem for no benefit.
USER node

EXPOSE 4000 2525

# Compiled in rather than shelling out to curl, which alpine does not ship.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
