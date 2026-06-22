'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// In Docker: /app/dev.db  |  local dev: fallback to project root
const DB_PATH = process.env.SQLITE_PATH || '/app/dev.db';

let db;

function getDB() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA foreign_keys=ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free', active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'viewer', two_fa_secret TEXT,
      two_fa_enabled INTEGER DEFAULT 0, last_login TEXT,
      active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY, user_id TEXT, token TEXT UNIQUE,
      expires_at TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY, tenant_id TEXT, created_by_id TEXT,
      name TEXT NOT NULL, description TEXT, category TEXT,
      target_group TEXT, status TEXT DEFAULT 'rascunho',
      anonymous INTEGER DEFAULT 1, deadline TEXT,
      lgpd_basis TEXT DEFAULT 'consentimento',
      public_token TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')), published_at TEXT,
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, survey_id TEXT, order_num INTEGER,
      type TEXT NOT NULL, text TEXT NOT NULL, options TEXT,
      required INTEGER DEFAULT 1,
      FOREIGN KEY(survey_id) REFERENCES surveys(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS respondents (
      id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL,
      email TEXT, group_type TEXT, department TEXT, role TEXT,
      consent_given INTEGER DEFAULT 0, consent_date TEXT,
      consent_channel TEXT, data_retention_until TEXT,
      anonymized INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY, survey_id TEXT, respondent_id TEXT,
      anonymous_token TEXT UNIQUE, started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT, ip_hash TEXT,
      FOREIGN KEY(survey_id) REFERENCES surveys(id),
      FOREIGN KEY(respondent_id) REFERENCES respondents(id)
    );
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY, response_id TEXT, question_id TEXT,
      value_text TEXT, value_num REAL, value_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(response_id) REFERENCES responses(id) ON DELETE CASCADE,
      FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS lgpd_consents (
      id TEXT PRIMARY KEY, respondent_id TEXT, survey_id TEXT,
      action TEXT NOT NULL, ip_hash TEXT, channel TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(respondent_id) REFERENCES respondents(id)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT,
      action TEXT NOT NULL, resource TEXT, resource_id TEXT,
      ip_hash TEXT, meta TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, survey_id TEXT, name TEXT, channel TEXT,
      status TEXT DEFAULT 'rascunho', scheduled_at TEXT, sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(survey_id) REFERENCES surveys(id)
    );
    CREATE TABLE IF NOT EXISTS eval_cycles (
      id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL,
      survey_id TEXT, status TEXT DEFAULT 'ativo',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY(survey_id) REFERENCES surveys(id)
    );
    CREATE TABLE IF NOT EXISTS eval_assignments (
      id TEXT PRIMARY KEY, cycle_id TEXT, subject_id TEXT,
      relationship TEXT, evaluator_name TEXT, evaluator_email TEXT,
      token TEXT UNIQUE, completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(cycle_id) REFERENCES eval_cycles(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES respondents(id)
    );
  `);
  // Migração idempotente: colunas de 360° na tabela responses (para bancos já existentes).
  try { db.exec("ALTER TABLE responses ADD COLUMN subject_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN relationship TEXT"); } catch (e) {}
}

module.exports = { getDB };
