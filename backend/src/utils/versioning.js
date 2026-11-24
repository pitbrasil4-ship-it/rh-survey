'use strict';
const { v4: uuid } = require('uuid');

/* Versionamento de pesquisa.
 *
 * O risco de editar uma pesquisa que já tem respostas é mudar o SIGNIFICADO de uma pergunta
 * e, com isso, misturar respostas que não querem dizer a mesma coisa. Nem toda edição faz isso:
 *
 *  - SEGURA  : corrigir um erro de digitação, traduzir, trocar a dimensão, reordenar.
 *              Entra direto, sem subir a versão.
 *  - QUEBRA  : mudar o tipo da pergunta, mexer nas alternativas ou nos pesos, remover pergunta.
 *              Exige confirmação, sobe a versão e guarda o questionário anterior.
 *
 * As respostas antigas ficam carimbadas com a versão em que foram dadas.
 */

const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const norm = v => (v == null ? '' : String(v)).trim();
/* Aceita lista ou texto JSON — a API devolve as opções como texto e o construtor manda array. */
const asList = v => Array.isArray(v) ? v : (typeof v === 'string' ? (PJ(v) || null) : null);
const sameList = (a, b) => JSON.stringify((asList(a) || []).map(norm)) === JSON.stringify((asList(b) || []).map(norm));
const asPoints = v => { const l = asList(v); return l ? l.map(Number) : null; };

/* Tira uma fotografia do questionário atual, para guardar antes de alterar. */
function snapshot(db, surveyId) {
  const survey = db.prepare('SELECT id, name, description, category, version FROM surveys WHERE id=?').get(surveyId);
  const questions = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(surveyId);
  return JSON.stringify({ survey, questions, tiradoEm: new Date().toISOString() });
}

/* Compara o questionário atual com o novo e diz o que muda. */
function diffQuestions(atuais, novas) {
  const porId = {}; atuais.forEach(q => { porId[q.id] = q; });
  const vistos = new Set();
  const quebras = [], seguras = [];

  novas.forEach((nq, i) => {
    const antiga = nq.id ? porId[nq.id] : null;
    if (!antiga) { seguras.push({ tipo: 'pergunta_nova', texto: norm(nq.text) }); return; }
    vistos.add(antiga.id);

    if (norm(antiga.type) !== norm(nq.type))
      quebras.push({ tipo: 'tipo_alterado', questionId: antiga.id, texto: norm(antiga.text), de: antiga.type, para: nq.type });

    if (!sameList(PJ(antiga.options), nq.options))
      quebras.push({ tipo: 'alternativas_alteradas', questionId: antiga.id, texto: norm(antiga.text) });

    const ptsA = asPoints(antiga.option_points), ptsN = asPoints(nq.option_points);
    if (JSON.stringify(ptsA) !== JSON.stringify(ptsN))
      quebras.push({ tipo: 'pesos_alterados', questionId: antiga.id, texto: norm(antiga.text) });

    if (norm(antiga.text) !== norm(nq.text))
      seguras.push({ tipo: 'texto_ajustado', questionId: antiga.id, de: norm(antiga.text), para: norm(nq.text) });

    if ((antiga.order_num || 0) !== i + 1)
      seguras.push({ tipo: 'reordenada', questionId: antiga.id, texto: norm(antiga.text) });
  });

  atuais.forEach(q => { if (!vistos.has(q.id)) quebras.push({ tipo: 'pergunta_removida', questionId: q.id, texto: norm(q.text) }); });
  return { quebras, seguras };
}

/* Quantas respostas a pesquisa já recebeu. */
function respostasDe(db, surveyId) {
  return db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL').get(surveyId).c;
}

/* Registra uma linha no histórico da pesquisa. */
function logChange(db, { surveyId, version, user, action, detail }) {
  db.prepare('INSERT INTO survey_changes (id, survey_id, version, user_id, user_name, action, detail) VALUES (?,?,?,?,?,?,?)')
    .run(uuid(), surveyId, version || null, (user && user.id) || null, (user && user.name) || null, action,
      typeof detail === 'string' ? detail : JSON.stringify(detail || {}));
}

/* Guarda a versão atual antes de uma alteração que quebra, e sobe o número da versão. */
function bumpVersion(db, surveyId, user) {
  const atual = db.prepare('SELECT IFNULL(version,1) v FROM surveys WHERE id=?').get(surveyId).v;
  db.prepare('INSERT INTO survey_versions (id, survey_id, version, snapshot, created_by) VALUES (?,?,?,?,?)')
    .run(uuid(), surveyId, atual, snapshot(db, surveyId), (user && user.id) || null);
  const nova = atual + 1;
  db.prepare('UPDATE surveys SET version=? WHERE id=?').run(nova, surveyId);
  return nova;
}

module.exports = { snapshot, diffQuestions, respostasDe, logChange, bumpVersion };
