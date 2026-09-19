FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
# Empty default = same-origin via the /api rewrite proxy (one tunnel/host serves all).
ARG NEXT_PUBLIC_THOTH_API=""
ENV NEXT_PUBLIC_THOTH_API=$NEXT_PUBLIC_THOTH_API
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
USER node
CMD ["npx", "next", "start", "-p", "3000"]
