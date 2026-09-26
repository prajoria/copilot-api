FROM oven/bun:1.2.19-alpine AS builder
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.2.19-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

COPY --from=builder /app/dist ./dist
COPY entrypoint.sh /usr/local/bin/copilot-api
RUN chmod +x /usr/local/bin/copilot-api \
  && mkdir -p /home/bun/.local/share/copilot-api \
  && chown -R bun:bun /app /home/bun/.local/share/copilot-api

EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:4141/ || exit 1

USER bun
ENTRYPOINT ["copilot-api"]
CMD ["start"]
