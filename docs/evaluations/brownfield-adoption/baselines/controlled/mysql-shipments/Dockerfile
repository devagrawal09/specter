FROM node:22.19.0-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM build AS verify
COPY vitest.config.ts ./
COPY tests ./tests
CMD ["pnpm", "test"]

FROM node:22.19.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
