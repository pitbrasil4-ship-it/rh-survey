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
    // Favorabilidade: a partir de qual posição a resposta conta como Favorável.
    // null/ausente = a pergunta não entra no cálculo de favorabilidade.
    const ff = Number(c.favorableFrom);
    if (Number.isInteger(ff) && ff >= 0 && ff < optionCount) out.favorableFrom = ff;
    // Pergunta de segmentação (ex.: modalidade de contratação): não pontua e não entra
    // em dimensão nenhuma — serve para abrir todos os demais resultados por ela.
    if (c.segmentation) out.segmentation = true;
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
    notes:       String(q.notes || '').trim() || null,
  };
}

/* Favorabilidade padrão: numa escala de 4+ pontos pontuada, a metade de cima conta
   como Favorável. Escalas de 3 pontos (Avaliação de Performance) ficam de fora —
   a RGIS não classifica favorabilidade nelas. Sempre sobreponível no editor. */
function defaultFavorableFrom(options, points, neutralIndex) {
  if (!Array.isArray(options) || !Array.isArray(points)) return null;
  const scored = options.map((_, i) => i).filter(i => i !== neutralIndex);
  if (scored.length < 4) return null;
  const idx = scored.find(i => Number(points[i]) >= 50);
  return idx === undefined ? null : idx;
}

const INSERT_SQL = `INSERT INTO questions
  (id, survey_id, order_num, type, text, text_en, text_es, options, options_en, options_es,
   option_points, required, config, logic, external_id, notes)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const UPDATE_SQL = `UPDATE questions SET
  order_num=?, type=?, text=?, text_en=?, text_es=?, options=?, options_en=?, options_es=?,
  option_points=?, required=?, config=?, logic=?, external_id=?, notes=? WHERE id=?`;

function insertParams(id, surveyId, row) {
  return [id, surveyId, row.order_num, row.type, row.text, row.text_en, row.text_es,
    row.options, row.options_en, row.options_es, row.option_points, row.required,
    row.config, row.logic, row.external_id, row.notes];
}

function updateParams(id, row) {
  return [row.order_num, row.type, row.text, row.text_en, row.text_es,
    row.options, row.options_en, row.options_es, row.option_points, row.required,
    row.config, row.logic, row.external_id, row.notes, id];
}

/* Grava a lista completa de perguntas de uma pesquisa (substitui as existentes).
 * Só pode ser usada em pesquisas sem respostas — quem chama valida isso antes,
 * para nunca apagar dados já coletados. Devolve os ids criados, na ordem recebida. */
function replaceQuestions(db, surveyId, questions, uuid) {
  db.prepare('DELETE FROM question_dimension_links WHERE question_id IN (SELECT id FROM questions WHERE survey_id = ?)').run(surveyId);
  db.prepare('DELETE FROM questions WHERE survey_id = ?').run(surveyId);
  return insertQuestions(db, surveyId, questions, uuid);
}

function insertQuestions(db, surveyId, questions, uuid) {
  const stmt = db.prepare(INSERT_SQL);
  const ids  = [];
  (questions || []).forEach((q, i) => {
    const row = toRow(q, i + 1);
    if (!row.text) { ids.push(null); return; }
    const id = uuid();
    stmt.run(...insertParams(id, surveyId, row));
    // Pergunta nova: o vínculo vale desde sempre, não há série histórica a preservar.
    setDimensions(db, id, strList(q.dimensions) || [], { retroactive: true }, uuid);
    ids.push(id);
  });
  return ids;
}

/* Dimensões vigentes de uma pergunta numa data (padrão: agora). */
function dimensionsAt(db, questionId, at) {
  const when = at || new Date().toISOString();
  return db.prepare(`SELECT dimension_id FROM question_dimension_links
                     WHERE question_id = ?
                       AND (effective_from IS NULL OR effective_from <= ?)
                       AND (effective_to   IS NULL OR effective_to   >  ?)`)
    .all(questionId, when, when).map(r => r.dimension_id);
}

/* Regrava as dimensões de uma pergunta.
 *   retroactive: true  → a nova classificação vale também para as respostas já coletadas
 *                        (o vínculo antigo é apagado e o novo passa a valer desde sempre).
 *   retroactive: false → prospectivo: o vínculo antigo é encerrado agora e o novo passa a
 *                        valer daqui em diante, preservando a apuração já publicada.
 * Devolve { added, removed } para o histórico. */
function setDimensions(db, questionId, dimensionIds, opts, uuid) {
  const retro = !(opts && opts.retroactive === false);
  const now   = new Date().toISOString();
  const want  = [...new Set((dimensionIds || []).filter(Boolean))];
  const cur   = dimensionsAt(db, questionId, now);

  const added   = want.filter(d => !cur.includes(d));
  const removed = cur.filter(d => !want.includes(d));

  // Mesmo sem mudança de dimensão, "retroativo" ainda tem trabalho: apagar as vigências
  // deixadas por uma reclassificação prospectiva anterior, para que a classificação atual
  // passe a valer também nas respostas antigas.
  const rows = db.prepare('SELECT effective_from, effective_to FROM question_dimension_links WHERE question_id = ?').all(questionId);
  const hasWindows = rows.some(r => r.effective_from || r.effective_to);
  const windowsOnly = !added.length && !removed.length && retro && hasWindows;
  if (!added.length && !removed.length && !windowsOnly) return { added, removed, windowsOnly: false };

  const ins = db.prepare(`INSERT INTO question_dimension_links (id, question_id, dimension_id, effective_from)
                          VALUES (?,?,?,?)`);
  if (retro) {
    // Retroativo: não sobra rastro de vigência — a classificação nova reescreve a série.
    db.prepare('DELETE FROM question_dimension_links WHERE question_id = ?').run(questionId);
    want.forEach(d => ins.run(uuid(), questionId, d, null));
  } else {
    // Prospectivo: fecha o que saiu e abre o que entrou, ambos a partir de agora.
    const close = db.prepare(`UPDATE question_dimension_links SET effective_to = ?
                              WHERE question_id = ? AND dimension_id = ? AND effective_to IS NULL`);
    removed.forEach(d => close.run(now, questionId, d));
    added.forEach(d => ins.run(uuid(), questionId, d, now));
  }
  return { added, removed, windowsOnly };
}

/* Quantas respostas uma pergunta já recebeu. */
function answerCount(db, questionId) {
  return db.prepare('SELECT COUNT(*) c FROM answers WHERE question_id = ?').get(questionId).c;
}

/* Maior posição já escolhida numa pergunta de escala/matriz — abaixo disso não dá
   para encurtar a lista de alternativas sem deixar resposta órfã. */
function maxRecordedPosition(db, questionId, type) {
  if (type === 'scale' || type === 'rating') {
    const r = db.prepare('SELECT MAX(value_num) m FROM answers WHERE question_id = ?').get(questionId);
    return Number(r && r.m) || 0;
  }
  if (type === 'matrix') {
    let max = 0;
    db.prepare('SELECT value_json FROM answers WHERE question_id = ? AND value_json IS NOT NULL').all(questionId)
      .forEach(a => {
        try {
          const v = JSON.parse(a.value_json);
          if (v && typeof v === 'object') Object.values(v).forEach(x => { const n = Number(x); if (n > max) max = n; });
        } catch {}
      });
    return max;
  }
  return 0;
}

/* Registra uma alteração no histórico da pergunta. */
function logChange(db, ctx, questionId, action, field, before, after, uuid) {
  if (!ctx || !ctx.log) return;
  db.prepare(`INSERT INTO question_history
    (id, tenant_id, survey_id, question_id, user_id, user_name, action, field, before_value, after_value)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    uuid(), ctx.tenantId || null, ctx.surveyId || null, questionId,
    ctx.userId || null, ctx.userName || null, action, field || null,
    before == null ? null : String(before).slice(0, 2000),
    after == null ? null : String(after).slice(0, 2000));
}

// Campos cuja mudança vale registrar no histórico, com o rótulo usado na tela.
const TRACKED = [
  ['text', 'Texto'], ['text_en', 'Texto (EN)'], ['text_es', 'Texto (ES)'],
  ['options', 'Alternativas'], ['options_en', 'Alternativas (EN)'], ['options_es', 'Alternativas (ES)'],
  ['option_points', 'Pesos'], ['required', 'Obrigatoriedade'], ['config', 'Configuração'],
  ['logic', 'Lógica'], ['external_id', 'ID'], ['notes', 'Observação'],
];

/* Sincroniza a lista de perguntas de uma pesquisa PRESERVANDO as respostas.
 *
 * Diferente de replaceQuestions, aqui cada pergunta que já existe é atualizada no lugar
 * (mesmo id), então nenhuma resposta é perdida — é o que permite corrigir um texto ou
 * reclassificar uma dimensão com a pesquisa ativa ou já encerrada.
 *
 * incoming: perguntas na ordem final; as que já existem trazem `id`.
 * ctx: { tenantId, surveyId, userId, userName, retroactive, log }
 * Devolve { ids, inserted, updated, removed, blocked } — `blocked` explica o que não
 * pôde ser feito sem destruir dado já coletado. */
function syncQuestions(db, surveyId, incoming, ctx, uuid) {
  const existing = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(surveyId);
  const byId = {}; existing.forEach(q => byId[q.id] = q);

  const blocked = [];
  let inserted = 0, updated = 0, removed = 0;

  // ── Fase 1: o que sai, e o que não pode sair ──
  const keptIds = new Set((incoming || []).map(q => q.id).filter(Boolean));
  const leaving = existing.filter(q => !keptIds.has(q.id));
  const mustStay = [];
  leaving.forEach(q => {
    const n = answerCount(db, q.id);
    if (n > 0) {
      // Apagar uma pergunta respondida levaria junto a apuração dela.
      blocked.push({ questionId: q.id, text: q.text, reason: 'remocao', responses: n });
      mustStay.push(q);
    } else {
      db.prepare('DELETE FROM question_dimension_links WHERE question_id = ?').run(q.id);
      db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
      logChange(db, ctx, q.id, 'removida', null, q.text, null, uuid);
      removed++;
    }
  });

  // Lista final: o que veio, na ordem recebida. Resolver a ordem só aqui evita
  // renumerar o questionário por causa de uma remoção que acabou sendo recusada.
  const finalList = (incoming || []).map(q => ({ incoming: q }));
  // Quem foi barrado de sair volta para a posição que ocupava, não para o fim:
  // a pergunta continua onde o respondente a viu.
  const idAt = e => e.keep ? e.keep.id : (e.incoming && e.incoming.id);
  mustStay.forEach(q => {
    const origIdx = existing.findIndex(x => x.id === q.id);
    let at = 0;
    for (let i = origIdx - 1; i >= 0; i--) {
      const pos = finalList.findIndex(e => idAt(e) === existing[i].id);
      if (pos >= 0) { at = pos + 1; break; }
    }
    finalList.splice(at, 0, { keep: q });
  });

  // ── Fase 2: grava conteúdo ──
  const insQ = db.prepare(INSERT_SQL);
  const updQ = db.prepare(UPDATE_SQL);
  const ids = [];

  finalList.forEach((entry, i) => {
    const order = i + 1;
    if (entry.keep) { ids.push(entry.keep.id); return; }

    const q = entry.incoming;
    const row = toRow(q, order);
    if (!row.text) { ids.push(null); return; }
    const prev = q.id && byId[q.id] ? byId[q.id] : null;

    if (!prev) {
      const id = uuid();
      insQ.run(...insertParams(id, surveyId, row));
      setDimensions(db, id, strList(q.dimensions) || [], ctx, uuid);
      logChange(db, ctx, id, 'criada', null, null, row.text, uuid);
      ids.push(id); inserted++;
      return;
    }

    const n = answerCount(db, prev.id);
    if (n > 0) {
      // Trocar o tipo muda o formato do que já foi gravado: a apuração viraria lixo.
      if (row.type !== prev.type) {
        blocked.push({ questionId: prev.id, text: prev.text, reason: 'tipo', responses: n });
        ids.push(prev.id); return;
      }
      // Encurtar a escala abaixo do que já foi respondido deixaria resposta sem rótulo.
      const newCount = row.options ? JSON.parse(row.options).length : 0;
      const maxPos = maxRecordedPosition(db, prev.id, row.type);
      if (newCount && maxPos > newCount) {
        blocked.push({ questionId: prev.id, text: prev.text, reason: 'alternativas', responses: n, minOptions: maxPos });
        ids.push(prev.id); return;
      }
    }

    TRACKED.forEach(([f, label]) => {
      if (String(prev[f] ?? '') !== String(row[f] ?? '')) logChange(db, ctx, prev.id, 'editada', label, prev[f], row[f], uuid);
    });
    updQ.run(...updateParams(prev.id, row));

    const before = dimensionsAt(db, prev.id).slice().sort().join(',');
    const diff = setDimensions(db, prev.id, strList(q.dimensions) || [], ctx, uuid);
    const after = dimensionsAt(db, prev.id).slice().sort().join(',');
    if (diff.added.length || diff.removed.length || diff.windowsOnly || before !== after) {
      logChange(db, ctx, prev.id,
        (ctx && ctx.retroactive === false) ? 'reclassificada (prospectivo)' : 'reclassificada (retroativo)',
        'Dimensões', before, after, uuid);
    }
    ids.push(prev.id); updated++;
  });

  // ── Fase 3: numera o questionário final, inclusive o que foi barrado ──
  const setOrder = db.prepare('UPDATE questions SET order_num = ? WHERE id = ?');
  ids.forEach((id, i) => { if (id) setOrder.run(i + 1, id); });

  return { ids, inserted, updated, removed, blocked };
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
    notes:         r.notes || '',
  };
}

module.exports = {
  OPTION_TYPES, VALID_TYPES, FIELD_KINDS,
  hasOptions, parseJSON, strList, jsonList, pointList, defaultFavorableFrom,
  toRow, insertQuestions, replaceQuestions, syncQuestions, fromRow,
  dimensionsAt, setDimensions,
  INSERT_SQL, UPDATE_SQL, insertParams, updateParams,
};
