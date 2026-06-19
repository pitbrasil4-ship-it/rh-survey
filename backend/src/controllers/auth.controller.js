'use strict';
const bcrypt         = require('bcryptjs');
const { v4: uuid }   = require('uuid');
const { getDB }      = require('../config/database');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');
const { ok, created, err, unauth, badReq } = require('../utils/response');
const logger         = require('../utils/logger');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

/* POST /auth/register  — creates tenant + first admin */
async function register(req, res) {
  try {
    const { companyName, email, password, name } = req.body;
    if (!companyName || !email || !password || !name) return badReq(res, 'Todos os campos são obrigatórios');
    if (password.length < 8) return badReq(res, 'Senha deve ter no mínimo 8 caracteres');

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return badReq(res, 'E-mail já cadastrado');

    const tenantId = uuid();
    const userId   = uuid();
    const slug     = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g,'').slice(0,50) + '-' + tenantId.slice(0,8);
    const hash     = await bcrypt.hash(password, ROUNDS);

    db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?,?,?)').run(tenantId, companyName, slug);
    db.prepare(`INSERT INTO users (id, tenant_id, name, email, password_hash, role)
                VALUES (?,?,?,?,?,'admin')`).run(userId, tenantId, name, email, hash);

    const accessToken  = signAccess({ sub: userId, tenantId, role: 'admin' });
    const refreshToken = signRefresh({ sub: userId });
    const expiresAt    = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)').run(uuid(), userId, refreshToken, expiresAt);

    logger.info('Novo tenant registrado', { tenantId, slug, userId });
    return created(res, { accessToken, refreshToken, user: { id: userId, name, email, role: 'admin' }, tenant: { id: tenantId, slug } }, 'Conta criada com sucesso');
  } catch (e) {
    logger.error('register error', { error: e.message });
    return err(res, 'Erro ao criar conta', 500, e.message);
  }
}

/* POST /auth/login */
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return badReq(res, 'E-mail e senha são obrigatórios');

    const db   = getDB();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.active) return unauth(res, 'Credenciais inválidas');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return unauth(res, 'Credenciais inválidas');

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    const accessToken  = signAccess({ sub: user.id, tenantId: user.tenant_id, role: user.role });
    const refreshToken = signRefresh({ sub: user.id });
    const expiresAt    = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)').run(uuid(), user.id, refreshToken, expiresAt);

    return ok(res, {
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, 'Login realizado com sucesso');
  } catch (e) {
    logger.error('login error', { error: e.message });
    return err(res, 'Erro ao fazer login', 500, e.message);
  }
}

/* POST /auth/refresh */
function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return badReq(res, 'Refresh token não fornecido');

    const payload = verifyRefresh(refreshToken);
    const db      = getDB();
    const stored  = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(refreshToken);
    if (!stored) return unauth(res, 'Refresh token inválido ou revogado');
    if (new Date(stored.expires_at) < new Date()) {
      db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
      return unauth(res, 'Refresh token expirado');
    }

    const user = db.prepare('SELECT id, tenant_id, role, active FROM users WHERE id = ?').get(payload.sub);
    if (!user || !user.active) return unauth(res, 'Usuário inativo');

    const newAccess = signAccess({ sub: user.id, tenantId: user.tenant_id, role: user.role });
    return ok(res, { accessToken: newAccess }, 'Token renovado');
  } catch (e) {
    return unauth(res, 'Refresh token inválido ou expirado');
  }
}

/* POST /auth/logout */
function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const db = getDB();
      db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
    }
    return ok(res, {}, 'Logout realizado com sucesso');
  } catch (e) {
    return ok(res, {}, 'Logout realizado');
  }
}

/* GET /auth/me */
function me(req, res) {
  const db     = getDB();
  const user   = db.prepare('SELECT id, name, email, role, two_fa_enabled, created_at FROM users WHERE id = ?').get(req.user.id);
  const tenant = db.prepare('SELECT id, name, slug, plan FROM tenants WHERE id = ?').get(req.user.tenant_id);
  return ok(res, { user, tenant });
}

module.exports = { register, login, refresh, logout, me };
