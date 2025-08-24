# syntax=docker/dockerfile:1.6

# ---- Base image ----
FROM node:20-alpine AS base
WORKDIR /app

# Install OS deps needed for node-gyp if any native modules are added
RUN apk add --no-cache python3 make g++

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---- Build (tsc) ----
FROM base AS build
WORKDIR /app
COPY package*.json ./
# Ensure dev dependencies (typescript, ts-node) are installed for build
ENV NODE_ENV=development
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY tsconfig.json ./
COPY src ./src
COPY appPackage ./appPackage
# Build TypeScript
RUN npm run build

# ---- Runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Port used by the app
EXPOSE 3978

# Copy only what we need
COPY --from=build /app/lib ./lib
COPY package*.json ./

# Install production deps only
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# By default expect env vars to be provided at runtime
# AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME, AZURE_OPENAI_API_VERSION

CMD ["npm", "run", "start"]
