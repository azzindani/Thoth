# Thoth backend — multi-stage, non-root, reproducible (npm ci from committed lockfile).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json biome.json ./
COPY src ./src
COPY test ./test
RUN npm run typecheck && npm run lint && npx tsc -p tsconfig.json

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY static ./static
COPY public ./public
RUN addgroup -S thoth && adduser -S thoth -G thoth && chown -R thoth:thoth /app
USER thoth
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>{if(!r.ok)process.exit(1)})"
CMD ["node", "dist/api/server.js"]
