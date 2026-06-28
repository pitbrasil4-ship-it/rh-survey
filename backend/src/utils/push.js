'use strict';
// Notificações Web Push (PWA). Desativado automaticamente se as chaves VAPID não estiverem configuradas.
const webpush = require('web-push');
const { v4: uuid } = require('uuid');
const logger = require('./logger');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:rh@rgis.com', pub, priv);
    configured = true;
    return true;
  } catch (e) { logger.warn('VAPID inválido: ' + e.message); return false; }
}

function pushEnabled() { return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }

function saveSubscription(db, tenantId, userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys) return false;
  db.prepare(`INSERT INTO push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(endpoint) DO UPDATE SET tenant_id=excluded.tenant_id, user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`)
    .run(uuid(), tenantId, userId, sub.endpoint, sub.keys.p256dh || '', sub.keys.auth || '');
  return true;
}

function removeSubscription(db, endpoint) {
  if (!endpoint) return;
  try { db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint); } catch {}
}

async function sendToRows(db, rows, payload) {
  if (!ensureConfigured() || !rows.length) return;
  const data = JSON.stringify(payload);
  await Promise.all(rows.map(async (r) => {
    const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
    try {
      await webpush.sendNotification(sub, data);
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        try { db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(r.endpoint); } catch {}
      } else {
        logger.warn('Falha ao enviar push: ' + (e && e.message));
      }
    }
  }));
}

async function sendToUser(db, userId, payload) {
  const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?').all(userId);
  await sendToRows(db, rows, payload);
}

async function sendToTenant(db, tenantId, payload) {
  const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE tenant_id=?').all(tenantId);
  await sendToRows(db, rows, payload);
}

// Notifica os inscritos do tenant sobre uma nova resposta. Uso fire-and-forget.
async function notifyNewResponse(db, surveyId) {
  try {
    if (!pushEnabled()) return;
    const s = db.prepare('SELECT tenant_id, name FROM surveys WHERE id=?').get(surveyId);
    if (!s) return;
    await sendToTenant(db, s.tenant_id, {
      title: 'Nova resposta recebida',
      body: `"${s.name}" recebeu uma nova resposta.`,
      url: '/?go=results',
      tag: 'resp-' + surveyId,
    });
  } catch (e) { logger.warn('notifyNewResponse: ' + (e && e.message)); }
}

module.exports = { pushEnabled, saveSubscription, removeSubscription, sendToUser, sendToTenant, notifyNewResponse };
