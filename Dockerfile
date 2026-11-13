# MORPHIS: the whole town in one container (simulation server + REST API +
# WebSocket + the built web client). Point DATABASE_URL at PostgreSQL to keep
# saves across restarts; without it, saves go to files in /data.
#
#   docker build -t morphis .
#   docker run -p 8787:8787 -e AI_API_KEY=... morphis
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sim/package.json packages/sim/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npx -y npm@11 ci --no-audit --no-fund
COPY . .
RUN npm run build --workspace @morphis/web && npx prisma generate --schema apps/server/prisma/schema.prisma

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data WEB_DIST=/app/apps/web/dist
COPY --from=build /app /app
RUN mkdir -p /data
VOLUME /data
EXPOSE 8787
WORKDIR /app/apps/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npx prisma db push --skip-generate; fi; exec ../../node_modules/.bin/tsx src/main.ts"]
