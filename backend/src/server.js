'use strict';
require('dotenv').config();
const app    = require('./app');
const logger = require('./utils/logger');
const { getDB } = require('./config/database');

const PORT = parseInt(process.env.PORT || '4000', 10);

// Initialize DB — warn on failure but don't crash
// (healthcheck will confirm the server is up first)
try {
  getDB();
  logger.info('Database initialized (SQLite at /app/dev.db)');
} catch (e) {
  logger.warn('Database init warning: ' + e.message + ' — will retry on first request');
}

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('RH Survey API running on port ' + PORT);
  logger.info('Health: http://0.0.0.0:' + PORT + '/health');
  logger.info('LGPD compliant | Helmet + Rate Limiting active');
});

process.on('SIGTERM', () => {
  server.close(() => { logger.info('Server closed'); process.exit(0); });
});
process.on('SIGINT', () => {
  server.close(() => { logger.info('Server closed'); process.exit(0); });
});

module.exports = server;
