FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
