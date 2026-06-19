'use strict';
const { getDB } = require('../config/database');
const { ok, err } = require('../utils/response');

function getConsents(req, res) {
  try {
    const db   = getDB();
    const rows = db.prepare('SELECT r.id, r.name, r.email, r.consent_given, r.consent_date, r.consent_channel, r.anonymized FROM respondents r WHERE r.tenant_id=? ORDER BY r.created_at DESC').all(req.user.tenant_id);
    const pending   = rows.filter(r => !r.consent_given && !r.anonymized).length;
    const collected = rows.filter(r => r.consent_given).length;
    return ok(res, { respondents: rows, stats: { total: rows.length, collected, pending, anonymized: rows.filter(r => r.anonymized).length } });
  } catch (e) { return err(res, 'Erro ao buscar consentimentos', 500, e.message); }
}

function getAuditLog(req, res) {
  try {
    const db   = getDB();
    const logs = db.prepare('SELECT a.*, u.name as user_name FROM audit_log a LEFT JOIN users u ON a.user_id=u.id WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 100').all(req.user.tenant_id);
    return ok(res, { logs, total: logs.length });
  } catch (e) { return err(res, 'Erro ao buscar auditoria', 500, e.message); }
}

function getReport(req, res) {
  try {
    const db         = getDB();
    const totalResps = db.prepare('SELECT COUNT(*) as cnt FROM respondents WHERE tenant_id=?').get(req.user.tenant_id).cnt;
    const consented  = db.prepare('SELECT COUNT(*) as cnt FROM respondents WHERE tenant_id=? AND consent_given=1').get(req.user.tenant_id).cnt;
    const surveys    = db.prepare("SELECT COUNT(*) as cnt FROM surveys WHERE tenant_id=? AND status='ativo'").get(req.user.tenant_id).cnt;
    const anonSurveys= db.prepare("SELECT COUNT(*) as cnt FROM surveys WHERE tenant_id=? AND anonymous=1 AND status='ativo'").get(req.user.tenant_id).cnt;
    return ok(res, {
      conformity: { totalRespondents: totalResps, consented, pending: totalResps - consented, rate: totalResps ? Math.round((consented/totalResps)*100) : 0 },
      surveys:    { total: surveys, anonymous: anonSurveys },
      lgpdBasis:  'consentimento_explicito',
      dpoContact: process.env.DPO_EMAIL || 'dpo@empresa.com',
      reportDate: new Date().toISOString(),
    });
  } catch (e) { return err(res, 'Erro ao gerar relatório LGPD', 500, e.message); }
}

module.exports = { getConsents, getAuditLog, getReport };
