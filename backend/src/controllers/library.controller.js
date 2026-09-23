'use strict';
const { getDB } = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const Q = require('../utils/questions');

/* Banco de perguntas e comparação entre edições.
 *
 * O banco NÃO é um cadastro à parte: é o catálogo do que o RH já usou, montado a partir
 * das próprias pesquisas do tenant. Assim ele nasce cheio (as 30 da Clima já estão lá),
 * nunca fica defasado e mostra onde cada pergunta foi aplicada — que é a informação que
 * decide se ela serve para o instrumento novo.
 *
 * A comparação entre edições casa as perguntas pelo ID externo (Q1…Q30), que é o que
 * sobrevive a uma reformulação de texto; sem ID, cai no texto normalizado. */

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/* Chave de identidade de uma pergunta entre instrumentos. */
function keyOf(q) {
  const ext = String(q.external_id || '').trim();
  return ext ? 'id:' + ext.toLowerCase() : 'txt:' + norm(q.text);
}

/* GET /library/questions?q=&dimension=&type=&exclude=<surveyId>
 *
 * Catálogo das perguntas já usadas, agrupadas por identidade. Cada entrada traz o texto
 * mais recente, a dimensão vigente e em que pesquisas apareceu. */
function listQuestions(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const rows = db.prepare(`
      SELECT q.*, s.id AS survey_id, s.name AS survey_name, s.category AS survey_category,
             s.status AS survey_status, s.published_at
      FROM questions q JOIN surveys s ON s.id = q.survey_id
      WHERE s.tenant_id = ? AND s.status != 'excluido'
      ORDER BY COALESCE(s.published_at, s.created_at) DESC, q.order_num`).all(t);

    // Dimensões vigentes de cada pergunta (as encerradas não descrevem o que ela é hoje).
    const now = new Date().toISOString();
    const dims = {};
    db.prepare(`SELECT l.question_id, l.effective_from, l.effective_to, d.name, ds.name AS set_name, ds.code AS set_code
                FROM question_dimension_links l
                JOIN dimensions d ON d.id = l.dimension_id
                LEFT JOIN dimension_sets ds ON ds.id = d.set_id
                JOIN questions q ON q.id = l.question_id
                JOIN surveys s ON s.id = q.survey_id
                WHERE s.tenant_id = ?`).all(t)
      .filter(l => (!l.effective_from || l.effective_from <= now) && (!l.effective_to || l.effective_to > now))
      .forEach(l => (dims[l.question_id] = dims[l.question_id] || []).push({ name: l.name, set: l.set_name, setCode: l.set_code }));

    const answers = {};
    db.prepare(`SELECT a.question_id, COUNT(*) c FROM answers a
                JOIN questions q ON q.id = a.question_id
                JOIN surveys s ON s.id = q.survey_id
                WHERE s.tenant_id = ? GROUP BY a.question_id`).all(t)
      .forEach(r => answers[r.question_id] = r.c);

    const byKey = new Map();
    rows.forEach(r => {
      const q = Q.fromRow(r);
      const key = keyOf(q);
      const uso = { surveyId: r.survey_id, surveyName: r.survey_name, category: r.survey_category,
                    status: r.survey_status, publishedAt: r.published_at, answers: answers[r.id] || 0 };
      const cur = byKey.get(key);
      if (!cur) {
        // A primeira linha é a da pesquisa mais recente: é ela que define o conteúdo.
        byKey.set(key, {
          key, externalId: q.external_id || null, type: q.type,
          text: q.text, text_en: q.text_en || '', text_es: q.text_es || '',
          options: q.options, options_en: q.options_en, options_es: q.options_es,
          option_points: q.option_points, config: q.config, required: q.required,
          notes: q.notes || '', dimensions: dims[r.id] || [],
          usedIn: [uso], totalAnswers: uso.answers,
        });
      } else {
        cur.usedIn.push(uso);
        cur.totalAnswers += uso.answers;
      }
    });

    let list = [...byKey.values()];

    // A pesquisa que está sendo montada não precisa se ver no catálogo.
    const exclude = String(req.query.exclude || '').trim();
    if (exclude) {
      list = list.filter(x => !(x.usedIn.length === 1 && x.usedIn[0].surveyId === exclude));
      list.forEach(x => { x.alreadyHere = x.usedIn.some(u => u.surveyId === exclude); });
    }

    const term = norm(req.query.q);
    if (term) list = list.filter(x => norm(x.text).includes(term) || String(x.externalId || '').toLowerCase().includes(term));
    const dim = norm(req.query.dimension);
    if (dim) list = list.filter(x => x.dimensions.some(d => norm(d.name) === dim));
    const type = String(req.query.type || '').trim();
    if (type) list = list.filter(x => x.type === type);

    // Mais usada primeiro: é a pergunta que o RH já consolidou.
    list.sort((a, b) => b.usedIn.length - a.usedIn.length ||
      String(a.externalId || a.text).localeCompare(String(b.externalId || b.text), 'pt', { numeric: true }));

    return ok(res, {
      questions: list,
      total: list.length,
      dimensions: [...new Set([...byKey.values()].flatMap(x => x.dimensions.map(d => d.name)))].sort((a, b) => a.localeCompare(b, 'pt')),
    });
  } catch (e) { return err(res, 'Erro ao carregar o banco de perguntas', 500, e.message); }
}

/* GET /library/compare?a=<surveyId>&b=<surveyId>
 *
 * Compara dois instrumentos pergunta a pergunta: o que continua igual, o que mudou de
 * texto, o que mudou de dimensão, o que entrou e o que saiu. É a checagem antes de pôr a
 * edição nova na rua — mudança de texto ou de dimensão quebra a série histórica, e é
 * melhor descobrir isso agora do que na hora de comparar os resultados. */
function compare(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const get = id => db.prepare("SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(id, t);
    const a = get(String(req.query.a || '').trim());
    const b = get(String(req.query.b || '').trim());
    if (!a || !b) return notFound(res, 'Pesquisa');
    if (a.id === b.id) return badReq(res, 'Escolha duas pesquisas diferentes para comparar');

    const load = (sv) => {
      const qs = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(sv.id).map(Q.fromRow);
      const now = new Date().toISOString();
      const dims = {};
      db.prepare(`SELECT l.question_id, l.effective_from, l.effective_to, d.name, ds.code AS set_code
                  FROM question_dimension_links l
                  JOIN dimensions d ON d.id = l.dimension_id
                  LEFT JOIN dimension_sets ds ON ds.id = d.set_id
                  JOIN questions q ON q.id = l.question_id WHERE q.survey_id = ?`).all(sv.id)
        .filter(l => (!l.effective_from || l.effective_from <= now) && (!l.effective_to || l.effective_to > now))
        .forEach(l => (dims[l.question_id] = dims[l.question_id] || []).push({ name: l.name, setCode: l.set_code }));
      const map = new Map();
      qs.forEach(q => map.set(keyOf(q), { q, dims: (dims[q.id] || []).sort((x, y) => x.name.localeCompare(y.name)) }));
      return map;
    };

    const A = load(a), B = load(b);
    const dimLabel = d => d.map(x => x.name).join(' · ');
    const rows = [];

    // Ordem do questionário NOVO; o que saiu entra no fim, para não sumir da leitura.
    for (const [key, itB] of B) {
      const itA = A.get(key);
      if (!itA) {
        rows.push({ key, status: 'nova', externalId: itB.q.external_id || null,
                    textB: itB.q.text, dimensionsB: dimLabel(itB.dims), typeB: itB.q.type });
        continue;
      }
      const changes = [];
      if (norm(itA.q.text) !== norm(itB.q.text)) changes.push('texto');
      if (dimLabel(itA.dims) !== dimLabel(itB.dims)) changes.push('dimensao');
      if (itA.q.type !== itB.q.type) changes.push('tipo');
      if (JSON.stringify(itA.q.options || []) !== JSON.stringify(itB.q.options || [])) changes.push('alternativas');
      if (JSON.stringify(itA.q.option_points || []) !== JSON.stringify(itB.q.option_points || [])) changes.push('pesos');
      const favA = (itA.q.config || {}).favorableFrom, favB = (itB.q.config || {}).favorableFrom;
      if ((favA ?? null) !== (favB ?? null)) changes.push('favorabilidade');
      rows.push({
        key, status: changes.length ? 'alterada' : 'igual', changes,
        externalId: itB.q.external_id || itA.q.external_id || null,
        textA: itA.q.text, textB: itB.q.text,
        dimensionsA: dimLabel(itA.dims), dimensionsB: dimLabel(itB.dims),
        typeA: itA.q.type, typeB: itB.q.type,
        optionsA: itA.q.options, optionsB: itB.q.options,
      });
    }
    for (const [key, itA] of A) {
      if (B.has(key)) continue;
      rows.push({ key, status: 'removida', externalId: itA.q.external_id || null,
                  textA: itA.q.text, dimensionsA: dimLabel(itA.dims), typeA: itA.q.type,
                  answers: db.prepare('SELECT COUNT(*) c FROM answers WHERE question_id=?').get(itA.q.id).c });
    }

    const count = st => rows.filter(r => r.status === st).length;
    return ok(res, {
      a: { id: a.id, name: a.name, category: a.category, publishedAt: a.published_at, questions: A.size },
      b: { id: b.id, name: b.name, category: b.category, publishedAt: b.published_at, questions: B.size },
      rows,
      summary: { igual: count('igual'), alterada: count('alterada'), nova: count('nova'), removida: count('removida'),
                 // Mudança de texto ou de dimensão é o que impede comparar o resultado.
                 comparaveis: rows.filter(r => r.status === 'igual' ||
                   (r.status === 'alterada' && !r.changes.includes('texto') && !r.changes.includes('dimensao'))).length },
    });
  } catch (e) { return err(res, 'Erro ao comparar edições', 500, e.message); }
}

module.exports = { listQuestions, compare };
