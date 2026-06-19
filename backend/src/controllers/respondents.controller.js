'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');
const logger       = require('../utils/logger');

/* GET /respondents */
function list(req, res) {
  try {
    const { group, search } = req.query;
    const db   = getDB();
    let sql    = 'SELECT id, name, email, group_type, department, role, consent_given, anonymized, created_at FROM respondents WHERE tenant_id = ? AND anonymized = 0';
    const args = [req.user.tenant_id];
    if (group)  { sql += ' AND group_type = ?'; args.push(group); }
    if (search) { sql += ' AND (name LIKE ? OR email LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...args);
    return ok(res, { respondents: rows, total: rows.length });
  } catch (e) { return err(res, 'Erro ao listar respondentes', 500, e.message); }
}

/* POST /respondents */
function create(req, res) {
  try {
    const { name, email, groupType, department, role } = req.body;
    if (!name) return badReq(res, 'Nome é obrigatório');
    const db = getDB();
    const id = uuid();
    db.prepare('INSERT INTO respondents (id, tenant_id, name, email, group_type, department, role) VALUES (?,?,?,?,?,?,?)').run(
      id, req.user.tenant_id, name, email || null, groupType || null, department || null, role || null
    );
    const respondent = db.prepare('SELECT * FROM respondents WHERE id = ?').get(id);
    return created(res, { respondent }, 'Respondente criado');
  } catch (e) { return err(res, 'Erro ao criar respondente', 500, e.message); }
}

/* POST /respondents/import  — bulk CSV import */
function importCSV(req, res) {
  try {
    const { respondents } = req.body;
    if (!Array.isArray(respondents) || respondents.length === 0) return badReq(res, 'Lista de respondentes vazia');
    const db   = getDB();
    const stmt = db.prepare('INSERT OR IGNORE INTO respondents (id, tenant_id, name, email, group_type, department, role) VALUES (?,?,?,?,?,?,?)');
    let count  = 0;
    respondents.forEach(r => {
      if (r.name) { stmt.run(uuid(), req.user.tenant_id, r.name, r.email||null, r.groupType||null, r.department||null, r.role||null); count++; }
    });
    return ok(res, { imported: count }, `${count} respondentes importados`);
  } catch (e) { return err(res, 'Erro ao importar', 500, e.message); }
}

/* POST /respondents/:id/consent  — register LGPD consent */
function registerConsent(req, res) {
  try {
    const db    = getDB();
    const found = db.prepare('SELECT id FROM respondents WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!found) return notFound(res, 'Respondente');

    const ipHash = hashIP(req.ip || '');
    const channel = req.body.channel || 'platform';
    db.prepare("UPDATE respondents SET consent_given=1, consent_date=datetime('now'), consent_channel=?, data_retention_until=date('now','+12 months') WHERE id=?").run(channel, req.params.id);
    db.prepare('INSERT INTO lgpd_consents (id, respondent_id, survey_id, action, ip_hash, channel) VALUES (?,?,?,?,?,?)').run(
      uuid(), req.params.id, req.body.surveyId || null, 'granted', ipHash, channel
    );
    return ok(res, {}, 'Consentimento LGPD registrado com sucesso');
  } catch (e) { return err(res, 'Erro ao registrar consentimento', 500, e.message); }
}

/* DELETE /respondents/:id  — anonymize (LGPD right to erasure) */
function anonymize(req, res) {
  try {
    const db = getDB();
    db.prepare("UPDATE respondents SET name='[Anonimizado]', email='anonimizado@lgpd', anonymized=1 WHERE id=? AND tenant_id=?").run(req.params.id, req.user.tenant_id);
    db.prepare('INSERT INTO lgpd_consents (id, respondent_id, action, ip_hash, channel) VALUES (?,?,?,?,?)').run(
      uuid(), req.params.id, 'data_deletion', hashIP(req.ip||''), 'platform'
    );
    logger.info('Respondente anonimizado (LGPD)', { respondentId: req.params.id });
    return ok(res, {}, 'Dados anonimizados conforme Art. 18 da LGPD');
  } catch (e) { return err(res, 'Erro ao anonimizar', 500, e.message); }
}

module.exports = { list, create, importCSV, registerConsent, anonymize };
