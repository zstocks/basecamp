# --- build stage: compile native deps (better-sqlite3 against musl) ---
FROM node:22-alpine AS build
WORKDIR /app
# Alpine has no prebuilt better-sqlite3 binary — build it from source.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage: no toolchain, just node + the compiled modules ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY . .
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
# Secrets come from the environment (compose env_file), never baked into the image.
CMD ["node", "server.js"]
