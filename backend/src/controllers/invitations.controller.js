'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const logger       = require('../utils/logger');
const { sendInvite, inviteLink } = require('../utils/invites');

/* Convites por e-mail disparados PELO SERVIDOR (não pelo cliente de e-mail do RH).
 * É o que dá rastreamento (enviado / aberto / respondido), lembrete automático para
 * quem não respondeu e o painel de adesão por distrito durante a coleta. */

const token = () => uuid().replace(/-/g, '');

function getSurvey(db, req) {
  return db.prepare("SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'")
    .get(req.params.surveyId, req.user.tenant_id);
}

/* GET /invitations/survey/:surveyId — lista de convites + resumo de adesão */
function list(req, res) {
  try {
    const db = getDB();
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');

    const rows = db.prepare(`
      SELECT i.id, i.name, i.email, i.token, i.status, i.sent_at, i.opened_at, i.responded_at,
             i.reminders_sent, i.last_reminder_at, i.last_error,
             d.name AS distrito_name
      FROM invitations i LEFT JOIN distritos d ON d.id = i.distrito_id
      WHERE i.survey_id = ? ORDER BY i.created_at`).all(survey.id);

    const summary = rows.reduce((acc, r) => {
      acc.total++;
      if (r.responded_at) acc.responded++;
      else if (r.opened_at) acc.opened++;
      else if (r.sent_at) acc.sent++;
      else acc.pending++;
      if (r.status === 'erro') acc.failed++;
      return acc;
    }, { total: 0, sent: 0, opened: 0, responded: 0, pending: 0, failed: 0 });

    const scheduled = db.prepare('SELECT id, run_at, sent_at, sent_count FROM reminder_schedules WHERE survey_id=? ORDER BY run_at').all(survey.id);
    return ok(res, { invitations: rows.map(r => ({ ...r, link: inviteLink(r.token) })), summary, scheduled });
  } catch (e) { return err(res, 'Erro ao listar convites', 500, e.message); }
}

/* POST /invitations/survey/:surveyId — cria e (opcionalmente) já dispara os convites.
   body: { people:[{name,email,distritoId,departamentoId}], fromRespondents:bool, group, send:bool } */
async function createBatch(req, res) {
  try {
    const db = getDB();
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');

    let people = Array.isArray(req.body.people) ? req.body.people : [];

    // Alternativa: puxar direto do cadastro de Respondentes (com consentimento e não anonimizados).
    if (req.body.fromRespondents) {
      const group = req.body.group && req.body.group !== 'todos' ? req.body.group : null;
      const rows = group
        ? db.prepare("SELECT id, name, email, distrito_id FROM respondents WHERE tenant_id=? AND anonymized=0 AND email IS NOT NULL AND email != '' AND group_type=?").all(req.user.tenant_id, group)
        : db.prepare("SELECT id, name, email, distrito_id FROM respondents WHERE tenant_id=? AND anonymized=0 AND email IS NOT NULL AND email != ''").all(req.user.tenant_id);
      people = people.concat(rows.map(r => ({ respondentId: r.id, name: r.name, email: r.email, distritoId: r.distrito_id })));
    }

    const seen = new Set(db.prepare('SELECT email FROM invitations WHERE survey_id=?').all(survey.id).map(r => String(r.email).toLowerCase()));
    const clean = [];
    people.forEach(p => {
      const email = String((p && p.email) || '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
      if (seen.has(email)) return; // não duplica convite para o mesmo e-mail
      seen.add(email);
      clean.push({ name: String((p && p.name) || '').trim() || email, email,
                   respondentId: p.respondentId || null, distritoId: p.distritoId || null, departamentoId: p.departamentoId || null });
    });
    if (!clean.length) return badReq(res, 'Nenhum e-mail novo e válido para convidar');
    if (clean.length > 2000) return badReq(res, 'Máximo de 2000 convites por vez');

    const ins = db.prepare(`INSERT INTO invitations (id, tenant_id, survey_id, campaign_id, respondent_id, name, email, token, distrito_id, departamento_id)
                            VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const madeIds = [];
    clean.forEach(p => {
      const id = uuid();
      ins.run(id, req.user.tenant_id, survey.id, req.body.campaignId || null, p.respondentId, p.name, p.email, token(), p.distritoId, p.departamentoId);
      madeIds.push(id);
    });

    let sent = 0, failed = 0, reason = null;
    if (req.body.send !== false) {
      const r = await dispatch(db, survey, madeIds, false);
      sent = r.sent; failed = r.failed; reason = r.reason;
    }
    logger.info('Convites criados', { by: req.user.id, survey: survey.id, count: madeIds.length, sent, failed });
    return created(res, { createdCount: madeIds.length, sent, failed, reason },
      sent ? `${madeIds.length} convite(s) criado(s), ${sent} enviado(s)` : `${madeIds.length} convite(s) criado(s)`);
  } catch (e) { return err(res, 'Erro ao criar convites', 500, e.message); }
}

/* Dispara os convites informados. Devolve { sent, failed, reason }. */
async function dispatch(db, survey, ids, reminder) {
  if (!ids.length) return { sent: 0, failed: 0, reason: null };
  const ph   = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM invitations WHERE id IN (${ph})`).all(...ids);
  const okStmt   = db.prepare(reminder
    ? "UPDATE invitations SET status='enviado', last_error=NULL, reminders_sent=reminders_sent+1, last_reminder_at=datetime('now') WHERE id=?"
    : "UPDATE invitations SET status='enviado', last_error=NULL, sent_at=datetime('now') WHERE id=?");
  const failStmt = db.prepare("UPDATE invitations SET status='erro', last_error=? WHERE id=?");

  let sent = 0, failed = 0, reason = null;
  for (const inv of rows) {
    const r = await sendInvite(inv, survey, reminder);
    if (r.sent) { okStmt.run(inv.id); sent++; }
    else { failStmt.run(String(r.reason || 'falha'), inv.id); failed++; reason = reason || r.reason; }
  }
  return { sent, failed, reason };
}

/* POST /invitations/survey/:surveyId/send — (re)envia os convites ainda não enviados */
async function sendPending(req, res) {
  try {
    const db = getDB();
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');
    const ids = db.prepare("SELECT id FROM invitations WHERE survey_id=? AND sent_at IS NULL").all(survey.id).map(r => r.id);
    if (!ids.length) return ok(res, { sent: 0, failed: 0 }, 'Nenhum convite pendente de envio');
    const r = await dispatch(db, survey, ids, false);
    return ok(res, r, r.sent ? `${r.sent} convite(s) enviado(s)` : `Não foi possível enviar: ${r.reason || 'e-mail não configurado'}`);
  } catch (e) { return err(res, 'Erro ao enviar convites', 500, e.message); }
}

/* POST /invitations/survey/:surveyId/remind — lembrete para quem ainda não respondeu */
async function remind(req, res) {
  try {
    const db = getDB();
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');
    const ids = pendingIds(db, survey.id);
    if (!ids.length) {
      const naoEnviados = db.prepare('SELECT COUNT(*) c FROM invitations WHERE survey_id=? AND sent_at IS NULL').get(survey.id).c;
      return ok(res, { sent: 0, failed: 0 }, naoEnviados
        ? `Nenhum convite foi enviado ainda (${naoEnviados} pendente(s)). Envie os convites antes de lembrar.`
        : 'Todos os convidados já responderam');
    }
    const r = await dispatch(db, survey, ids, true);
    return ok(res, r, r.sent ? `${r.sent} lembrete(s) enviado(s)` : `Não foi possível enviar: ${r.reason || 'e-mail não configurado'}`);
  } catch (e) { return err(res, 'Erro ao enviar lembretes', 500, e.message); }
}

/* Convites já enviados e ainda sem resposta. */
function pendingIds(db, surveyId) {
  return db.prepare("SELECT id FROM invitations WHERE survey_id=? AND responded_at IS NULL AND sent_at IS NOT NULL").all(surveyId).map(r => r.id);
}

/* POST /invitations/survey/:surveyId/schedule — agenda um lembrete { runAt } */
function schedule(req, res) {
  try {
    const db = getDB();
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');
    const runAt = req.body.runAt ? new Date(req.body.runAt) : null;
    if (!runAt || isNaN(runAt.getTime())) return badReq(res, 'Data do lembrete inválida');
    if (runAt.getTime() < Date.now()) return badReq(res, 'A data do lembrete precisa estar no futuro');
    const id = uuid();
    db.prepare('INSERT INTO reminder_schedules (id, tenant_id, survey_id, run_at) VALUES (?,?,?,?)')
      .run(id, req.user.tenant_id, survey.id, runAt.toISOString());
    return created(res, { id, runAt: runAt.toISOString() }, 'Lembrete agendado');
  } catch (e) { return err(res, 'Erro ao agendar lembrete', 500, e.message); }
}

/* DELETE /invitations/schedule/:id */
function unschedule(req, res) {
  try {
    const db = getDB();
    const r = db.prepare('DELETE FROM reminder_schedules WHERE id=? AND tenant_id=? AND sent_at IS NULL').run(req.params.id, req.user.tenant_id);
    if (!r.changes) return notFound(res, 'Agendamento');
    return ok(res, { deleted: true }, 'Agendamento cancelado');
  } catch (e) { return err(res, 'Erro ao cancelar agendamento', 500, e.message); }
}

/* DELETE /invitations/:id */
function remove(req, res) {
  try {
    const db = getDB();
    const r = db.prepare('DELETE FROM invitations WHERE id=? AND tenant_id=? AND responded_at IS NULL').run(req.params.id, req.user.tenant_id);
    if (!r.changes) return badReq(res, 'Convite não encontrado ou já respondido');
    return ok(res, { deleted: true }, 'Convite removido');
  } catch (e) { return err(res, 'Erro ao remover convite', 500, e.message); }
}

/* GET /invitations/survey/:surveyId/adherence — adesão por distrito durante a coleta.
   Combina o que a meta do distrito espera, os convites disparados e as respostas recebidas. */
function adherence(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const survey = getSurvey(db, req);
    if (!survey) return notFound(res, 'Pesquisa');

    const { scopeDistritos } = require('../utils/scope');
    const scope = scopeDistritos(db, req.user);

    const regionais = {};
    db.prepare('SELECT id, name FROM regionais WHERE tenant_id=?').all(t).forEach(r => regionais[r.id] = r.name);
    let distritos = db.prepare('SELECT id, name, regional_id, meta FROM distritos WHERE tenant_id=? ORDER BY name').all(t);
    if (scope) distritos = distritos.filter(d => scope.includes(d.id));

    // Meta da campanha (aplicação) sobrepõe a meta cadastrada no distrito, quando houver.
    const appMeta = {};
    db.prepare(`SELECT ca.distrito_id, ca.meta FROM campaign_applications ca
                JOIN survey_campaigns c ON c.id = ca.campaign_id
                WHERE c.survey_id = ? AND c.tenant_id = ?`).all(survey.id, t)
      .forEach(r => { if (r.meta > 0) appMeta[r.distrito_id] = r.meta; });

    const invited = {}, delivered = {}, respondedInv = {};
    db.prepare("SELECT distrito_id, COUNT(*) c FROM invitations WHERE survey_id=? GROUP BY distrito_id").all(survey.id)
      .forEach(r => { if (r.distrito_id) invited[r.distrito_id] = r.c; });
    db.prepare("SELECT distrito_id, COUNT(*) c FROM invitations WHERE survey_id=? AND sent_at IS NOT NULL GROUP BY distrito_id").all(survey.id)
      .forEach(r => { if (r.distrito_id) delivered[r.distrito_id] = r.c; });
    db.prepare("SELECT distrito_id, COUNT(*) c FROM invitations WHERE survey_id=? AND responded_at IS NOT NULL GROUP BY distrito_id").all(survey.id)
      .forEach(r => { if (r.distrito_id) respondedInv[r.distrito_id] = r.c; });

    const answered = {};
    db.prepare("SELECT distrito_id, COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL AND distrito_id IS NOT NULL GROUP BY distrito_id").all(survey.id)
      .forEach(r => answered[r.distrito_id] = r.c);

    const rows = distritos.map(d => {
      const meta = appMeta[d.id] || d.meta || 0;
      const respostas = answered[d.id] || 0;
      return {
        distritoId: d.id, distrito: d.name, regional: regionais[d.regional_id] || null,
        meta, convidados: invited[d.id] || 0, enviados: delivered[d.id] || 0,
        convitesRespondidos: respondedInv[d.id] || 0,
        respostas, adesao: meta > 0 ? Math.round((respostas / meta) * 100) : null,
      };
    });

    const totals = rows.reduce((a, r) => ({
      meta: a.meta + r.meta, convidados: a.convidados + r.convidados,
      enviados: a.enviados + r.enviados, respostas: a.respostas + r.respostas,
    }), { meta: 0, convidados: 0, enviados: 0, respostas: 0 });
    totals.adesao = totals.meta > 0 ? Math.round((totals.respostas / totals.meta) * 100) : null;
    // Respostas sem distrito (link público geral) não entram no rateio por distrito.
    totals.semDistrito = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL AND distrito_id IS NULL").get(survey.id).c;

    return ok(res, { distritos: rows, totals });
  } catch (e) { return err(res, 'Erro ao carregar adesão', 500, e.message); }
}

/* Processa os lembretes agendados que já venceram. Chamado pelo scheduler do servidor. */
async function runDueReminders() {
  const db = getDB();
  const due = db.prepare("SELECT * FROM reminder_schedules WHERE sent_at IS NULL AND run_at <= ?").all(new Date().toISOString());
  for (const s of due) {
    const survey = db.prepare("SELECT * FROM surveys WHERE id=? AND status='ativo'").get(s.survey_id);
    // Pesquisa encerrada ou removida: marca como processado para não ficar tentando.
    if (!survey) { db.prepare("UPDATE reminder_schedules SET sent_at=datetime('now'), sent_count=0 WHERE id=?").run(s.id); continue; }
    const ids = pendingIds(db, survey.id);
    const r = ids.length ? await dispatch(db, survey, ids, true) : { sent: 0 };
    db.prepare("UPDATE reminder_schedules SET sent_at=datetime('now'), sent_count=? WHERE id=?").run(r.sent, s.id);
    logger.info('Lembrete agendado processado', { survey: survey.id, sent: r.sent });
  }
  return due.length;
}

module.exports = { list, createBatch, sendPending, remind, schedule, unschedule, remove, adherence, runDueReminders };
