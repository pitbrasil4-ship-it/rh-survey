FROM node:22-alpine AS base
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src/ ./src/

FROM node:22-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001
USER nodeuser

COPY --from=base --chown=nodeuser:nodejs /app ./

EXPOSE 4000

CMD ["node", "src/server.js"]
