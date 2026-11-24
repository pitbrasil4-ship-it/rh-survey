'use strict';
const { v4: uuid }   = require('uuid');
const { getDB }      = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const logger         = require('../utils/logger');
const { linkQuestionDimensoes } = require('./dimensoes.controller');
const { diffQuestions, respostasDe, logChange, bumpVersion } = require('../utils/versioning');
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
      const stmt = db.prepare('INSERT INTO questions (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es, option_points, single_choice, text_self, rows_json, neutral_idx, page_break, logic, jump) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const J = a => (Array.isArray(a) && a.length) ? JSON.stringify(a) : null;
      questions.forEach((q, i) => {
        const qid = uuid(); qIds.push(qid);
        stmt.run(qid, surveyId, i+1, q.type, q.text, q.text_en || null, q.text_es || null, J(q.options), J(q.options_en), J(q.options_es),
          (Array.isArray(q.option_points) && q.option_points.length) ? JSON.stringify(q.option_points.map(n => Number(n) || 0)) : null,
          q.singleChoice ? 1 : 0, q.text_self || null, J(q.rows), J(q.neutralIdx),
          q.pageBreak ? 1 : 0, q.logic ? JSON.stringify(q.logic) : null, J(q.jump));
        // Dimensões vindas da planilha ou do construtor: { clima: [...], hse: [...] }
        if (q.dimensoes) { try { linkQuestionDimensoes(db, req.user.tenant_id, qid, q.dimensoes); } catch (e) { logger.warn('Vínculo de dimensão falhou: ' + e.message); } }
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

/* PUT /surveys/:id/questions — edita o questionário de uma pesquisa, inclusive publicada.
   Com respostas na base, alterações que mudam o significado exigem { confirm: true }. */
function updateQuestions(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    const brutas = Array.isArray(req.body.questions) ? req.body.questions : null;
    if (!brutas || !brutas.length) return badReq(res, 'Informe as perguntas');
    // A API devolve opções como texto JSON e o construtor manda lista: aceita as duas formas.
    const comoLista = v => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null; } catch { return null; } } return null; };
    const novas = brutas.map(q => ({ ...q,
      options: comoLista(q.options), options_en: comoLista(q.options_en), options_es: comoLista(q.options_es),
      option_points: comoLista(q.option_points), rows: comoLista(q.rows), neutralIdx: comoLista(q.neutralIdx), jump: comoLista(q.jump),
      logic: (q.logic && typeof q.logic === 'string') ? (() => { try { return JSON.parse(q.logic); } catch { return null; } })() : q.logic }));

    const atuais = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(survey.id);
    const { quebras, seguras } = diffQuestions(atuais, novas);
    const respostas = respostasDe(db, survey.id);

    // Com respostas na base e alteração que quebra, só segue com confirmação explícita.
    if (respostas > 0 && quebras.length && !req.body.confirm) {
      return ok(res, { precisaConfirmar: true, respostas, quebras, seguras, versaoAtual: survey.version || 1 },
        'Esta alteração muda o significado de perguntas que já foram respondidas.');
    }

    let versao = survey.version || 1;
    db.exec('BEGIN');
    try {
      if (respostas > 0 && quebras.length) versao = bumpVersion(db, survey.id, req.user);

      const J = a => (Array.isArray(a) && a.length) ? JSON.stringify(a) : null;
      const manter = new Set(novas.filter(q => q.id).map(q => q.id));
      // Remove as perguntas que saíram (as respostas antigas continuam na versão guardada).
      atuais.forEach(q => { if (!manter.has(q.id)) {
        db.prepare('DELETE FROM question_dimensoes WHERE question_id=?').run(q.id);
        db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
      } });

      const upd = db.prepare(`UPDATE questions SET order_num=?, type=?, text=?, text_en=?, text_es=?, options=?, options_en=?, options_es=?,
        option_points=?, single_choice=?, text_self=?, rows_json=?, neutral_idx=?, page_break=?, logic=?, jump=? WHERE id=?`);
      const ins = db.prepare(`INSERT INTO questions (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es, option_points, single_choice, text_self, rows_json, neutral_idx, page_break, logic, jump)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

      novas.forEach((q, i) => {
        const pts = (Array.isArray(q.option_points) && q.option_points.length) ? JSON.stringify(q.option_points.map(n => Number(n) || 0)) : null;
        let qid = q.id;
        if (qid && atuais.some(a => a.id === qid)) {
          upd.run(i + 1, q.type, q.text, q.text_en || null, q.text_es || null, J(q.options), J(q.options_en), J(q.options_es), pts, q.singleChoice ? 1 : 0, q.text_self || null, J(q.rows), J(q.neutralIdx), q.pageBreak ? 1 : 0, q.logic ? JSON.stringify(q.logic) : null, J(q.jump), qid);
        } else {
          qid = uuid();
          ins.run(qid, survey.id, i + 1, q.type, q.text, q.text_en || null, q.text_es || null, J(q.options), J(q.options_en), J(q.options_es), pts, q.singleChoice ? 1 : 0, q.text_self || null, J(q.rows), J(q.neutralIdx),
          q.pageBreak ? 1 : 0, q.logic ? JSON.stringify(q.logic) : null, J(q.jump));
        }
        if (q.dimensoes) {
          db.prepare('DELETE FROM question_dimensoes WHERE question_id=?').run(qid);
          try { linkQuestionDimensoes(db, req.user.tenant_id, qid, q.dimensoes); } catch (e) { logger.warn('Vínculo de dimensão: ' + e.message); }
        }
      });

      logChange(db, { surveyId: survey.id, version: versao, user: req.user, action: 'questionario_editado',
        detail: { quebras: quebras.length, seguras: seguras.length, respostasNaEpoca: respostas, itens: [...quebras, ...seguras].slice(0, 40) } });
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }

    const atualizada = db.prepare('SELECT * FROM surveys WHERE id=?').get(survey.id);
    return ok(res, { survey: atualizada, versao, quebras: quebras.length, seguras: seguras.length }, 'Questionário atualizado');
  } catch (e) { return err(res, 'Erro ao editar o questionário', 500, e.message); }
}

/* POST /surveys/:id/duplicate — cria uma cópia em rascunho, com as perguntas e as dimensões */
function duplicate(req, res) {
  try {
    const db = getDB();
    const origem = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!origem) return notFound(res, 'Pesquisa');
    const questions = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(origem.id);
    const novoId = uuid();
    const nome = (req.body && req.body.name) ? String(req.body.name).trim() : `${origem.name} (cópia)`;

    db.exec('BEGIN');
    try {
      db.prepare(`INSERT INTO surveys (id, tenant_id, created_by_id, name, description, category, target_group, anonymous, lgpd_basis, public_token, status, version)
                  VALUES (?,?,?,?,?,?,?,?,?,?, 'rascunho', 1)`)
        .run(novoId, origem.tenant_id, req.user.id, nome, origem.description, origem.category, origem.target_group, origem.anonymous, origem.lgpd_basis, uuid());
      const ins = db.prepare(`INSERT INTO questions (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es, option_points, single_choice, text_self, rows_json, neutral_idx, page_break, logic, jump)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const dims = db.prepare('SELECT dimensao_id FROM question_dimensoes WHERE question_id=?');
      const insDim = db.prepare('INSERT OR IGNORE INTO question_dimensoes (question_id, dimensao_id) VALUES (?,?)');
      questions.forEach((q, i) => {
        const qid = uuid();
        ins.run(qid, novoId, i + 1, q.type, q.text, q.text_en, q.text_es, q.options, q.options_en, q.options_es, q.option_points, q.single_choice || 0, q.text_self, q.rows_json, q.neutral_idx, q.page_break || 0, q.logic, q.jump);
        dims.all(q.id).forEach(d => insDim.run(qid, d.dimensao_id));
      });
      logChange(db, { surveyId: novoId, version: 1, user: req.user, action: 'duplicada', detail: { de: origem.id, nome: origem.name } });
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }

    return created(res, { survey: db.prepare('SELECT * FROM surveys WHERE id=?').get(novoId) }, 'Pesquisa duplicada');
  } catch (e) { return err(res, 'Erro ao duplicar a pesquisa', 500, e.message); }
}

/* GET /surveys/:id/history — histórico de alterações e versões guardadas */
function history(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT id, name, IFNULL(version,1) version FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    const changes = db.prepare('SELECT id, version, user_name, action, detail, created_at FROM survey_changes WHERE survey_id=? ORDER BY created_at DESC LIMIT 200').all(survey.id)
      .map(c => ({ ...c, detail: (() => { try { return JSON.parse(c.detail); } catch { return c.detail; } })() }));
    const versions = db.prepare('SELECT id, version, created_at FROM survey_versions WHERE survey_id=? ORDER BY version DESC').all(survey.id);
    return ok(res, { survey, changes, versions });
  } catch (e) { return err(res, 'Erro ao carregar o histórico', 500, e.message); }
}

/* POST /surveys/bulk — cria UMA pesquisa por nome (ex.: avaliação por gestor), já publicada, com link próprio.
   Não roda a tradução automática (seria 1 chamada de IA por pesquisa); use o botão Traduzir por pesquisa se precisar. */
function bulkCreate(req, res) {
  try {
    const { baseName, names, questions = [], category, anonymous, deadline } = req.body;
    const list = Array.isArray(names) ? [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))] : [];
    if (!list.length)          return badReq(res, 'Informe ao menos um nome');
    if (list.length > 200)     return badReq(res, 'Máximo de 200 nomes por vez');
    if (!Array.isArray(questions) || !questions.length) return badReq(res, 'Informe as perguntas do modelo');

    const db  = getDB();
    const insS = db.prepare(`INSERT INTO surveys (id, tenant_id, created_by_id, name, category, target_group, anonymous, deadline, lgpd_basis, public_token, status, published_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?, 'ativo', datetime('now'))`);
    const insQ = db.prepare('INSERT INTO questions (id, survey_id, order_num, type, text, options, option_points, single_choice, text_self) VALUES (?,?,?,?,?,?,?,?,?)');
    const J = a => (Array.isArray(a) && a.length) ? JSON.stringify(a) : null;
    const out = [];
    db.exec('BEGIN');
    try {
      for (const nm of list) {
        const sid = uuid(); const tok = uuid();
        insS.run(sid, req.user.tenant_id, req.user.id, `${(baseName || 'Avaliação').trim()} — ${nm}`, category || null, nm,
          anonymous !== false ? 1 : 0, deadline || null, 'consentimento', tok);
        questions.forEach((q, i) => insQ.run(uuid(), sid, i + 1, q.type, q.text, J(q.options),
          (Array.isArray(q.option_points) && q.option_points.length) ? JSON.stringify(q.option_points.map(n => Number(n) || 0)) : null,
          q.singleChoice ? 1 : 0, q.text_self || null));
        out.push({ name: nm, surveyId: sid, token: tok });
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    logger.info('Pesquisas criadas em lote', { by: req.user.id, count: out.length });
    return created(res, { created: out }, `${out.length} avaliações criadas`);
  } catch (e) { return err(res, 'Erro ao criar em lote', 500, e.message); }
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

/* PUT /surveys/:id/deadline — define, posterga ou remove o prazo; reabre se estava encerrada */
function setDeadline(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != ?').get(req.params.id, req.user.tenant_id, 'excluido');
    if (!survey) return notFound(res, 'Pesquisa');
    const deadline = req.body.deadline || null;
    const future   = deadline && new Date(deadline).getTime() > Date.now();
    if (survey.status === 'encerrado' && future) {
      db.prepare('UPDATE surveys SET deadline=?, status=? WHERE id=?').run(deadline, 'ativo', survey.id);
    } else {
      db.prepare('UPDATE surveys SET deadline=? WHERE id=?').run(deadline, survey.id);
    }
    const updated = db.prepare('SELECT * FROM surveys WHERE id=?').get(survey.id);
    return ok(res, { survey: updated }, 'Prazo atualizado');
  } catch (e) { return err(res, 'Erro ao atualizar prazo', 500, e.message); }
}

/* Monta a lista de links por segmento (distritos com regional + departamentos) */
function segmentLinksData(db, t, surveyId, res) {
  const links   = db.prepare('SELECT token, distrito_id, departamento_id FROM survey_links WHERE survey_id=?').all(surveyId);
  const distMap = {}; db.prepare('SELECT id, name, regional_id FROM distritos WHERE tenant_id=?').all(t).forEach(d => distMap[d.id] = d);
  const depMap  = {}; db.prepare('SELECT id, name FROM departamentos WHERE tenant_id=?').all(t).forEach(d => depMap[d.id] = d);
  const regMap  = {}; db.prepare('SELECT id, name FROM regionais WHERE tenant_id=?').all(t).forEach(r => regMap[r.id] = r.name);
  const distritos = [], departamentos = [];
  links.forEach(l => {
    if (l.distrito_id && distMap[l.distrito_id]) distritos.push({ token: l.token, name: distMap[l.distrito_id].name, regional: regMap[distMap[l.distrito_id].regional_id] || null });
    else if (l.departamento_id && depMap[l.departamento_id]) departamentos.push({ token: l.token, name: depMap[l.departamento_id].name });
  });
  distritos.sort((a, b) => (a.regional || '~').localeCompare(b.regional || '~') || a.name.localeCompare(b.name));
  departamentos.sort((a, b) => a.name.localeCompare(b.name));
  return ok(res, { distritos, departamentos }, 'ok');
}

/* GET /surveys/:id/segment-links — lista os links por segmento já existentes */
function listSegmentLinks(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!survey) return notFound(res, 'Pesquisa');
    return segmentLinksData(db, t, survey.id, res);
  } catch (e) { return err(res, 'Erro ao listar links', 500, e.message); }
}

/* POST /surveys/:id/segment-links — garante um link para cada distrito e departamento, e retorna a lista */
function segmentLinks(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const survey = db.prepare("SELECT id FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(req.params.id, t);
    if (!survey) return notFound(res, 'Pesquisa');
    const distritos     = db.prepare('SELECT id FROM distritos WHERE tenant_id=?').all(t);
    const departamentos = db.prepare('SELECT id FROM departamentos WHERE tenant_id=?').all(t);
    const hasD = db.prepare('SELECT 1 FROM survey_links WHERE survey_id=? AND distrito_id=?');
    const hasP = db.prepare('SELECT 1 FROM survey_links WHERE survey_id=? AND departamento_id=?');
    const ins  = db.prepare('INSERT INTO survey_links (id, tenant_id, survey_id, token, distrito_id, departamento_id) VALUES (?,?,?,?,?,?)');
    const tok  = () => uuid().replace(/-/g, '');
    distritos.forEach(d => { if (!hasD.get(survey.id, d.id)) ins.run(uuid(), t, survey.id, tok(), d.id, null); });
    departamentos.forEach(d => { if (!hasP.get(survey.id, d.id)) ins.run(uuid(), t, survey.id, tok(), null, d.id); });
    return segmentLinksData(db, t, survey.id, res);
  } catch (e) { return err(res, 'Erro ao gerar links', 500, e.message); }
}

module.exports = { list, create, getOne, update, publish, remove, generateAI, translateExisting, setDeadline, listSegmentLinks, segmentLinks, bulkCreate, updateQuestions, duplicate, history };
