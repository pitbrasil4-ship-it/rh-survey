'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');

const RELS = ['auto', 'gestor', 'par', 'subordinado'];

/* POST /eval/cycles  { name, surveyId } */
function createCycle(req, res) {
  try {
    const { name, surveyId } = req.body;
    if (!name || !surveyId) return badReq(res, 'Nome do ciclo e questionário são obrigatórios');
    const db = getDB();
    const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND tenant_id=?').get(surveyId, req.user.tenant_id);
    if (!survey) return badReq(res, 'Questionário inválido');
    const id = uuid();
    db.prepare("INSERT INTO eval_cycles (id, tenant_id, name, survey_id) VALUES (?,?,?,?)").run(id, req.user.tenant_id, name, surveyId);
    const cycle = db.prepare('SELECT * FROM eval_cycles WHERE id=?').get(id);
    return created(res, { cycle }, 'Ciclo de avaliação criado');
  } catch (e) { return err(res, 'Erro ao criar ciclo', 500, e.message); }
}

/* GET /eval/cycles  — lista com progresso */
function listCycles(req, res) {
  try {
    const db = getDB();
    const cycles = db.prepare(`
      SELECT c.*, s.name AS survey_name,
        (SELECT COUNT(*) FROM eval_assignments WHERE cycle_id=c.id) AS total_assignments,
        (SELECT COUNT(*) FROM eval_assignments WHERE cycle_id=c.id AND completed=1) AS completed_assignments,
        (SELECT COUNT(DISTINCT subject_id) FROM eval_assignments WHERE cycle_id=c.id) AS subjects
      FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id
      WHERE c.tenant_id=? ORDER BY c.created_at DESC
    `).all(req.user.tenant_id);
    return ok(res, { cycles });
  } catch (e) { return err(res, 'Erro ao listar ciclos', 500, e.message); }
}

/* GET /eval/cycles/:id — detalhe com avaliadores */
function getCycle(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const assignments = db.prepare(`
      SELECT a.id, a.subject_id, a.relationship, a.evaluator_name, a.evaluator_email, a.token, a.completed, a.created_at,
             r.name AS subject_name
      FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id
      WHERE a.cycle_id=? ORDER BY r.name, a.created_at
    `).all(req.params.id);
    return ok(res, { cycle, assignments });
  } catch (e) { return err(res, 'Erro ao carregar ciclo', 500, e.message); }
}

/* POST /eval/cycles/:id/assignments  { subjectId, relationship, evaluatorName, evaluatorEmail } */
function addAssignment(req, res) {
  try {
    const { subjectId, relationship, evaluatorName, evaluatorEmail } = req.body;
    if (!subjectId || !relationship) return badReq(res, 'Avaliado e tipo de relação são obrigatórios');
    if (!RELS.includes(relationship)) return badReq(res, 'Relação inválida (use: auto, gestor, par, subordinado)');
    const db = getDB();
    const cycle = db.prepare('SELECT id FROM eval_cycles WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');
    const subject = db.prepare('SELECT id FROM respondents WHERE id=? AND tenant_id=?').get(subjectId, req.user.tenant_id);
    if (!subject) return badReq(res, 'Avaliado inválido');
    const id = uuid(); const token = uuid();
    db.prepare("INSERT INTO eval_assignments (id, cycle_id, subject_id, relationship, evaluator_name, evaluator_email, token) VALUES (?,?,?,?,?,?,?)")
      .run(id, req.params.id, subjectId, relationship, evaluatorName || null, evaluatorEmail || null, token);
    const assignment = db.prepare(`SELECT a.*, r.name AS subject_name FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id WHERE a.id=?`).get(id);
    return created(res, { assignment }, 'Avaliador atribuído');
  } catch (e) { return err(res, 'Erro ao atribuir avaliador', 500, e.message); }
}

/* DELETE /eval/assignments/:id */
function removeAssignment(req, res) {
  try {
    const db = getDB();
    // garante que pertence a um ciclo do tenant
    const a = db.prepare(`SELECT a.id FROM eval_assignments a JOIN eval_cycles c ON a.cycle_id=c.id WHERE a.id=? AND c.tenant_id=?`).get(req.params.id, req.user.tenant_id);
    if (!a) return notFound(res, 'Atribuição');
    db.prepare('DELETE FROM eval_assignments WHERE id=?').run(req.params.id);
    return ok(res, {}, 'Atribuição removida');
  } catch (e) { return err(res, 'Erro ao remover atribuição', 500, e.message); }
}

/* GET /eval/results/:cycleId — matriz 360 (scores normalizados 0–100 por relação) */
function results(req, res) {
  try {
    const db = getDB();
    const cycle = db.prepare(`SELECT c.*, s.name AS survey_name FROM eval_cycles c LEFT JOIN surveys s ON c.survey_id=s.id WHERE c.id=? AND c.tenant_id=?`).get(req.params.cycleId, req.user.tenant_id);
    if (!cycle) return notFound(res, 'Ciclo');

    // mapa de tipos para normalização
    const questions = db.prepare('SELECT id, type, options FROM questions WHERE survey_id=?').all(cycle.survey_id);
    const qMax = {};
    questions.forEach(q => {
      let max = 5;
      if (q.type === 'nps') max = 10;
      else if (q.type === 'scale' && q.options) { try { max = JSON.parse(q.options).length || 5; } catch {} }
      else if (q.type === 'rating') max = 5;
      qMax[q.id] = max;
    });

    const subjects = db.prepare(`
      SELECT DISTINCT a.subject_id AS id, r.name
      FROM eval_assignments a LEFT JOIN respondents r ON a.subject_id=r.id
      WHERE a.cycle_id=? ORDER BY r.name
    `).all(req.params.cycleId);

    const matrix = subjects.map(sub => {
      const row = { subjectId: sub.id, subjectName: sub.name || '—' };
      const allNorm = [];
      RELS.forEach(rel => {
        const rows = db.prepare(`
          SELECT an.value_num, an.question_id
          FROM answers an
          JOIN responses rp ON an.response_id=rp.id
          WHERE rp.survey_id=? AND rp.subject_id=? AND rp.relationship=? AND rp.completed_at IS NOT NULL AND an.value_num IS NOT NULL
        `).all(cycle.survey_id, sub.id, rel);
        const norm = rows.map(x => (qMax[x.question_id] ? (x.value_num / qMax[x.question_id]) * 100 : null)).filter(v => v !== null);
        const avg = norm.length ? Math.round(norm.reduce((a, b) => a + b, 0) / norm.length) : null;
        row[rel] = avg;
        if (norm.length) allNorm.push(...norm);
      });
      row.overall = allNorm.length ? Math.round(allNorm.reduce((a, b) => a + b, 0) / allNorm.length) : null;
      return row;
    });
    return ok(res, { cycle, matrix, relationships: RELS });
  } catch (e) { return err(res, 'Erro ao calcular resultados 360', 500, e.message); }
}

/* ───────── PÚBLICO (sem auth) — o avaliador responde ───────── */

/* GET /public/eval/:token */
function getEvalPublic(req, res) {
  try {
    const db = getDB();
    const a = db.prepare(`
      SELECT a.relationship, a.completed, a.subject_id,
             r.name AS subject_name, c.name AS cycle_name, c.survey_id, c.status AS cycle_status
      FROM eval_assignments a
      LEFT JOIN respondents r ON a.subject_id=r.id
      LEFT JOIN eval_cycles c ON a.cycle_id=c.id
      WHERE a.token=?
    `).get(req.params.token);
    if (!a || a.cycle_status !== 'ativo') return notFound(res, 'Avaliação');
    if (a.completed) return ok(res, { alreadyDone: true, subjectName: a.subject_name, relationship: a.relationship, cycleName: a.cycle_name });
    const questions = db.prepare('SELECT id, order_num, type, text, options FROM questions WHERE survey_id=? ORDER BY order_num').all(a.survey_id);
    const parsed = questions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : null }));
    return ok(res, { subjectName: a.subject_name, relationship: a.relationship, cycleName: a.cycle_name, questions: parsed });
  } catch (e) { return err(res, 'Erro ao carregar avaliação', 500, e.message); }
}

/* POST /public/eval/:token  { answers } */
function submitEvalPublic(req, res) {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');
    const db = getDB();
    const a = db.prepare(`SELECT a.id, a.subject_id, a.relationship, a.completed, c.survey_id, c.status AS cycle_status FROM eval_assignments a LEFT JOIN eval_cycles c ON a.cycle_id=c.id WHERE a.token=?`).get(req.params.token);
    if (!a || a.cycle_status !== 'ativo') return notFound(res, 'Avaliação');
    if (a.completed) return badReq(res, 'Esta avaliação já foi respondida');

    const responseId = uuid();
    db.prepare('INSERT INTO responses (id, survey_id, respondent_id, ip_hash, subject_id, relationship) VALUES (?,?,?,?,?,?)')
      .run(responseId, a.survey_id, null, hashIP(req.ip || ''), a.subject_id, a.relationship);
    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    answers.forEach(ans => {
      const isNum = typeof ans.value === 'number';
      const isArr = Array.isArray(ans.value);
      stmt.run(uuid(), responseId, ans.questionId,
        !isNum && !isArr ? String(ans.value) : null,
        isNum ? ans.value : null,
        isArr ? JSON.stringify(ans.value) : null);
    });
    db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    db.prepare("UPDATE eval_assignments SET completed=1 WHERE id=?").run(a.id);
    return ok(res, { responseId }, 'Avaliação registrada. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar avaliação', 500, e.message); }
}

module.exports = { createCycle, listCycles, getCycle, addAssignment, removeAssignment, results, getEvalPublic, submitEvalPublic };
