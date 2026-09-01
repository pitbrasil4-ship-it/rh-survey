'use strict';
require('dotenv').config();
const app    = require('./app');
const logger = require('./utils/logger');
const { getDB } = require('./config/database');

const PORT = parseInt(process.env.PORT || '4000', 10);

// Roda o seed automaticamente APENAS se o banco estiver vazio.
// Isso garante que os administradores existam após cada deploy (o banco
// do Railway é recriado do zero), sem duplicar dados caso haja volume persistente.
async function ensureSeed() {
  try {
    const db = getDB();
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
    if (c === 0) {
      logger.info('Banco vazio — executando seed inicial...');
      const { seed } = require('./utils/seed');
      await seed();
      logger.info('Seed inicial concluído (administradores garantidos).');
    } else {
      logger.info(`Banco já populado (${c} usuário(s)) — seed ignorado.`);
    }
  } catch (e) {
    logger.warn('ensureSeed falhou (servidor seguirá normalmente): ' + e.message);
  }
}

async function start() {
  try {
    getDB();
    logger.info('Database initialized (SQLite)');
  } catch (e) {
    logger.warn('Database init warning: ' + e.message + ' — will retry on first request');
  }

  await ensureSeed();

  // Lembretes agendados: verifica a cada minuto se algum venceu e dispara para
  // quem ainda não respondeu. Leve o bastante para rodar no próprio processo.
  const { runDueReminders } = require('./controllers/invitations.controller');
  const reminderTimer = setInterval(() => {
    runDueReminders().catch(e => logger.warn('Falha ao processar lembretes agendados: ' + e.message));
  }, 60000);
  reminderTimer.unref();

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('RH Survey API running on port ' + PORT);
    logger.info('Health: http://0.0.0.0:' + PORT + '/health');
    logger.info('LGPD compliant | Helmet + Rate Limiting active');
  });

  process.on('SIGTERM', () => { clearInterval(reminderTimer); server.close(() => { logger.info('Server closed'); process.exit(0); }); });
  process.on('SIGINT',  () => { clearInterval(reminderTimer); server.close(() => { logger.info('Server closed'); process.exit(0); }); });
}

start();

module.exports = app;
