'use strict';
const { getDB } = require('../config/database');
const { ok, err, badReq } = require('../utils/response');
const push = require('../utils/push');

/* GET /push/vapid-public — chave pública (segura de expor) + se o push está ativo no servidor */
function vapidPublic(req, res) {
  return ok(res, { publicKey: process.env.VAPID_PUBLIC_KEY || null, enabled: push.pushEnabled() }, 'ok');
}

/* POST /push/subscribe */
function subscribe(req, res) {
  try {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint) return badReq(res, 'Assinatura inválida');
    push.saveSubscription(getDB(), req.user.tenant_id, req.user.id, sub);
    return ok(res, { subscribed: true }, 'Notificações push ativadas');
  } catch (e) { return err(res, 'Erro ao ativar push', 500, e.message); }
}

/* POST /push/unsubscribe */
function unsubscribe(req, res) {
  try {
    push.removeSubscription(getDB(), req.body && req.body.endpoint);
    return ok(res, { subscribed: false }, 'Notificações push desativadas');
  } catch (e) { return err(res, 'Erro ao desativar push', 500, e.message); }
}

/* POST /push/test — envia uma notificação de teste ao próprio usuário */
async function test(req, res) {
  try {
    if (!push.pushEnabled()) return ok(res, { sent: false, disabled: true }, 'Push não configurado no servidor (defina as chaves VAPID).');
    await push.sendToUser(getDB(), req.user.id, { title: 'RH Survey', body: 'Notificações push estão funcionando! 🎉', url: '/?go=notificacoes', tag: 'test' });
    return ok(res, { sent: true }, 'Notificação de teste enviada');
  } catch (e) { return err(res, 'Erro ao enviar teste', 500, e.message); }
}

module.exports = { vapidPublic, subscribe, unsubscribe, test };
