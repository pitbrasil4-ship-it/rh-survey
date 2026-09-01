'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');
const logger       = require('../utils/logger');

const { scopeDistritos } = require('../utils/scope');

/* Valida um distrito dentro do tenant. */
function distritoRef(db, tenantId, id) {
  if (!id) return null;
  const row = db.prepare('SELECT id FROM distritos WHERE id=? AND tenant_id=?').get(id, tenantId);
  return row ? row.id : null;
}

/* GET /respondents */
function list(req, res) {
  try {
    const { group, search } = req.query;
    const db   = getDB();
    let sql    = `SELECT r.id, r.name, r.email, r.group_type, r.department, r.role, r.consent_given,
                         r.consent_date, r.consent_channel, r.anonymized, r.created_at,
                         r.distrito_id, d.name AS distrito_name
                  FROM respondents r LEFT JOIN distritos d ON d.id = r.distrito_id
                  WHERE r.tenant_id = ? AND r.anonymized = 0`;
    const args = [req.user.tenant_id];
    if (group)  { sql += ' AND r.group_type = ?'; args.push(group); }
    if (search) { sql += ' AND (r.name LIKE ? OR r.email LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
    // Gestor amarrado a um distrito só enxerga os respondentes daquele distrito.
    const allowed = scopeDistritos(db, req.user);
    if (allowed) {
      sql += allowed.length ? ` AND r.distrito_id IN (${allowed.map(() => '?').join(',')})` : ' AND 1 = 0';
      args.push(...allowed);
    }
    sql += ' ORDER BY r.created_at DESC';
    const rows = db.prepare(sql).all(...args);
    return ok(res, { respondents: rows, total: rows.length });
  } catch (e) { return err(res, 'Erro ao listar respondentes', 500, e.message); }
}

/* POST /respondents */
function create(req, res) {
  try {
    const { name, email, groupType, department, role, distritoId } = req.body;
    if (!name) return badReq(res, 'Nome é obrigatório');
    const db = getDB();
    const id = uuid();
    db.prepare('INSERT INTO respondents (id, tenant_id, name, email, group_type, department, role, distrito_id) VALUES (?,?,?,?,?,?,?,?)').run(
      id, req.user.tenant_id, name, email || null, groupType || null, department || null, role || null,
      distritoRef(db, req.user.tenant_id, distritoId)
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
    const stmt = db.prepare('INSERT OR IGNORE INTO respondents (id, tenant_id, name, email, group_type, department, role, distrito_id) VALUES (?,?,?,?,?,?,?,?)');
    // Aceita o distrito por nome na planilha, além do id — é assim que o RH tem a lista.
    const byName = {};
    db.prepare('SELECT id, name FROM distritos WHERE tenant_id=?').all(req.user.tenant_id)
      .forEach(d => byName[d.name.trim().toLowerCase()] = d.id);
    let count  = 0;
    respondents.forEach(r => {
      if (!r.name) return;
      const dist = distritoRef(db, req.user.tenant_id, r.distritoId) || byName[String(r.distrito || '').trim().toLowerCase()] || null;
      stmt.run(uuid(), req.user.tenant_id, r.name, r.email||null, r.groupType||null, r.department||null, r.role||null, dist);
      count++;
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
