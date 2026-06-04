FROM node:20-bookworm-slim

# better-sqlite3 ships prebuilt binaries for glibc/linux-x64; build tools are
# kept as a fallback in case a prebuilt binary is unavailable for the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# SQLite database lives here; mount a volume to persist accounts.
ENV DB_PATH=/data/antiyoy.db
VOLUME ["/data"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
