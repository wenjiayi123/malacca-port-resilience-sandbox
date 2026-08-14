FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 STATIC_DIR=/app/dist RL_ARTIFACT_DIR=/app/runtime/rl-jobs PORT_OPERATION_AUDIT_FILE=/app/runtime/operations/audit-chain.jsonl
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/runtime/rl-jobs && chown -R node:node /app
USER node
EXPOSE 4173
VOLUME ["/app/runtime"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:4173/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--experimental-strip-types", "--experimental-specifier-resolution=node", "server/productionServer.ts"]
