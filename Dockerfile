FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Next evaluates server modules while collecting build metadata. These inert
# values satisfy validation without copying real runtime secrets into the image.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    STORAGE_ROOT=/tmp/meeting-atlas-build \
    SESSION_SECRET=build-only-placeholder-not-a-runtime-secret \
    PROCESSING_API_URL=http://127.0.0.1:8080 \
    PROCESSING_API_CREDENTIAL=build-only-placeholder-not-a-service-secret \
    npm run build
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=6982 HOSTNAME=0.0.0.0
RUN apk add --no-cache ffmpeg postgresql17-client
COPY --from=build /app ./
EXPOSE 6982
CMD ["npm", "start"]
