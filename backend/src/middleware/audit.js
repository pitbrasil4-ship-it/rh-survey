'use strict';
const { v4: uuidv4 } = require('uuid');
const { getDB }      = require('../config/database');
const { hashIP }     = require('../utils/crypto');
const logger         = require('../utils/logger');

function auditLog(action, resource = null) {
  return (req, _res, next) => {
    try {
      const db    = getDB();
      const ipHash = hashIP(req.ip || req.socket?.remoteAddress);
      db.prepare(`INSERT INTO audit_log (id, tenant_id, user_id, action, resource, resource_id, ip_hash, meta)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuidv4(),
        req.tenantId || req.user?.tenant_id || null,
        req.user?.id || null,
        action,
        resource,
        req.params?.id || null,
        ipHash,
        JSON.stringify({ method: req.method, path: req.path })
      );
    } catch (e) {
      logger.error('Audit log error', { error: e.message });
    }
    next();
  };
}

module.exports = { auditLog };
