'use strict';
const bcrypt       = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq, forbidden } = require('../utils/response');
const logger       = require('../utils/logger');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const VALID_ROLES = ['admin', 'manager', 'viewer'];

/* Generates a readable temporary password for first access */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p + '@' + new Date().getFullYear();
}

/* GET /users — list all users in the tenant (admin only) */
function list(req, res) {
  try {
    const db = getDB();
    const rows = db.prepare(
      `SELECT id, name, email, role, active, two_fa_enabled, last_login, created_at
       FROM users WHERE tenant_id = ? ORDER BY created_at DESC`
    ).all(req.user.tenant_id);
    return ok(res, { users: rows, total: rows.length });
  } catch (e) {
    logger.error('users.list error', { error: e.message });
    return err(res, 'Erro ao listar usuários', 500, e.message);
  }
}

/* POST /users — create a user with a defined role (admin only) */
async function create(req, res) {
  try {
    const { name, email, role, password } = req.body;
    if (!name || !email)          return badReq(res, 'Nome e e-mail são obrigatórios');
    if (!VALID_ROLES.includes(role)) return badReq(res, `Papel inválido. Use: ${VALID_ROLES.join(', ')}`);

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return badReq(res, 'E-mail já cadastrado');

    // If admin doesn't supply a password, generate a temporary one to share.
    const plain = (password && password.length >= 8) ? password : tempPassword();
    const hash  = await bcrypt.hash(plain, ROUNDS);
    const id    = uuid();

    db.prepare(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role)
       VALUES (?,?,?,?,?,?)`
    ).run(id, req.user.tenant_id, name, email, hash, role);

    logger.info('Usuário criado', { by: req.user.id, newUser: id, role });

    // Return the temporary password ONLY when the system generated it,
    // so the admin can share it for first access.
    const payload = { user: { id, name, email, role, active: 1 } };
    if (!password) payload.temporaryPassword = plain;
    return created(res, payload, 'Usuário criado com sucesso');
  } catch (e) {
    logger.error('users.create error', { error: e.message });
    return err(res, 'Erro ao criar usuário', 500, e.message);
  }
}

/* PUT /users/:id — update name / role / active (admin only, PATCH semantics) */
function update(req, res) {
  try {
    const db = getDB();
    // Fetch full row so omitted fields are preserved and no undefined is bound.
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!user) return notFound(res, 'Usuário');

    const { name, role, active } = req.body;
    if (role !== undefined && !VALID_ROLES.includes(role)) return badReq(res, `Papel inválido. Use: ${VALID_ROLES.join(', ')}`);

    // Prevent an admin from demoting or deactivating themselves (lockout guard).
    if (req.params.id === req.user.id) {
      if (role !== undefined && role !== 'admin') return forbidden(res, 'Você não pode alterar o seu próprio papel de administrador');
      if (active === false || active === 0)        return forbidden(res, 'Você não pode desativar a sua própria conta');
    }

    db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(
      name ?? user.name,
      role ?? user.role,
      active === undefined ? user.active : (active ? 1 : 0),
      req.params.id
    );
    return ok(res, { id: req.params.id }, 'Usuário atualizado');
  } catch (e) {
    logger.error('users.update error', { error: e.message });
    return err(res, 'Erro ao atualizar usuário', 500, e.message);
  }
}

/* DELETE /users/:id — soft delete / deactivate (admin only) */
function remove(req, res) {
  try {
    if (req.params.id === req.user.id) return forbidden(res, 'Você não pode remover a sua própria conta');
    const db = getDB();
    const user = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!user) return notFound(res, 'Usuário');

    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
    // Revoke any refresh tokens so the deactivated user can't refresh a session.
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.params.id);
    logger.info('Usuário desativado', { by: req.user.id, target: req.params.id });
    return ok(res, {}, 'Usuário desativado com sucesso');
  } catch (e) {
    logger.error('users.remove error', { error: e.message });
    return err(res, 'Erro ao remover usuário', 500, e.message);
  }
}

module.exports = { list, create, update, remove };
