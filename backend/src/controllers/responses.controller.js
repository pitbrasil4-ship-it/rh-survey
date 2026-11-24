'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');

/* GET /public/survey/:token  — get survey by public token (no auth) */
function getPublic(req, res) {
  try {
    const db     = getDB();
    const link   = db.prepare("SELECT survey_id FROM survey_links WHERE token = ?").get(req.params.token);
    const survey = link
      ? db.prepare("SELECT id, name, name_en, name_es, description, description_en, description_es, category, anonymous, status, deadline FROM surveys WHERE id = ?").get(link.survey_id)
      : db.prepare("SELECT id, name, name_en, name_es, description, description_en, description_es, category, anonymous, status, deadline FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    const closed = survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now());
    if (closed) return ok(res, { closed: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Pesquisa encerrada');
    const questions = db.prepare('SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es, single_choice, rows_json, neutral_idx FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const parsed    = questions.map(q => ({ ...q, options: PJ(q.options), options_en: PJ(q.options_en), options_es: PJ(q.options_es), singleChoice: !!q.single_choice, rows: PJ(q.rows_json), neutralIdx: PJ(q.neutral_idx) }));
    const { status, deadline, ...pub } = survey;
    return ok(res, { survey: pub, questions: parsed });
  } catch (e) { return err(res, 'Erro ao carregar pesquisa', 500, e.message); }
}

/* POST /public/survey/:token  — submit response (no auth) */
function submitPublic(req, res) {
  try {
    const { answers, respondentId, clientId, distrito, departamento, modalidade } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');

    const db     = getDB();
    const link   = db.prepare("SELECT survey_id, distrito_id, departamento_id FROM survey_links WHERE token = ?").get(req.params.token);
    const survey = link
      ? db.prepare("SELECT id, anonymous, status, deadline, IFNULL(version,1) version FROM surveys WHERE id = ?").get(link.survey_id)
      : db.prepare("SELECT id, anonymous, status, deadline, IFNULL(version,1) version FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    if (survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now()))
      return badReq(res, 'Esta pesquisa está encerrada e não aceita mais respostas.');

    // Uma resposta por navegador: o aparelho manda um identificador próprio e o servidor
    // recusa a segunda tentativa na mesma pesquisa. Não bloqueia colegas na mesma rede.
    const cid = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim().slice(0, 64) : null;
    if (cid) {
      const already = db.prepare('SELECT id FROM responses WHERE survey_id = ? AND client_id = ?').get(survey.id, cid);
      if (already) return badReq(res, 'Esta pesquisa já foi respondida neste dispositivo.');
    }

    const responseId = uuid();
    const ipHash     = hashIP(req.ip || '');
    // Segmento: o link de segmento manda; na falta dele, aceita o que veio no endereço (?distrito=).
    const resolveSeg = (table, val) => {
      if (!val || typeof val !== 'string') return null;
      const v = val.trim(); if (!v) return null;
      const byId = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND tenant_id = (SELECT tenant_id FROM surveys WHERE id = ?)`).get(v, survey.id);
      if (byId) return byId.id;
      const byName = db.prepare(`SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) AND tenant_id = (SELECT tenant_id FROM surveys WHERE id = ?)`).get(v, survey.id);
      return byName ? byName.id : null;
    };
    const distritoId     = (link && link.distrito_id)     || resolveSeg('distritos', distrito)        || null;
    const departamentoId = (link && link.departamento_id) || resolveSeg('departamentos', departamento) || null;

    db.prepare('INSERT INTO responses (id, survey_id, respondent_id, ip_hash, distrito_id, departamento_id, client_id, modalidade, survey_version) VALUES (?,?,?,?,?,?,?,?,?)').run(
      responseId, survey.id, survey.anonymous ? null : (respondentId || null), ipHash, distritoId, departamentoId, cid,
      (typeof modalidade === 'string' && modalidade.trim()) ? modalidade.trim().slice(0, 60) : null,
      survey.version || 1
    );

    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    answers.forEach(a => {
      const isNum = typeof a.value === 'number';
      // Lista (múltipla, ordenação) e objeto (matriz) vão inteiros para value_json.
      const isEstruturado = a.value !== null && typeof a.value === 'object';
      stmt.run(uuid(), responseId, a.questionId,
        (!isNum && !isEstruturado) ? String(a.value) : null,
        isNum          ? a.value : null,
        isEstruturado  ? JSON.stringify(a.value) : null
      );
    });

    db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    try { require('../utils/push').notifyNewResponse(db, survey.id).catch(() => {}); } catch {}
    return ok(res, { responseId }, 'Resposta registrada com sucesso. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar resposta', 500, e.message); }
}

module.exports = { getPublic, submitPublic };
