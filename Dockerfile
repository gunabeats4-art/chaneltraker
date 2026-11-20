FROM node:20-bookworm-slim

WORKDIR /app

# Dependensi build untuk modul native better-sqlite3 jika perlu kompilasi ulang
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/tracker.db

EXPOSE 3000

CMD ["npm", "start"]
