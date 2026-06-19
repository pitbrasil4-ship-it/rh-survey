# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# Instala dependências primeiro (cache de camadas)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia código-fonte
COPY src/ ./src/
COPY .env.example ./.env.example

# ─── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Usuário não-root por segurança
RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001
USER nodeuser

COPY --from=base --chown=nodeuser:nodejs /app ./

# Porta padrão
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
