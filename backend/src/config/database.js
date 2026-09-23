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
  // Migração idempotente: texto das perguntas em outros idiomas (EN/ES).
  try { db.exec("ALTER TABLE questions ADD COLUMN text_en TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN text_es TEXT"); } catch (e) {}
  // Migração idempotente: opções de resposta traduzidas (EN/ES).
  try { db.exec("ALTER TABLE questions ADD COLUMN options_en TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE questions ADD COLUMN options_es TEXT"); } catch (e) {}
  // Migração idempotente: título e descrição da pesquisa traduzidos (EN/ES).
  try { db.exec("ALTER TABLE surveys ADD COLUMN name_en TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE surveys ADD COLUMN name_es TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE surveys ADD COLUMN description_en TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE surveys ADD COLUMN description_es TEXT"); } catch (e) {}
  // Assinaturas de notificações Web Push (PWA).
  try { db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    user_id TEXT,
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  // Estrutura organizacional: regionais, distritos (cada um numa regional) e departamentos. Com meta de respondentes.
  try { db.exec(`CREATE TABLE IF NOT EXISTS regionais (
    id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS distritos (
    id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, regional_id TEXT, meta INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS departamentos (
    id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, meta INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  // Segmentação: marca cada resposta com distrito/departamento, e links públicos por segmento.
  try { db.exec("ALTER TABLE responses ADD COLUMN distrito_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN departamento_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0"); } catch (e) {}
  // Quem nunca acessou ainda está com a senha provisória -> força a troca no 1º acesso.
  try { db.exec("UPDATE users SET must_change_password = 1 WHERE last_login IS NULL AND must_change_password = 0"); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN weight REAL DEFAULT 1"); } catch (e) {}
  // Pontuação por opção: % de pontos de cada alternativa (alinhado por índice com options). Usado em clima/subordinados.
  try { db.exec("ALTER TABLE questions ADD COLUMN option_points TEXT"); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS survey_links (
    id TEXT PRIMARY KEY, tenant_id TEXT, survey_id TEXT, token TEXT UNIQUE,
    distrito_id TEXT, departamento_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}

  // ── Editor de perguntas: configuração por tipo, lógica condicional e taxonomias ──
  // config: JSON por tipo de pergunta (matriz, lista suspensa, bloco de formulário,
  // opção neutra, opção "Outros", nº de pontos da Likert). Ver utils/questions.js.
  try { db.exec("ALTER TABLE questions ADD COLUMN config TEXT"); } catch (e) {}
  // logic: JSON { showIf: { questionId, options:[] }, endIf: { options:[] } }
  try { db.exec("ALTER TABLE questions ADD COLUMN logic TEXT"); } catch (e) {}
  // Identificador externo da pergunta (coluna ID da planilha de importação).
  try { db.exec("ALTER TABLE questions ADD COLUMN external_id TEXT"); } catch (e) {}

  // ── Conjuntos de dimensões (taxonomias) e vínculo N:N com as perguntas ──
  try { db.exec(`CREATE TABLE IF NOT EXISTS dimension_sets (
    id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS dimensions (
    id TEXT PRIMARY KEY, tenant_id TEXT, set_id TEXT, name TEXT NOT NULL,
    description TEXT, order_num INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS question_dimensions (
    question_id TEXT, dimension_id TEXT,
    PRIMARY KEY (question_id, dimension_id)
  )`); } catch (e) {}

  // ── Campanhas (instrumento x período) e aplicações (campanha x distrito) ──
  try { db.exec(`CREATE TABLE IF NOT EXISTS survey_campaigns (
    id TEXT PRIMARY KEY, tenant_id TEXT, survey_id TEXT, name TEXT NOT NULL,
    starts_at TEXT, ends_at TEXT, status TEXT DEFAULT 'planejada',
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS campaign_applications (
    id TEXT PRIMARY KEY, campaign_id TEXT, distrito_id TEXT, meta INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN campaign_id TEXT"); } catch (e) {}

  // ── Convites individuais: envio pelo servidor, rastreio e lembretes ──
  try { db.exec(`CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY, tenant_id TEXT, survey_id TEXT, campaign_id TEXT,
    respondent_id TEXT, name TEXT, email TEXT, token TEXT UNIQUE,
    distrito_id TEXT, departamento_id TEXT,
    status TEXT DEFAULT 'pendente', sent_at TEXT, opened_at TEXT, responded_at TEXT,
    reminders_sent INTEGER DEFAULT 0, last_reminder_at TEXT, last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS reminder_schedules (
    id TEXT PRIMARY KEY, tenant_id TEXT, survey_id TEXT, run_at TEXT,
    sent_at TEXT, sent_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN invitation_id TEXT"); } catch (e) {}

  // ── Escopo do usuário (Gestor vê apenas o próprio distrito/regional) ──
  try { db.exec("ALTER TABLE users ADD COLUMN regional_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN distrito_id TEXT"); } catch (e) {}
  // JSON com as categorias de pesquisa cujos resultados ficam ocultos para o usuário.
  try { db.exec("ALTER TABLE users ADD COLUMN blocked_categories TEXT"); } catch (e) {}

  // ── Controle de duplicidade e limite de respostas ──
  try { db.exec("ALTER TABLE surveys ADD COLUMN one_per_device INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec("ALTER TABLE surveys ADD COLUMN max_responses INTEGER"); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN device_id TEXT"); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_responses_device ON responses(survey_id, device_id)"); } catch (e) {}
  // Distrito do respondente (liga o cadastro de Respondentes à Estrutura).
  try { db.exec("ALTER TABLE respondents ADD COLUMN distrito_id TEXT"); } catch (e) {}

  // ── Vínculo pergunta↔dimensão COM VIGÊNCIA ──
  // A classificação muda a cada ciclo. Guardar a vigência é o que permite reclassificar
  // de forma prospectiva sem reescrever a série histórica já apurada: cada resposta é
  // lida com a classificação que valia no dia em que ela foi enviada.
  try { db.exec(`CREATE TABLE IF NOT EXISTS question_dimension_links (
    id TEXT PRIMARY KEY, question_id TEXT, dimension_id TEXT,
    effective_from TEXT,   -- NULL = desde sempre (reclassificação retroativa)
    effective_to TEXT,     -- NULL = vigente
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_qdl_question ON question_dimension_links(question_id)"); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_qdl_dimension ON question_dimension_links(dimension_id)"); } catch (e) {}
  // Migra os vínculos sem vigência da tabela antiga e a descarta.
  try {
    db.exec(`INSERT INTO question_dimension_links (id, question_id, dimension_id)
             SELECT lower(hex(randomblob(16))), qd.question_id, qd.dimension_id
             FROM question_dimensions qd
             WHERE NOT EXISTS (SELECT 1 FROM question_dimension_links l
                               WHERE l.question_id = qd.question_id AND l.dimension_id = qd.dimension_id)`);
    db.exec("DROP TABLE question_dimensions");
  } catch (e) {}

  // Conjunto de dimensões: código estável ('clima', 'hse') para o editor montar um
  // campo por taxonomia, e ordem de exibição.
  try { db.exec("ALTER TABLE dimension_sets ADD COLUMN code TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE dimension_sets ADD COLUMN order_num INTEGER DEFAULT 0"); } catch (e) {}

  // Observação da pergunta (coluna livre da planilha de importação).
  try { db.exec("ALTER TABLE questions ADD COLUMN notes TEXT"); } catch (e) {}

  // ── Histórico de alterações: quem, quando, o quê ──
  try { db.exec(`CREATE TABLE IF NOT EXISTS question_history (
    id TEXT PRIMARY KEY, tenant_id TEXT, survey_id TEXT, question_id TEXT,
    user_id TEXT, user_name TEXT, action TEXT, field TEXT,
    before_value TEXT, after_value TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_qhist_survey ON question_history(survey_id, created_at)"); } catch (e) {}

  // ── Versionamento: cada publicação vira uma versão numerada e datada ──
  try { db.exec(`CREATE TABLE IF NOT EXISTS survey_versions (
    id TEXT PRIMARY KEY, survey_id TEXT, number INTEGER, published_at TEXT,
    snapshot TEXT, created_by_id TEXT, note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`); } catch (e) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sver_survey ON survey_versions(survey_id, number)"); } catch (e) {}
  // A resposta fica presa à versão que estava no ar quando ela foi enviada.
  try { db.exec("ALTER TABLE responses ADD COLUMN version_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE responses ADD COLUMN version_number INTEGER"); } catch (e) {}
}

module.exports = { getDB };
