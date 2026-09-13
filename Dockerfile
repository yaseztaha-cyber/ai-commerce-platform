# syntax=docker/dockerfile:1
# Production image for the AI commerce platform.
# - Default CMD serves the Next.js web app (`next start`, port 3000).
# - Compose can override CMD to run the queue worker (`npm run worker --workspace=apps/web`)
#   or migrations (`npm run db:deploy --workspace=packages/database`).

FROM node:20-bookworm-slim AS deps
WORKDIR /app

# npm 11 honors the allowScripts trust list in package.json (prisma/esbuild scripts).
RUN npm install -g npm@11

# Install dependencies for the whole monorepo (hoisted) before copying source
# so package-lock.json changes alone re-trigger layers incrementally.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# --- build ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY apps ./apps
COPY packages ./packages

ENV NEXT_TELEMETRY_DISABLED=1
# Generate the Prisma client from the committed schema; no DB connection needed.
RUN npm run db:generate
RUN npm run build

# --- runtime ---
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app /app

EXPOSE 3000
USER nextjs

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "run", "start"]