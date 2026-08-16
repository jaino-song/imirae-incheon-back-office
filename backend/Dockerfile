FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
# The backend consumes this vendored package through a file: dependency. Copy
# its declarations and runtime files before pnpm resolves the dependency.
COPY backend/vendor/shared-agent backend/vendor/shared-agent

RUN pnpm install --frozen-lockfile --filter ./backend...

COPY backend backend

RUN pnpm --filter ./backend build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV="production"
ENV NODE_PATH="/app/backend/dist"
ENV PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/vendor/shared-agent ./backend/vendor/shared-agent

RUN node backend/node_modules/playwright-core/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /app /ms-playwright

USER node
WORKDIR /app/backend

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/main.js"]
