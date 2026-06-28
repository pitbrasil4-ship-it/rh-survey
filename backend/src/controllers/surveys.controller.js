'use strict';
const { v4: uuid }   = require('uuid');
const { getDB }      = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const logger         = require('../utils/logger');
const { translateSurvey, aiEnabled } = require('../utils/translate');

// Grava no banco as traduções (EN/ES) de uma pesquisa já criada e suas perguntas.
function applyTranslation(db, surveyId, qIds, tr) {
  const Js = a => (Array.isArray(a) && a.length) ? JSON.stringify(a) : null;
  db.prepare('UPDATE surveys SET name_en=?, name_es=?, description_en=?, description_es=? WHERE id=?')
    .run(tr.name_en || null, tr.name_es || null, tr.description_en || null, tr.description_es || null, surveyId);
  if (Array.isArray(tr.questions)) {
    const us = db.prepare('UPDATE questions SET text_en=?, text_es=?, options_en=?, options_es=? WHERE id=?');
    tr.questions.forEach((q, i) => {
      const qid = qIds[i];
      if (!qid) return;
      us.run(q.text_en || null, q.text_es || null, Js(q.options_en), Js(q.options_es), qid);
    });
  }
}

/* GET /surveys */
function list(req, res) {
  try {
    const db      = getDB();
    const surveys = db.prepare(`
      SELECT s.*, u.name as created_by_name,
             (SELECT COUNT(*) FROM questions WHERE survey_id = s.id) as question_count,
             (SELECT COUNT(*) FROM responses WHERE survey_id = s.id AND completed_at IS NOT NULL) as response_count
      FROM surveys s LEFT JOIN users u ON s.created_by_id = u.id
      WHERE s.tenant_id = ? AND s.status != 'excluido' ORDER BY s.created_at DESC
    `).all(req.user.tenant_id);
    return ok(res, { surveys, total: surveys.length });
  } catch (e) { return err(res, 'Erro ao listar pesquisas', 500, e.message); }
}

/* POST /surveys */
async function create(req, res) {
  try {
    const { name, description, category, targetGroup, anonymous, deadline, questions = [], lgpdBasis } = req.body;
    if (!name) return badReq(res, 'Nome da pesquisa é obrigatório');

    const db       = getDB();
    const surveyId = uuid();
    db.prepare(`INSERT INTO surveys (id, tenant_id, created_by_id, name, description, category, target_group, anonymous, deadline, lgpd_basis, public_token)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      surveyId, req.user.tenant_id, req.user.id,
      name, description || null, category || null,
      targetGroup || null, anonymous !== false ? 1 : 0,
      deadline || null, lgpdBasis || 'consentimento', uuid()
    );

    const qIds = [];
    if (questions.length > 0) {
      const stmt = db.prepare('INSERT INTO questions (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es) VALUES (?,?,?,?,?,?,?,?,?,?)');
      const J = a => (Array.isArray(a) && a.length) ? JSON.stringify(a) : null;
      questions.forEach((q, i) => {
        const qid = uuid(); qIds.push(qid);
        stmt.run(qid, surveyId, i+1, q.type, q.text, q.text_en || null, q.text_es || null, J(q.options), J(q.options_en), J(q.options_es));
      });
    }

    // Tradução automática (IA) do conteúdo para EN/ES ao salvar.
    // Não bloqueia nem invalida a criação se a IA estiver em modo demo ou falhar.
    try {
      const tr = await translateSurvey({ name, description, questions: questions.map(q => ({ text: q.text, options: q.options })) });
      if (tr) applyTranslation(db, surveyId, qIds, tr);
    } catch (e) { logger.warn('Tradução automática falhou na criação da pesquisa: ' + e.message); }

    const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
    return created(res, { survey }, 'Pesquisa criada com sucesso');
  } catch (e) { return err(res, 'Erro ao criar pesquisa', 500, e.message); }
}

/* POST /surveys/:id/translate — (re)gera as traduções EN/ES com IA para uma pesquisa existente */
async function translateExisting(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    if (!aiEnabled()) return ok(res, { translated: false, demo: true }, 'IA em modo demo — configure ANTHROPIC_API_KEY para traduzir automaticamente.');

    const rows = db.prepare('SELECT id, text, options FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const PJ   = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const qIds = rows.map(r => r.id);
    const questions = rows.map(r => ({ text: r.text, options: PJ(r.options) }));

    const tr = await translateSurvey({ name: survey.name, description: survey.description, questions });
    if (!tr) return err(res, 'Não foi possível gerar a tradução agora. Tente novamente.', 502);
    applyTranslation(db, survey.id, qIds, tr);
    return ok(res, { translated: true }, 'Pesquisa traduzida para EN/ES com IA');
  } catch (e) { return err(res, 'Erro ao traduzir pesquisa', 500, e.message); }
}

/* GET /surveys/:id */
function getOne(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    return ok(res, { survey, questions });
  } catch (e) { return err(res, 'Erro ao buscar pesquisa', 500, e.message); }
}

/* PUT /surveys/:id */
function update(req, res) {
  try {
    const db     = getDB();
    // Fetch full row so omitted fields are preserved (PATCH semantics) and
    // no undefined is ever bound — node:sqlite rejects undefined parameters.
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    const { name, description, category, targetGroup, anonymous, deadline, status } = req.body;
    db.prepare(`UPDATE surveys SET name=?, description=?, category=?, target_group=?, anonymous=?, deadline=?, status=? WHERE id=?`).run(
      name        ?? survey.name,
      description ?? survey.description,
      category    ?? survey.category,
      targetGroup ?? survey.target_group,
      anonymous === undefined ? survey.anonymous : (anonymous ? 1 : 0),
      deadline    ?? survey.deadline,
      status      ?? survey.status,
      req.params.id
    );
    return ok(res, { id: req.params.id }, 'Pesquisa atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar pesquisa', 500, e.message); }
}

/* POST /surveys/:id/publish */
function publish(req, res) {
  try {
    const db = getDB();
    db.prepare("UPDATE surveys SET status='ativo', published_at=datetime('now') WHERE id=? AND tenant_id=?").run(req.params.id, req.user.tenant_id);
    const survey = db.prepare('SELECT public_token FROM surveys WHERE id=?').get(req.params.id);
    return ok(res, { publicLink: `/public/survey/${survey?.public_token}` }, 'Pesquisa publicada');
  } catch (e) { return err(res, 'Erro ao publicar pesquisa', 500, e.message); }
}

/* DELETE /surveys/:id */
function remove(req, res) {
  try {
    const db = getDB();
    db.prepare("UPDATE surveys SET status='excluido' WHERE id=? AND tenant_id=?").run(req.params.id, req.user.tenant_id);
    return ok(res, {}, 'Pesquisa removida');
  } catch (e) { return err(res, 'Erro ao remover pesquisa', 500, e.message); }
}

/* POST /surveys/generate-ai  — calls Anthropic API */
async function generateAI(req, res) {
  try {
    const { context } = req.body;
    if (!context) return badReq(res, 'Contexto da pesquisa é obrigatório');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your-anthropic-key-here') {
      // Return demo questions if no API key
      return ok(res, { questions: [
        { type:'nps',   text:'De 0 a 10, qual a probabilidade de você recomendar este gestor a um colega?' },
        { type:'scale', text:'Como você avalia a capacidade de comunicação deste gestor?' },
        { type:'rating',text:'Avalie a liderança e motivação da equipe por este gestor.' },
        { type:'text',  text:'Descreva uma situação em que este gestor demonstrou liderança exemplar.' },
        { type:'yesno', text:'Você se sente apoiado e ouvido por este gestor?' },
      ]}, 'Perguntas geradas (modo demo — configure ANTHROPIC_API_KEY para IA real)');
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key': apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model:'claude-sonnet-4-6', max_tokens:1000,
        messages:[{ role:'user', content:`Gere 6 perguntas de avaliação de RH para: "${context}". Retorne APENAS JSON: [{"text":"...","type":"nps|scale|multiple|text|rating|yesno"}]` }]
      })
    });
    const data      = await resp.json();
    const raw       = (data.content?.[0]?.text || '[]').replace(/\`\`\`json|\`\`\`/g,'').trim();
    const questions = JSON.parse(raw);
    return ok(res, { questions }, `${questions.length} perguntas geradas com IA`);
  } catch (e) { return err(res, 'Erro ao gerar perguntas', 500, e.message); }
}

module.exports = { list, create, getOne, update, publish, remove, generateAI, translateExisting };
