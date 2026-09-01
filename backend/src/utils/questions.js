'use strict';
/* Serialização das perguntas — usada na criação, edição, duplicação e no formulário público.
 *
 * Formato de uma pergunta na API:
 *   {
 *     external_id, type, text, text_en, text_es,
 *     options, options_en, options_es,       // rótulos das alternativas
 *     option_points,                          // peso (%) de cada alternativa, alinhado por índice
 *     required,                               // obrigatoriedade por questão
 *     config: {
 *       neutralIndex,                         // índice da opção neutra (fora do denominador). Ex.: "Não se aplica"
 *       allowOther, otherLabel,               // opção "Outros" com campo aberto
 *       rows, rows_en, rows_es,               // tipo matrix: linhas (as colunas são as options)
 *       fields                                // tipo form: [{ label, kind:'text|email|phone|date|number', required }]
 *     },
 *     logic: {
 *       showIf: { order, options:[] },        // exibe a pergunta só se a de nº `order` tiver uma destas alternativas
 *       endIf:  { options:[] }                // encerra o questionário se a resposta for uma destas alternativas
 *     },
 *     dimensions: [dimensionId, ...]          // vínculo N:N com as dimensões (taxonomias)
 *   }
 */

// Tipos que têm lista de alternativas editável.
const OPTION_TYPES = ['scale', 'multiple', 'dropdown', 'matrix'];
const VALID_TYPES  = ['nps', 'scale', 'rating', 'multiple', 'text', 'yesno', 'dropdown', 'matrix', 'form'];

const FIELD_KINDS = ['text', 'email', 'phone', 'date', 'number'];

function hasOptions(type) { return OPTION_TYPES.includes(type); }

function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/* Array de strings limpo, ou null se vazio. */
function strList(v) {
  if (!Array.isArray(v)) return null;
  const a = v.map(x => (x == null ? '' : String(x)).trim()).filter(Boolean);
  return a.length ? a : null;
}
function jsonList(v) { const a = strList(v); return a ? JSON.stringify(a) : null; }

/* Pesos: inteiros de 0 a 100, um por alternativa. */
function pointList(v) {
  if (!Array.isArray(v) || !v.length) return null;
  return v.map(n => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
}

/* Normaliza o `config` conforme o tipo — descarta o que não se aplica. */
function normalizeConfig(type, raw, optionCount) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  const out = {};

  if (hasOptions(type)) {
    const ni = Number(c.neutralIndex);
    if (Number.isInteger(ni) && ni >= 0 && ni < optionCount) out.neutralIndex = ni;
    if (c.allowOther) {
      out.allowOther = true;
      const lb = String(c.otherLabel || '').trim();
      if (lb) out.otherLabel = lb;
    }
  }
  if (type === 'matrix') {
    const rows = strList(c.rows);
    if (rows) {
      out.rows = rows;
      const en = strList(c.rows_en); if (en && en.length === rows.length) out.rows_en = en;
      const es = strList(c.rows_es); if (es && es.length === rows.length) out.rows_es = es;
    }
  }
  if (type === 'form') {
    const fields = (Array.isArray(c.fields) ? c.fields : [])
      .map(f => {
        const label = String((f && f.label) || '').trim();
        if (!label) return null;
        const kind = FIELD_KINDS.includes(f.kind) ? f.kind : 'text';
        return { label, kind, required: !!f.required };
      })
      .filter(Boolean);
    if (fields.length) out.fields = fields;
  }
  return Object.keys(out).length ? out : null;
}

/* Normaliza a lógica condicional. Referencia a pergunta-gatilho pelo número de ordem (1-based). */
function normalizeLogic(raw) {
  const l = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  if (l.showIf && Number(l.showIf.order) > 0) {
    const opts = strList(l.showIf.options);
    if (opts) out.showIf = { order: Number(l.showIf.order), options: opts };
  }
  if (l.endIf) {
    const opts = strList(l.endIf.options);
    if (opts) out.endIf = { options: opts };
  }
  return Object.keys(out).length ? out : null;
}

/* Converte uma pergunta vinda da API nas colunas da tabela `questions`. */
function toRow(q, orderNum) {
  const type = VALID_TYPES.includes(q.type) ? q.type : 'text';
  const options = hasOptions(type) ? strList(q.options) : null;
  const n = options ? options.length : 0;
  const optionsEn = options ? strList(q.options_en) : null;
  const optionsEs = options ? strList(q.options_es) : null;
  const points = options ? pointList(q.option_points) : null;
  const config = normalizeConfig(type, q.config, n);
  const logic  = normalizeLogic(q.logic);

  return {
    order_num:   orderNum,
    type,
    text:        String(q.text || '').trim(),
    text_en:     String(q.text_en || '').trim() || null,
    text_es:     String(q.text_es || '').trim() || null,
    options:     options ? JSON.stringify(options) : null,
    // Traduções só valem se tiverem o mesmo número de alternativas — senão o rótulo sai trocado.
    options_en:  (optionsEn && optionsEn.length === n) ? JSON.stringify(optionsEn) : null,
    options_es:  (optionsEs && optionsEs.length === n) ? JSON.stringify(optionsEs) : null,
    // Completa/corta os pesos para casar com a quantidade de alternativas.
    option_points: points ? JSON.stringify(Array.from({ length: n }, (_, i) => points[i] ?? 0)) : null,
    required:    q.required === false ? 0 : 1,
    config:      config ? JSON.stringify(config) : null,
    logic:       logic ? JSON.stringify(logic) : null,
    external_id: String(q.external_id || '').trim() || null,
  };
}

const INSERT_SQL = `INSERT INTO questions
  (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es,
   option_points, required, config, logic, external_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function insertParams(id, surveyId, row) {
  return [id, surveyId, row.order_num, row.type, row.text, row.text_en, row.text_es,
    row.options, row.options_en, row.options_es, row.option_points, row.required,
    row.config, row.logic, row.external_id];
}

/* Grava a lista completa de perguntas de uma pesquisa (substitui as existentes).
 * Só pode ser usada em pesquisas sem respostas — quem chama valida isso antes,
 * para nunca apagar dados já coletados. Devolve os ids criados, na ordem recebida. */
function replaceQuestions(db, surveyId, questions, uuid) {
  db.prepare('DELETE FROM question_dimensions WHERE question_id IN (SELECT id FROM questions WHERE survey_id = ?)').run(surveyId);
  db.prepare('DELETE FROM questions WHERE survey_id = ?').run(surveyId);
  return insertQuestions(db, surveyId, questions, uuid);
}

function insertQuestions(db, surveyId, questions, uuid) {
  const stmt = db.prepare(INSERT_SQL);
  const link = db.prepare('INSERT OR IGNORE INTO question_dimensions (question_id, dimension_id) VALUES (?,?)');
  const ids  = [];
  (questions || []).forEach((q, i) => {
    const row = toRow(q, i + 1);
    if (!row.text) { ids.push(null); return; }
    const id = uuid();
    stmt.run(...insertParams(id, surveyId, row));
    strList(q.dimensions)?.forEach(dimId => link.run(id, dimId));
    ids.push(id);
  });
  return ids;
}

/* Linha do banco → objeto de pergunta da API (JSON já parseado). */
function fromRow(r) {
  return {
    ...r,
    options:       parseJSON(r.options),
    options_en:    parseJSON(r.options_en),
    options_es:    parseJSON(r.options_es),
    option_points: parseJSON(r.option_points),
    config:        parseJSON(r.config),
    logic:         parseJSON(r.logic),
    required:      r.required === 0 ? false : true,
  };
}

module.exports = {
  OPTION_TYPES, VALID_TYPES, FIELD_KINDS,
  hasOptions, parseJSON, strList, jsonList, pointList,
  toRow, insertQuestions, replaceQuestions, fromRow, INSERT_SQL, insertParams,
};
