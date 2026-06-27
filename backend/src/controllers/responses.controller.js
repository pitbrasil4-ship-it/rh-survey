'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');

/* GET /public/survey/:token  — get survey by public token (no auth) */
function getPublic(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare("SELECT id, name, description, category, anonymous FROM surveys WHERE public_token = ? AND status = 'ativo'").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    const questions = db.prepare('SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const parsed    = questions.map(q => ({ ...q, options: PJ(q.options), options_en: PJ(q.options_en), options_es: PJ(q.options_es) }));
    return ok(res, { survey, questions: parsed });
  } catch (e) { return err(res, 'Erro ao carregar pesquisa', 500, e.message); }
}

/* POST /public/survey/:token  — submit response (no auth) */
function submitPublic(req, res) {
  try {
    const { answers, respondentId } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');

    const db     = getDB();
    const survey = db.prepare("SELECT id, anonymous FROM surveys WHERE public_token = ? AND status = 'ativo'").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');

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
    return ok(res, { responseId }, 'Resposta registrada com sucesso. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar resposta', 500, e.message); }
}

module.exports = { getPublic, submitPublic };
