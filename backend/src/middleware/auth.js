'use strict';
const { verifyAccess } = require('../utils/jwt');
const { getDB }        = require('../config/database');
const { unauth, forbidden } = require('../utils/response');

/**
 * Verifies JWT and attaches user to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return unauth(res, 'Token de acesso não fornecido');
  try {
    const payload = verifyAccess(token);
    const db      = getDB();
    const user    = db.prepare('SELECT id, tenant_id, name, email, role, active FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.active) return unauth(res, 'Usuário inativo ou não encontrado');
    req.user = user;
    next();
  } catch (e) {
    return unauth(res, 'Token inválido ou expirado');
  }
}

/**
 * Role guard — usage: authorize('admin') or authorize('admin','manager')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return unauth(res);
    if (!roles.includes(req.user.role)) return forbidden(res, `Papel '${req.user.role}' sem permissão para esta ação`);
    next();
  };
}

/**
 * Resolves tenant from X-Tenant-Slug header or user's tenant.
 */
function resolveTenant(req, res, next) {
  if (req.user?.tenant_id) { req.tenantId = req.user.tenant_id; return next(); }
  const slug = req.headers['x-tenant-slug'];
  if (!slug) return next();
  const db     = getDB();
  const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ? AND active = 1').get(slug);
  if (!tenant) return next();
  req.tenantId = tenant.id;
  next();
}

module.exports = { authenticate, authorize, resolveTenant };
