'use strict';
const { getDB } = require('../config/database');
const { ok, err } = require('../utils/response');

/* GET /audit — trilha de auditoria (admin) */
function listAudit(req, res) {
  try {
    const db = getDB();
    const logs = db.prepare(`
      SELECT a.id, a.action, a.resource, a.resource_id, a.created_at,
             u.name AS user_name, u.email AS user_email
      FROM audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.tenant_id = ?
      ORDER BY a.created_at DESC
      LIMIT 200
    `).all(req.user.tenant_id);
    return ok(res, { logs });
  } catch (e) { return err(res, 'Erro ao carregar auditoria', 500, e.message); }
}

module.exports = { listAudit };
