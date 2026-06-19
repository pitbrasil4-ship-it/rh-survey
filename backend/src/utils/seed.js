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

  // Admin user
  const hash = await bcrypt.hash('Admin@2025!', 12);
  db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, name, email, password_hash, role) VALUES (?,?,?,?,?,'admin')").run(userId, tenantId, 'Admin RH', 'admin@empresa.com', hash);

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
  logger.info(`   📧 Login: admin@empresa.com`);
  logger.info(`   🔑 Senha: Admin@2025!`);
  logger.info(`   🔗 Survey público: /api/v1/public/survey/${token}`);
}

seed().catch(e => { logger.error('Seed error', { error: e.message }); process.exit(1); });
