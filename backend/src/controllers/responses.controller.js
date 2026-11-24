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
      ? db.prepare("SELECT id, name, name_en, name_es, description, description_en, description_es, category, anonymous, status, deadline, access_password, shuffle_questions, shuffle_options, allow_edit FROM surveys WHERE id = ?").get(link.survey_id)
      : db.prepare("SELECT id, name, name_en, name_es, description, description_en, description_es, category, anonymous, status, deadline, access_password, shuffle_questions, shuffle_options, allow_edit FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    const closed = survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now());
    if (closed) return ok(res, { closed: true, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Pesquisa encerrada');
    const questions = db.prepare('SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es, single_choice, rows_json, neutral_idx, page_break, logic, jump FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    // Senha de acesso: sem a senha certa, o formulário não entrega as perguntas.
    if (survey.access_password) {
      const enviada = String(req.query.pwd || req.headers['x-survey-password'] || '');
      if (enviada !== survey.access_password) {
        return ok(res, { requiresPassword: true, wrong: !!enviada, survey: { name: survey.name, name_en: survey.name_en, name_es: survey.name_es } }, 'Senha necessária');
      }
    }

    let parsed = questions.map(q => ({ ...q, options: PJ(q.options), options_en: PJ(q.options_en), options_es: PJ(q.options_es), singleChoice: !!q.single_choice, rows: PJ(q.rows_json), neutralIdx: PJ(q.neutral_idx), pageBreak: !!q.page_break, logic: PJ(q.logic), jump: PJ(q.jump) }));

    // Embaralhar: dentro da própria página, para não quebrar a lógica nem os saltos.
    const baralho = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t2 = a[i]; a[i] = a[j]; a[j] = t2; } return a; };
    if (survey.shuffle_questions) {
      const paginas = []; let atual = [];
      parsed.forEach((q, i) => { if (i > 0 && q.pageBreak) { paginas.push(atual); atual = []; } atual.push(q); });
      if (atual.length) paginas.push(atual);
      parsed = paginas.flatMap(pag => {
        if (pag.length < 2) return pag;
        const [primeira, ...resto] = pag;                       // a 1ª guarda a quebra de página
        const misturado = baralho([{ ...primeira, pageBreak: false }, ...resto]);
        return misturado.map((q, i) => i === 0 ? { ...q, pageBreak: !!primeira.pageBreak } : { ...q, pageBreak: false });
      });
    }
    if (survey.shuffle_options) {
      // Embaralha só onde a ordem não carrega significado (escala e ordenação ficam de fora).
      parsed = parsed.map(q => (q.type === 'multiple' || q.type === 'dropdown') && Array.isArray(q.options) && q.options.length > 1
        ? { ...q, options: baralho(q.options) } : q);
    }

    const { status, deadline, access_password, shuffle_questions, shuffle_options, ...pub } = survey;
    return ok(res, { survey: { ...pub, allowEdit: !!survey.allow_edit }, questions: parsed });
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
      ? db.prepare("SELECT id, anonymous, status, deadline, IFNULL(version,1) version, access_password, quota_enabled, allow_edit FROM surveys WHERE id = ?").get(link.survey_id)
      : db.prepare("SELECT id, anonymous, status, deadline, IFNULL(version,1) version, access_password, quota_enabled, allow_edit FROM surveys WHERE public_token = ?").get(req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    if (survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now()))
      return badReq(res, 'Esta pesquisa está encerrada e não aceita mais respostas.');

    // Senha de acesso, quando a pesquisa tem uma.
    if (survey.access_password) {
      const enviada = String(req.body.password || req.headers['x-survey-password'] || '');
      if (enviada !== survey.access_password) return badReq(res, 'Senha incorreta.');
    }

    // Uma resposta por navegador. Quando a pesquisa permite correção, a segunda vinda
    // do mesmo aparelho substitui a resposta anterior em vez de ser recusada.
    const cid = (typeof clientId === 'string' && clientId.trim()) ? clientId.trim().slice(0, 64) : null;
    let corrigindo = null;
    if (cid) {
      const already = db.prepare('SELECT id FROM responses WHERE survey_id = ? AND client_id = ?').get(survey.id, cid);
      if (already) {
        if (!survey.allow_edit) return badReq(res, 'Esta pesquisa já foi respondida neste dispositivo.');
        corrigindo = already.id;
      }
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

    // Cota por distrito: consome a meta cadastrada na Estrutura.
    if (survey.quota_enabled && distritoId && !corrigindo) {
      const d = db.prepare('SELECT name, IFNULL(meta,0) meta FROM distritos WHERE id = ?').get(distritoId);
      if (d && d.meta > 0) {
        const feitas = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id=? AND distrito_id=? AND completed_at IS NOT NULL').get(survey.id, distritoId).c;
        if (feitas >= d.meta) return badReq(res, `A cota de respostas do distrito ${d.name} já foi atingida.`);
      }
    }

    // Correção: apaga a resposta anterior deste aparelho e grava a nova no lugar.
    if (corrigindo) {
      db.prepare('DELETE FROM answers WHERE response_id = ?').run(corrigindo);
      db.prepare('DELETE FROM responses WHERE id = ?').run(corrigindo);
    }

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
