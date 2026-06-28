'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');

/* GET /public/survey/:token  — get survey by public token (no auth) */
function getPublic(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare("SELECT id, name, name_en, name_es, description, description_en, description_es, category, anonymous, status, deadline FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    const closed = survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now());
    if (closed) return ok(res, { closed: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Pesquisa encerrada');
    const questions = db.prepare('SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const parsed    = questions.map(q => ({ ...q, options: PJ(q.options), options_en: PJ(q.options_en), options_es: PJ(q.options_es) }));
    const { status, deadline, ...pub } = survey;
    return ok(res, { survey: pub, questions: parsed });
  } catch (e) { return err(res, 'Erro ao carregar pesquisa', 500, e.message); }
}

/* POST /public/survey/:token  — submit response (no auth) */
function submitPublic(req, res) {
  try {
    const { answers, respondentId } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');

    const db     = getDB();
    const survey = db.prepare("SELECT id, anonymous, status, deadline FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    if (survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now()))
      return badReq(res, 'Esta pesquisa está encerrada e não aceita mais respostas.');

    const responseId = uuid();
    const ipHash     = hashIP(req.ip || '');

    db.prepare('INSERT INTO responses (id, survey_id, respondent_id, ip_hash) VALUES (?,?,?,?)').run(
      responseId, survey.id, survey.anonymous ? null : (respondentId || null), ipHash
    );

    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    answers.forEach(a => {
      const isNum = typeof a.value === 'number';
      const isArr = Array.isArray(a.value);
      stmt.run(uuid(), responseId, a.questionId,
        !isNum && !isArr ? String(a.value) : null,
        isNum            ? a.value : null,
        isArr            ? JSON.stringify(a.value) : null
      );
    });

    db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    try { require('../utils/push').notifyNewResponse(db, survey.id).catch(() => {}); } catch {}
    return ok(res, { responseId }, 'Resposta registrada com sucesso. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar resposta', 500, e.message); }
}

module.exports = { getPublic, submitPublic };
