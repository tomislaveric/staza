FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build


FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    ffmpeg \
    osmium-tool \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data/jobs \
    MAX_UPLOAD_BYTES=6442450944 \
    JOB_TTL_MS=1800000 \
    SELECTION_TTL_MS=1800000 \
    MAX_SELECTED_COINS=20 \
    MAX_OUTPUT_DURATION_SECONDS=120 \
    PROCESS_TIMEOUT_MS=900000

COPY package*.json ./

RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts

COPY public ./public
COPY fixtures ./fixtures

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "dist/server.js"]
