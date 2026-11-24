'use strict';
const { v4: uuid } = require('uuid');
const { getDB } = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');

const TAXONOMIAS = ['clima', 'hse'];

/* Padrão HSE Management Standards — as 7 dimensões reconhecidas internacionalmente.
   Serve como ponto de partida; os nomes podem ser renomeados depois. */
const HSE_PADRAO = [
  'Demandas', 'Controle', 'Apoio da chefia', 'Apoio dos colegas',
  'Relacionamentos', 'Clareza de papel', 'Mudança',
];

const norm = s => String(s || '').trim();

/* Acha a dimensão pelo nome (sem diferenciar maiúsculas) ou cria. Usado pela importação. */
function ensureDimensao(db, tenantId, taxonomia, name) {
  const nome = norm(name);
  if (!nome) return null;
  const tax = TAXONOMIAS.includes(String(taxonomia).toLowerCase()) ? String(taxonomia).toLowerCase() : 'clima';
  const achou = db.prepare('SELECT id FROM dimensoes WHERE tenant_id=? AND taxonomia=? AND LOWER(name)=LOWER(?)').get(tenantId, tax, nome);
  if (achou) return achou.id;
  const id = uuid();
  const prox = db.prepare('SELECT IFNULL(MAX(ordem),0)+1 n FROM dimensoes WHERE tenant_id=? AND taxonomia=?').get(tenantId, tax).n;
  db.prepare('INSERT INTO dimensoes (id, tenant_id, taxonomia, name, ordem) VALUES (?,?,?,?,?)').run(id, tenantId, tax, nome, prox);
  return id;
}

/* Liga uma pergunta às dimensões informadas. Aceita { clima: [...], hse: [...] }. */
function linkQuestionDimensoes(db, tenantId, questionId, dims) {
  if (!dims || typeof dims !== 'object') return;
  const ins = db.prepare('INSERT OR IGNORE INTO question_dimensoes (question_id, dimensao_id) VALUES (?,?)');
  TAXONOMIAS.forEach(tax => {
    const lista = Array.isArray(dims[tax]) ? dims[tax] : (dims[tax] ? [dims[tax]] : []);
    lista.forEach(nome => { const id = ensureDimensao(db, tenantId, tax, nome); if (id) ins.run(questionId, id); });
  });
}

/* GET /dimensoes */
function list(req, res) {
  try {
    const db = getDB();
    const rows = db.prepare(`
      SELECT d.*, (SELECT COUNT(*) FROM question_dimensoes qd WHERE qd.dimensao_id = d.id) AS perguntas
      FROM dimensoes d WHERE d.tenant_id = ? ORDER BY d.taxonomia, d.ordem, d.name
    `).all(req.user.tenant_id);
    const out = { clima: [], hse: [] };
    rows.forEach(r => { (out[r.taxonomia] || out.clima).push(r); });
    return ok(res, out);
  } catch (e) { return err(res, 'Erro ao listar dimensões', 500, e.message); }
}

/* POST /dimensoes */
function create(req, res) {
  try {
    const { name, taxonomia } = req.body;
    if (!norm(name)) return badReq(res, 'Nome da dimensão é obrigatório');
    const db = getDB();
    const id = ensureDimensao(db, req.user.tenant_id, taxonomia, name);
    return created(res, { dimensao: db.prepare('SELECT * FROM dimensoes WHERE id=?').get(id) }, 'Dimensão criada');
  } catch (e) { return err(res, 'Erro ao criar dimensão', 500, e.message); }
}

/* PUT /dimensoes/:id — renomear ou reordenar */
function update(req, res) {
  try {
    const db = getDB();
    const d = db.prepare('SELECT * FROM dimensoes WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!d) return notFound(res, 'Dimensão');
    const name  = req.body.name != null ? norm(req.body.name) : d.name;
    const ordem = req.body.ordem != null ? Number(req.body.ordem) : d.ordem;
    if (!name) return badReq(res, 'Nome da dimensão é obrigatório');
    db.prepare('UPDATE dimensoes SET name=?, ordem=? WHERE id=?').run(name, ordem, req.params.id);
    return ok(res, { dimensao: db.prepare('SELECT * FROM dimensoes WHERE id=?').get(req.params.id) }, 'Dimensão atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar dimensão', 500, e.message); }
}

/* DELETE /dimensoes/:id — remove a dimensão e os vínculos; as perguntas ficam intactas */
function remove(req, res) {
  try {
    const db = getDB();
    const d = db.prepare('SELECT id FROM dimensoes WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!d) return notFound(res, 'Dimensão');
    db.prepare('DELETE FROM question_dimensoes WHERE dimensao_id=?').run(req.params.id);
    db.prepare('DELETE FROM dimensoes WHERE id=?').run(req.params.id);
    return ok(res, {}, 'Dimensão removida');
  } catch (e) { return err(res, 'Erro ao remover dimensão', 500, e.message); }
}

/* POST /dimensoes/hse-padrao — carrega as 7 do padrão HSE Management Standards */
function seedHse(req, res) {
  try {
    const db = getDB();
    const ids = HSE_PADRAO.map(n => ensureDimensao(db, req.user.tenant_id, 'hse', n));
    return created(res, { total: ids.filter(Boolean).length }, 'Dimensões HSE carregadas');
  } catch (e) { return err(res, 'Erro ao carregar o padrão HSE', 500, e.message); }
}

/* GET /dimensoes/survey/:surveyId — o vínculo pergunta → dimensões de uma pesquisa */
function bySurvey(req, res) {
  try {
    const db = getDB();
    const rows = db.prepare(`
      SELECT qd.question_id, d.id, d.name, d.taxonomia
      FROM question_dimensoes qd JOIN dimensoes d ON d.id = qd.dimensao_id
      JOIN questions q ON q.id = qd.question_id
      WHERE q.survey_id = ? AND d.tenant_id = ?
    `).all(req.params.surveyId, req.user.tenant_id);
    const map = {};
    rows.forEach(r => { (map[r.question_id] = map[r.question_id] || []).push({ id: r.id, name: r.name, taxonomia: r.taxonomia }); });
    return ok(res, { porPergunta: map });
  } catch (e) { return err(res, 'Erro ao carregar dimensões da pesquisa', 500, e.message); }
}

/* PUT /dimensoes/question/:questionId — troca as dimensões de uma pergunta */
function setForQuestion(req, res) {
  try {
    const db = getDB();
    const q = db.prepare('SELECT q.id FROM questions q JOIN surveys s ON s.id=q.survey_id WHERE q.id=? AND s.tenant_id=?').get(req.params.questionId, req.user.tenant_id);
    if (!q) return notFound(res, 'Pergunta');
    db.prepare('DELETE FROM question_dimensoes WHERE question_id=?').run(req.params.questionId);
    linkQuestionDimensoes(db, req.user.tenant_id, req.params.questionId, req.body.dimensoes || {});
    return ok(res, {}, 'Dimensões da pergunta atualizadas');
  } catch (e) { return err(res, 'Erro ao vincular dimensões', 500, e.message); }
}

module.exports = { list, create, update, remove, seedHse, bySurvey, setForQuestion, ensureDimensao, linkQuestionDimensoes, TAXONOMIAS, HSE_PADRAO };
