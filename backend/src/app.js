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
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({ success: false, message: 'Erro interno do servidor' });
});

module.exports = app;
