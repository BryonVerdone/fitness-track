FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/fitness.db

EXPOSE 3000

CMD ["node", "src/server.js"]
