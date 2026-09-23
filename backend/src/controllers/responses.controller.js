'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');
const Q            = require('../utils/questions');
const { activeCampaignId } = require('./campaigns.controller');

const SURVEY_COLS = `id, name, name_en, name_es, description, description_en, description_es,
                     category, anonymous, status, deadline, one_per_device, max_responses`;

/* Resolve o token recebido no link: link geral da pesquisa, link por segmento
   (distrito/departamento) ou convite individual (uso único). */
function resolveToken(db, token) {
  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
  if (inv) {
    return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE id = ?`).get(inv.survey_id),
             invitation: inv, distritoId: inv.distrito_id, departamentoId: inv.departamento_id };
  }
  const link = db.prepare('SELECT survey_id, distrito_id, departamento_id FROM survey_links WHERE token = ?').get(token);
  if (link) {
    return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE id = ?`).get(link.survey_id),
             invitation: null, distritoId: link.distrito_id, departamentoId: link.departamento_id };
  }
  return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE public_token = ?`).get(token),
           invitation: null, distritoId: null, departamentoId: null };
}

function isClosed(survey) {
  return survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now());
}

/* Atingiu o limite de respostas configurado para a pesquisa? */
function reachedLimit(db, survey) {
  if (!survey.max_responses) return false;
  const c = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL').get(survey.id).c;
  return c >= survey.max_responses;
}

/* GET /public/survey/:token  — get survey by public token (no auth) */
function getPublic(req, res) {
  try {
    const db = getDB();
    const { survey, invitation, distritoId } = resolveToken(db, req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');

    if (isClosed(survey)) return ok(res, { closed: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Pesquisa encerrada');
    if (reachedLimit(db, survey)) return ok(res, { closed: true, limitReached: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Limite de respostas atingido');

    // Convite é de uso único: se já respondeu, não abre de novo.
    if (invitation && invitation.responded_at)
      return ok(res, { alreadyAnswered: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Este convite já foi respondido');

    // Registra a abertura do convite (rastreamento de quem abriu).
    if (invitation && !invitation.opened_at)
      db.prepare("UPDATE invitations SET opened_at=datetime('now') WHERE id=?").run(invitation.id);

    const rows = db.prepare(`SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es,
                                    required, config, logic
                             FROM questions WHERE survey_id = ? ORDER BY order_num`).all(survey.id);
    const questions = rows.map(Q.fromRow);

    const { status, deadline, one_per_device, max_responses, ...pub } = survey;
    return ok(res, {
      survey: pub, questions,
      onePerDevice: !!one_per_device,
      invited: invitation ? { name: invitation.name } : null,
      distritoId: distritoId || null,
    });
  } catch (e) { return err(res, 'Erro ao carregar pesquisa', 500, e.message); }
}

/* POST /public/survey/:token  — submit response (no auth) */
function submitPublic(req, res) {
  try {
    const { answers, respondentId, deviceId } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');

    const db = getDB();
    const { survey, invitation, distritoId, departamentoId } = resolveToken(db, req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    if (isClosed(survey)) return badReq(res, 'Esta pesquisa está encerrada e não aceita mais respostas.');
    if (reachedLimit(db, survey)) return badReq(res, 'Esta pesquisa já atingiu o limite de respostas definido.');

    // Link de uso único por avaliador: o convite só aceita uma resposta.
    if (invitation && invitation.responded_at) return badReq(res, 'Este convite já foi respondido. Cada link aceita uma única resposta.');

    // Controle de duplicidade por dispositivo (quando ligado na pesquisa).
    const device = String(deviceId || '').trim().slice(0, 64) || null;
    if (survey.one_per_device && device) {
      const dup = db.prepare('SELECT 1 FROM responses WHERE survey_id=? AND device_id=? AND completed_at IS NOT NULL').get(survey.id, device);
      if (dup) return badReq(res, 'Já registramos uma resposta deste dispositivo para esta pesquisa.');
    }

    const responseId = uuid();
    const ipHash     = hashIP(req.ip || '');
    const campaignId = activeCampaignId(db, survey.id);
    // A resposta fica presa à versão que estava publicada quando ela foi enviada,
    // para que uma edição posterior do questionário não reescreva o que foi respondido.
    const version = db.prepare('SELECT id, number FROM survey_versions WHERE survey_id=? ORDER BY number DESC LIMIT 1').get(survey.id);

    db.prepare(`INSERT INTO responses (id, survey_id, respondent_id, ip_hash, distrito_id, departamento_id, device_id, invitation_id, campaign_id, version_id, version_number)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      responseId, survey.id, survey.anonymous ? null : (respondentId || (invitation && invitation.respondent_id) || null),
      ipHash, distritoId || null, departamentoId || null,
      survey.one_per_device ? device : null, invitation ? invitation.id : null, campaignId,
      version ? version.id : null, version ? version.number : null
    );

    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    answers.forEach(a => {
      const isNum = typeof a.value === 'number';
      // Matriz e bloco de formulário chegam como objeto; múltipla escolha como array.
      const isJson = Array.isArray(a.value) || (a.value !== null && typeof a.value === 'object');
      stmt.run(uuid(), responseId, a.questionId,
        !isNum && !isJson ? String(a.value) : null,
        isNum            ? a.value : null,
        isJson           ? JSON.stringify(a.value) : null
      );
    });

    db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    if (invitation) db.prepare("UPDATE invitations SET responded_at=datetime('now'), status='respondido' WHERE id=?").run(invitation.id);
    try { require('../utils/push').notifyNewResponse(db, survey.id).catch(() => {}); } catch {}
    return ok(res, { responseId }, 'Resposta registrada com sucesso. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar resposta', 500, e.message); }
}

module.exports = { getPublic, submitPublic };
