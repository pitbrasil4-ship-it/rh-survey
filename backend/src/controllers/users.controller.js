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

/* Valida um id de regional/distrito dentro do tenant; devolve null se não existir. */
function scopeValue(db, tenantId, table, id) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=? AND tenant_id=?`).get(id, tenantId);
  return row ? row.id : null;
}

/* Categorias de pesquisa cujos resultados ficam ocultos para o usuário. */
function categoriesValue(list) {
  if (!Array.isArray(list)) return null;
  const clean = [...new Set(list.map(c => String(c || '').trim()).filter(Boolean))];
  return clean.length ? JSON.stringify(clean) : null;
}

/* GET /users — list all users in the tenant (admin only) */
function list(req, res) {
  try {
    const db = getDB();
    const rows = db.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.two_fa_enabled, u.last_login, u.created_at,
              u.regional_id, u.distrito_id, u.blocked_categories,
              r.name AS regional_name, d.name AS distrito_name
       FROM users u
       LEFT JOIN regionais r ON r.id = u.regional_id
       LEFT JOIN distritos d ON d.id = u.distrito_id
       WHERE u.tenant_id = ? ORDER BY u.created_at DESC`
    ).all(req.user.tenant_id);
    const PJ = v => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
    const users = rows.map(u => ({ ...u, blocked_categories: PJ(u.blocked_categories) }));
    return ok(res, { users, total: users.length });
  } catch (e) {
    logger.error('users.list error', { error: e.message });
    return err(res, 'Erro ao listar usuários', 500, e.message);
  }
}

/* POST /users — create a user with a defined role (admin only) */
async function create(req, res) {
  try {
    const { name, email, role, password, regionalId, distritoId, blockedCategories } = req.body;
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
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role, must_change_password,
                          regional_id, distrito_id, blocked_categories)
       VALUES (?,?,?,?,?,?,1,?,?,?)`
    ).run(id, req.user.tenant_id, name, email, hash, role,
      scopeValue(db, req.user.tenant_id, 'regionais', regionalId),
      scopeValue(db, req.user.tenant_id, 'distritos', distritoId),
      categoriesValue(blockedCategories));

    logger.info('Usuário criado', { by: req.user.id, newUser: id, role });

    // Return the temporary password ONLY when the system generated it,
    // so the admin can share it for first access.
    const payload = { user: { id, name, email, role, active: 1, regional_id: regionalId || null, distrito_id: distritoId || null } };
    if (!password) payload.temporaryPassword = plain;

    // Envio opcional do e-mail de acesso (automático se RESEND_API_KEY estiver configurada).
    if (req.body.sendEmail) {
      const { sendMail, accessEmail } = require('../utils/mailer');
      const mail = accessEmail({ name, email, password: plain });
      const r = await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
      payload.emailSent = !!r.sent;
      if (!r.sent) payload.emailReason = r.reason;
    }
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

    const { name, role, active, regionalId, distritoId, blockedCategories } = req.body;
    if (role !== undefined && !VALID_ROLES.includes(role)) return badReq(res, `Papel inválido. Use: ${VALID_ROLES.join(', ')}`);

    // Prevent an admin from demoting or deactivating themselves (lockout guard).
    if (req.params.id === req.user.id) {
      if (role !== undefined && role !== 'admin') return forbidden(res, 'Você não pode alterar o seu próprio papel de administrador');
      if (active === false || active === 0)        return forbidden(res, 'Você não pode desativar a sua própria conta');
    }

    db.prepare('UPDATE users SET name=?, role=?, active=?, regional_id=?, distrito_id=?, blocked_categories=? WHERE id=?').run(
      name ?? user.name,
      role ?? user.role,
      active === undefined ? user.active : (active ? 1 : 0),
      regionalId === undefined ? user.regional_id : scopeValue(db, req.user.tenant_id, 'regionais', regionalId),
      distritoId === undefined ? user.distrito_id : scopeValue(db, req.user.tenant_id, 'distritos', distritoId),
      blockedCategories === undefined ? user.blocked_categories : categoriesValue(blockedCategories),
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

/* POST /users/test-email — envia um e-mail de teste para o próprio admin logado (diagnóstico do Resend) */
async function testEmail(req, res) {
  try {
    const db = getDB();
    const me = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);
    if (!me) return notFound(res, 'Usuário');
    const { sendMail } = require('../utils/mailer');
    const configured = !!process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'RH Survey <onboarding@resend.dev>';
    const r = await sendMail({
      to: me.email,
      subject: 'Teste de envio — RH Survey',
      text: `Olá, ${me.name}!\n\nEste é um e-mail de teste do RH Survey. Se você recebeu esta mensagem, o envio automático está funcionando.\n\nRemetente configurado: ${from}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1E1B4B">
        <div style="background:#1E1B4B;color:#fff;padding:16px 22px;border-radius:12px 12px 0 0"><strong>RH Survey</strong></div>
        <div style="border:1px solid #E6E9F2;border-top:0;padding:22px;border-radius:0 0 12px 12px">
          <p>Olá, <strong>${me.name}</strong>!</p>
          <p>Este é um <strong>e-mail de teste</strong>. Se você recebeu esta mensagem, o envio automático está funcionando.</p>
          <p style="font-size:12px;color:#64748B">Remetente configurado: ${from}</p>
        </div></div>`,
    });
    return ok(res, { sent: !!r.sent, configured, from, reason: r.reason || null, to: me.email },
      r.sent ? 'E-mail de teste enviado' : 'Não foi possível enviar');
  } catch (e) { return err(res, 'Erro ao testar envio', 500, e.message); }
}

module.exports = { list, create, update, remove, testEmail };
