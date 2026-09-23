'use strict';
const { v4: uuid }   = require('uuid');
const { getDB }      = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const logger         = require('../utils/logger');
const { translateSurvey, aiEnabled } = require('../utils/translate');
const Q              = require('../utils/questions');
const { visibleSurveyIds, canSeeSurvey } = require('../utils/scope');

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
    const rows = db.prepare(`
      SELECT s.*, u.name as created_by_name,
             (SELECT COUNT(*) FROM questions WHERE survey_id = s.id) as question_count,
             (SELECT COUNT(*) FROM responses WHERE survey_id = s.id AND completed_at IS NOT NULL) as response_count
      FROM surveys s LEFT JOIN users u ON s.created_by_id = u.id
      WHERE s.tenant_id = ? AND s.status != 'excluido' ORDER BY s.created_at DESC
    `).all(req.user.tenant_id);
    // Categorias suprimidas para este usuário (ex.: Gestor não vê a Avaliação de Gestores).
    const surveys = rows.filter(s => canSeeSurvey(req.user, s));
    return ok(res, { surveys, total: surveys.length });
  } catch (e) { return err(res, 'Erro ao listar pesquisas', 500, e.message); }
}

/* POST /surveys */
async function create(req, res) {
  try {
    const { name, description, category, targetGroup, anonymous, deadline, questions = [], lgpdBasis,
            onePerDevice, maxResponses } = req.body;
    if (!name) return badReq(res, 'Nome da pesquisa é obrigatório');

    const db       = getDB();
    const surveyId = uuid();
    db.prepare(`INSERT INTO surveys (id, tenant_id, created_by_id, name, description, category, target_group, anonymous, deadline, lgpd_basis, public_token, one_per_device, max_responses)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      surveyId, req.user.tenant_id, req.user.id,
      name, description || null, category || null,
      targetGroup || null, anonymous !== false ? 1 : 0,
      deadline || null, lgpdBasis || 'consentimento', uuid(),
      onePerDevice ? 1 : 0, maxResponses > 0 ? Math.round(maxResponses) : null
    );

    const qIds = Q.insertQuestions(db, surveyId, questions, uuid);

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
    const out = [];
    db.exec('BEGIN');
    try {
      for (const nm of list) {
        const sid = uuid(); const tok = uuid();
        insS.run(sid, req.user.tenant_id, req.user.id, `${(baseName || 'Avaliação').trim()} — ${nm}`, category || null, nm,
          anonymous !== false ? 1 : 0, deadline || null, 'consentimento', tok);
        Q.insertQuestions(db, sid, questions, uuid);
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
    const rows = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const now  = new Date().toISOString();
    const dims = {};
    db.prepare(`SELECT l.question_id, l.dimension_id FROM question_dimension_links l
                JOIN questions q ON q.id = l.question_id
                WHERE q.survey_id = ?
                  AND (l.effective_from IS NULL OR l.effective_from <= ?)
                  AND (l.effective_to   IS NULL OR l.effective_to   >  ?)`).all(survey.id, now, now)
      .forEach(r => (dims[r.question_id] = dims[r.question_id] || []).push(r.dimension_id));
    const counts = {};
    db.prepare(`SELECT a.question_id, COUNT(*) c FROM answers a
                JOIN questions q ON q.id = a.question_id WHERE q.survey_id = ? GROUP BY a.question_id`).all(survey.id)
      .forEach(r => counts[r.question_id] = r.c);
    const questions = rows.map(r => ({ ...Q.fromRow(r), dimensions: dims[r.id] || [], answerCount: counts[r.id] || 0 }));
    const responseCount = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id = ?').get(survey.id).c;
    const versions = db.prepare('SELECT id, number, published_at, note FROM survey_versions WHERE survey_id=? ORDER BY number DESC').all(survey.id);
    // Perguntas continuam editáveis com respostas coletadas: só as mudanças que
    // invalidariam o que já foi gravado (trocar o tipo, encurtar a escala, remover a
    // pergunta) são recusadas, uma a uma, pelo sincronizador.
    return ok(res, { survey, questions, responseCount, versions });
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

    const { name, description, category, targetGroup, anonymous, deadline, status,
            questions, onePerDevice, maxResponses } = req.body;

    if (Array.isArray(questions) && !questions.length) return badReq(res, 'A pesquisa precisa de ao menos uma pergunta');

    db.prepare(`UPDATE surveys SET name=?, description=?, category=?, target_group=?, anonymous=?, deadline=?, status=?, one_per_device=?, max_responses=? WHERE id=?`).run(
      name        ?? survey.name,
      description ?? survey.description,
      category    ?? survey.category,
      targetGroup ?? survey.target_group,
      anonymous === undefined ? survey.anonymous : (anonymous ? 1 : 0),
      deadline    ?? survey.deadline,
      status      ?? survey.status,
      onePerDevice === undefined ? survey.one_per_device : (onePerDevice ? 1 : 0),
      maxResponses === undefined ? survey.max_responses : (maxResponses > 0 ? Math.round(maxResponses) : null),
      req.params.id
    );
    let sync = null;
    if (Array.isArray(questions)) {
      // `retroactive` decide se a reclassificação vale para as respostas já coletadas
      // ou só daqui em diante. Sem escolha explícita, a série histórica é preservada.
      sync = Q.syncQuestions(db, survey.id, questions, {
        tenantId: req.user.tenant_id, surveyId: survey.id,
        userId: req.user.id, userName: req.user.name, log: true,
        retroactive: req.body.retroactive === true,
      }, uuid);
    }
    const msg = sync && sync.blocked.length
      ? `Pesquisa atualizada, mas ${sync.blocked.length} pergunta(s) não puderam ser alteradas por já terem respostas.`
      : 'Pesquisa atualizada';
    return ok(res, { id: req.params.id, sync }, msg);
  } catch (e) { return err(res, 'Erro ao atualizar pesquisa', 500, e.message); }
}

/* POST /surveys/:id/duplicate — copia a pesquisa e todas as perguntas como novo rascunho.
   As respostas NÃO são copiadas: a cópia nasce zerada, com link público próprio. */
function duplicate(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare("SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    const newId = uuid();
    const name  = String(req.body.name || '').trim() || `${survey.name} (cópia)`;
    db.exec('BEGIN');
    try {
      db.prepare(`INSERT INTO surveys (id, tenant_id, created_by_id, name, name_en, name_es, description, description_en, description_es,
                    category, target_group, anonymous, deadline, lgpd_basis, public_token, status, one_per_device, max_responses)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'rascunho', ?, ?)`).run(
        newId, survey.tenant_id, req.user.id, name, survey.name_en, survey.name_es,
        survey.description, survey.description_en, survey.description_es,
        survey.category, survey.target_group, survey.anonymous, survey.deadline,
        survey.lgpd_basis, uuid(), survey.one_per_device || 0, survey.max_responses ?? null);

      const rows = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
      const ins  = db.prepare(Q.INSERT_SQL);
      rows.forEach((r, i) => {
        const qid = uuid();
        ins.run(...Q.insertParams(qid, newId, { ...r, order_num: i + 1 }));
        // A cópia nasce com a classificação vigente hoje, sem herdar o histórico de vigências.
        Q.setDimensions(db, qid, Q.dimensionsAt(db, r.id), { retroactive: true }, uuid);
      });
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }

    const copy = db.prepare('SELECT * FROM surveys WHERE id = ?').get(newId);
    logger.info('Pesquisa duplicada', { by: req.user.id, from: survey.id, to: newId });
    return created(res, { survey: copy }, 'Pesquisa duplicada como rascunho');
  } catch (e) { return err(res, 'Erro ao duplicar pesquisa', 500, e.message); }
}

/* GET /surveys/:id/export — perguntas no MESMO formato da planilha de importação,
   para o RH revisar fora do sistema e reimportar sem conversão manual.
   Uma coluna de dimensão por taxonomia cadastrada (Dimensão_Clima, Dimensão_HSE, …). */
function setShortName(set) {
  if (set.code === 'hse') return 'HSE';
  if (set.code === 'clima') return 'Clima';
  return set.name;
}

function exportQuestions(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!survey) return notFound(res, 'Pesquisa');

    const sets = db.prepare('SELECT id, name, code FROM dimension_sets WHERE tenant_id=? ORDER BY order_num, name').all(t);
    const dimInfo = {};
    db.prepare('SELECT id, name, set_id FROM dimensions WHERE tenant_id=?').all(t).forEach(d => dimInfo[d.id] = d);

    const rows = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(survey.id);
    const TYPE_LABEL = { nps:'NPS', scale:'escala', rating:'estrelas', multiple:'múltipla',
                         dropdown:'lista suspensa', matrix:'matriz', form:'formulário', text:'texto', yesno:'sim/não' };

    const header = ['Nº', 'ID', 'Pergunta', 'Pergunta (EN)', 'Pergunta (ES)', 'Tipo', 'Opções', 'Pesos',
                    ...sets.map(x => 'Dimensão_' + setShortName(x)),
                    'Obrigatória', 'Observação'];

    const out = rows.map(r => {
      const q = Q.fromRow(r);
      const cfg = q.config || {};
      const opts = q.options || [];
      // Rótulo da opção neutra sai na coluna Opções; o peso dela sai como "(sem peso)".
      const pesos = q.option_points
        ? opts.map((_, i) => (i === cfg.neutralIndex ? '(sem peso)' : String(q.option_points[i] ?? 0)))
        : [];
      const mine = Q.dimensionsAt(db, r.id).map(id => dimInfo[id]).filter(Boolean);
      return [
        r.order_num, q.external_id || '', q.text, q.text_en || '', q.text_es || '',
        TYPE_LABEL[q.type] || q.type,
        opts.join(';'),
        pesos.join(';'),
        ...sets.map(st => mine.filter(d => d.set_id === st.id).map(d => d.name).join(' | ')),
        q.required ? 'Sim' : 'Não',
        q.notes || '',
      ];
    });

    return ok(res, { survey: { id: survey.id, name: survey.name }, header, rows: out });
  } catch (e) { return err(res, 'Erro ao exportar perguntas', 500, e.message); }
}

/* POST /surveys/:id/publish — publica e congela uma versão numerada do questionário.
   A resposta enviada a partir daqui fica presa a esta versão, o que permite comparar
   edições e auditar o que o respondente de fato viu. */
function publish(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare("SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    db.prepare("UPDATE surveys SET status='ativo', published_at=datetime('now') WHERE id=?").run(survey.id);
    const version = createVersion(db, survey.id, req.user.id, req.body.note);
    const updated = db.prepare('SELECT public_token FROM surveys WHERE id=?').get(survey.id);
    return ok(res, { publicLink: `/public/survey/${updated?.public_token}`, version },
      `Pesquisa publicada — versão ${version.number}`);
  } catch (e) { return err(res, 'Erro ao publicar pesquisa', 500, e.message); }
}

/* Congela o questionário atual como uma nova versão. */
function createVersion(db, surveyId, userId, note) {
  const rows = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(surveyId);
  const snapshot = rows.map(r => ({ ...Q.fromRow(r), dimensions: Q.dimensionsAt(db, r.id) }));
  const next = (db.prepare('SELECT COALESCE(MAX(number),0) n FROM survey_versions WHERE survey_id=?').get(surveyId).n) + 1;
  const id = uuid();
  db.prepare(`INSERT INTO survey_versions (id, survey_id, number, published_at, snapshot, created_by_id, note)
              VALUES (?,?,?,datetime('now'),?,?,?)`)
    .run(id, surveyId, next, JSON.stringify(snapshot), userId || null, String(note || '').trim() || null);
  return { id, number: next, questionCount: snapshot.length };
}

/* GET /surveys/:id/versions — versões publicadas, da mais recente para a mais antiga */
function versions(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    const rows = db.prepare(`SELECT v.id, v.number, v.published_at, v.note, u.name AS published_by,
                                    (SELECT COUNT(*) FROM responses r WHERE r.version_id = v.id) AS response_count
                             FROM survey_versions v LEFT JOIN users u ON u.id = v.created_by_id
                             WHERE v.survey_id=? ORDER BY v.number DESC`).all(survey.id);
    return ok(res, { versions: rows });
  } catch (e) { return err(res, 'Erro ao listar versões', 500, e.message); }
}

/* GET /surveys/:id/history — quem mudou o quê, e quando */
function history(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT id FROM surveys WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    const rows = db.prepare(`SELECT h.*, q.order_num, q.text AS question_text
                             FROM question_history h LEFT JOIN questions q ON q.id = h.question_id
                             WHERE h.survey_id=? ORDER BY h.created_at DESC LIMIT 500`).all(survey.id);
    // Traduz os ids de dimensão para nome, senão o histórico fica ilegível.
    const dimNames = {};
    db.prepare('SELECT id, name FROM dimensions WHERE tenant_id=?').all(req.user.tenant_id).forEach(d => dimNames[d.id] = d.name);
    const pretty = v => String(v || '').split(',').map(x => dimNames[x.trim()] || x.trim()).filter(Boolean).join(', ');
    return ok(res, {
      history: rows.map(h => h.field === 'Dimensões'
        ? { ...h, before_value: pretty(h.before_value) || '—', after_value: pretty(h.after_value) || '—' }
        : h),
    });
  } catch (e) { return err(res, 'Erro ao carregar histórico', 500, e.message); }
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

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-api-key': apiKey, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens:1500,
          messages:[{ role:'user', content:`Gere 6 perguntas de avaliação de RH para: "${context}". Para os tipos com alternativas (scale, multiple, dropdown) inclua também "options" com os rótulos. Retorne APENAS JSON: [{"text":"...","type":"nps|scale|multiple|dropdown|text|rating|yesno","options":["..."]}]` }]
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') return err(res, 'A IA não respondeu a tempo. Tente novamente.', 504);
      throw e;
    } finally { clearTimeout(timer); }
    if (!resp.ok) { const et = await resp.text().catch(() => ''); return err(res, 'A IA recusou a solicitação. Tente novamente.', 502, et.slice(0, 200)); }
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

module.exports = { list, create, getOne, update, duplicate, publish, remove, generateAI, translateExisting, setDeadline, listSegmentLinks, segmentLinks, bulkCreate, versions, history, exportQuestions };
