'use strict';
require('dotenv').config();
const bcrypt     = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { getDB }  = require('../config/database');
const logger     = require('./logger');

async function seed() {
  const db = getDB();
  logger.info('🌱 Iniciando seed...');

  const tenantId = uuid();
  const userId   = uuid();
  const surveyId = uuid();
  const token    = uuid();

  // Tenant
  db.prepare("INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (?,?,?)").run(tenantId, 'Empresa Demo', 'empresa-demo');

  // Admin user (bootstrap demo)
  const hash = await bcrypt.hash('Admin@2025!', 12);
  db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role) VALUES (?,?,?,?,?,'admin')").run(userId, tenantId, 'Admin RH', 'admin@empresa.com', hash);

  // ── Administradores RGIS Brasil ──────────────────────────────────────────────
  // Senha inicial vem da variável de ambiente SEED_ADMIN_PASSWORD (defina no Railway).
  // O fallback abaixo é só para não travar — troque-o configurando a variável.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'RgisAdmin@2025!';
  const adminHash     = await bcrypt.hash(adminPassword, 12);
  const rgisAdmins = [
    { name: 'Gerci Scussel', email: 'gscussel@rgis.com'   },
    { name: 'Léia Santana',  email: 'lsantana01@rgis.com' },
    { name: 'André Andrade', email: 'aandrade@rgis.com'   },
  ];
  rgisAdmins.forEach(a => {
    db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role) VALUES (?,?,?,?,?,'admin')")
      .run(uuid(), tenantId, a.name, a.email, adminHash);
  });

  // Demo survey
  db.prepare("INSERT OR IGNORE INTO surveys (id, tenant_id, created_by_id, name, category, target_group, status, public_token) VALUES (?,?,?,?,?,?,?,?)").run(surveyId, tenantId, userId, 'Avaliação de Gestores Q2 2025', '360°', 'gestores', 'ativo', token);

  // Demo questions
  const questions = [
    { type:'nps',   text:'De 0 a 10, qual a probabilidade de você recomendar este gestor a um colega?' },
    { type:'scale', text:'Como você avalia a capacidade de comunicação deste gestor?', options:['Muito ruim','Ruim','Regular','Bom','Excelente'] },
    { type:'rating',text:'Avalie a liderança e motivação da equipe por este gestor.' },
    { type:'text',  text:'Descreva uma situação em que este gestor demonstrou liderança exemplar.' },
    { type:'yesno', text:'Você se sente apoiado e ouvido por este gestor?' },
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO questions (id, survey_id, order_num, type, text, options) VALUES (?,?,?,?,?,?)');
  questions.forEach((q, i) => stmt.run(uuid(), surveyId, i+1, q.type, q.text, q.options ? JSON.stringify(q.options) : null));

  // Demo respondent with consent
  const rId = uuid();
  db.prepare("INSERT OR IGNORE INTO respondents (id, tenant_id, name, email, group_type, department, consent_given, consent_date) VALUES (?,?,?,?,?,?,1,datetime('now'))").run(rId, tenantId, 'Carlos Silva', 'carlos@empresa.com', 'gestores', 'Vendas');

  logger.info('✅ Seed concluído!');
  logger.info(`   📧 Admin demo: admin@empresa.com / Admin@2025!`);
  logger.info(`   👤 Admins RGIS: gscussel@rgis.com, lsantana01@rgis.com, aandrade@rgis.com`);
  logger.info(`   🔑 Senha inicial dos admins RGIS: ${adminPassword}${process.env.SEED_ADMIN_PASSWORD ? ' (de SEED_ADMIN_PASSWORD)' : ' (fallback — configure SEED_ADMIN_PASSWORD!)'}`);
  logger.info(`   🔗 Survey público: /api/v1/public/survey/${token}`);
}

module.exports = { seed };

// Executa diretamente apenas quando chamado via `node src/utils/seed.js`
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(e => { logger.error('Seed error', { error: e.message }); process.exit(1); });
}
