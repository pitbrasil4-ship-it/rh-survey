'use strict';
require('dotenv').config();
const app    = require('./app');
const logger = require('./utils/logger');
const { getDB } = require('./config/database');

const PORT = parseInt(process.env.PORT || '4000', 10);

// Initialize DB on startup
try {
  getDB();
  logger.info('✅ Banco de dados inicializado (SQLite)');
} catch (e) {
  logger.error('❌ Falha ao inicializar banco', { error: e.message });
  process.exit(1);
}

const server = app.listen(PORT, () => {
  logger.info(`🚀 RH Survey API rodando em http://localhost:${PORT}`);
  logger.info(`📋 Health check: http://localhost:${PORT}/health`);
  logger.info(`🔐 Segurança: Helmet + Rate Limiting + CORS ativos`);
  logger.info(`🛡️  LGPD: Conformidade ativa (${process.env.NODE_ENV || 'development'})`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM recebido — encerrando servidor...');
  server.close(() => { logger.info('Servidor encerrado'); process.exit(0); });
});
process.on('SIGINT', () => {
  logger.info('SIGINT recebido — encerrando servidor...');
  server.close(() => { logger.info('Servidor encerrado'); process.exit(0); });
});

module.exports = server;
