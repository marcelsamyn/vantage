FROM oven/bun:1.4.0 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.0 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4747 VANTAGE_LOCAL=0
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock bunfig.toml ./
COPY --chown=bun:bun app ./app
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun shared ./shared
COPY --chown=bun:bun scripts ./scripts
COPY --chown=bun:bun plugins ./plugins
RUN mkdir -p .cache .data dist && chown bun:bun /app .cache .data dist
USER bun
RUN bun scripts/registry.ts && bun scripts/manifest.ts
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:4747/healthz"); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "server/index.ts"]
