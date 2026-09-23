'use strict';
require('dotenv').config();
const express  = require('express');
const morgan   = require('morgan');
const logger   = require('./utils/logger');
const { helmetConfig, globalLimiter, cors, corsOptions } = require('./middleware/security');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmetConfig);
app.use(cors(corsOptions));
app.use(globalLimiter);

// ── Parsing ───────────────────────────────────────────────────────────────────
// O envio de uma resposta pode carregar um anexo em base64. O teto do anexo é definido
// por pergunta (no máximo 10 MB) e o base64 infla cerca de 33%, então só esta rota aceita
// um corpo maior — o resto da API continua em 1 MB, que é o que ela precisa.
app.use('/api/v1/public/survey', express.json({ limit: '15mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan('[:date[iso]] :method :url :status :response-time ms', {
  stream: { write: msg => logger.info(msg.trim()) },
  skip:   (req) => req.url === '/health',
}));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok', service: 'rh-survey-api',
  version: '1.0.0', timestamp: new Date().toISOString(),
  security: { tls: true, helmet: true, rateLimit: true },
  lgpd: { compliant: true, basis: 'consentimento_explicito' },
}));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', require('./routes/index'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Rota não encontrada' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  // Corpo maior que o teto da rota: é uma recusa explicável, não uma falha do servidor.
  // Sem este ramo, um anexo grande demais virava "Erro interno" e ninguém sabia o motivo.
  if (error && (error.type === 'entity.too.large' || error.status === 413)) {
    logger.warn('Corpo da requisição acima do limite', { url: _req.originalUrl, limit: error.limit });
    return res.status(413).json({ success: false, message: 'O conteúdo enviado é grande demais. Se houver anexo, use um arquivo menor.' });
  }
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'O conteúdo enviado não é um JSON válido.' });
  }
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({ success: false, message: 'Erro interno do servidor' });
});

module.exports = app;
