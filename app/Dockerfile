# Thoth app — multi-stage, standalone Next.js server, non-root.
FROM node:25-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:25-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Empty = same-origin: the browser calls /api/* on this host and Next proxies
# to the backend (one origin, one tunnel, auth in front of both).
ARG NEXT_PUBLIC_THOTH_API=""
ENV NEXT_PUBLIC_THOTH_API=$NEXT_PUBLIC_THOTH_API
# Rewrites are compiled into the build manifest, so the backend's in-network
# address must be known at build time (compose passes http://api:4000).
ARG THOTH_API_INTERNAL="http://localhost:4000"
ENV THOTH_API_INTERNAL=$THOTH_API_INTERNAL
RUN npm run build

FROM node:25-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# public/ holds the self-hosted maplibre worker (copied at prebuild); without
# it the map never loads.
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
