'use strict';
const PDFDocument = require('pdfkit');
const { getDB }                                       = require('../config/database');
const { calculateNPS, calculateAverage, calculateFrequency, calculateNPSWeighted, calculateAverageWeighted } = require('../utils/nps');
const { ok, err, notFound, badReq }                   = require('../utils/response');
const Q                                               = require('../utils/questions');
const logger                                          = require('../utils/logger');
const { canSeeSurvey, responseScopeSQL, scopeDistritos } = require('../utils/scope');

/* GET /results/:surveyId */
function getSurveyResults(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.surveyId, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    // Supressão por tipo de avaliação (ex.: Gestor não abre a Avaliação de Gestores).
    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para ver os resultados desta pesquisa', 403);

    // Escopo do usuário: um Gestor amarrado a um distrito só enxerga as respostas dele.
    const scope = responseScopeSQL(db, req.user, 'r');
    const respWhere = `r.survey_id = ? AND r.completed_at IS NOT NULL${scope.sql}`;

    const questions   = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const totalResp   = db.prepare(`SELECT COUNT(*) as cnt FROM responses r WHERE ${respWhere}`).get(survey.id, ...scope.params).cnt;
    const startedResp = db.prepare(`SELECT COUNT(*) as cnt FROM responses r WHERE r.survey_id = ?${scope.sql}`).get(survey.id, ...scope.params).cnt;
    let gScoreSum = 0, gScoreN = 0; // acumulador da média geral atingida (pontuação por opção)

    const answersOf = db.prepare(`SELECT a.value_text, a.value_num, a.value_json
      FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE a.question_id = ? AND ${respWhere}`);

    const dimsByQuestion = {};
    db.prepare(`SELECT qd.question_id, d.id, d.name, ds.name AS set_name
                FROM question_dimensions qd
                JOIN dimensions d ON d.id = qd.dimension_id
                LEFT JOIN dimension_sets ds ON ds.id = d.set_id
                JOIN questions q ON q.id = qd.question_id
                WHERE q.survey_id = ?`).all(survey.id)
      .forEach(r => (dimsByQuestion[r.question_id] = dimsByQuestion[r.question_id] || []).push({ id: r.id, name: r.name, set: r.set_name }));

    const questionResults = questions.map(q => {
      const answers = answersOf.all(q.id, survey.id, ...scope.params);
      const cfg     = Q.parseJSON(q.config) || {};
      const qOpts   = Q.parseJSON(q.options);
      const pts     = Q.parseJSON(q.option_points);
      const neutral = Number.isInteger(cfg.neutralIndex) ? cfg.neutralIndex : null;

      let result = {
        questionId: q.id, type: q.type, text: q.text, responseCount: answers.length,
        options: qOpts || null, required: q.required !== 0,
        neutralIndex: neutral, neutralLabel: (neutral != null && qOpts) ? qOpts[neutral] : null,
        dimensions: dimsByQuestion[q.id] || [],
      };

      if (q.type === 'nps') {
        const scores = answers.map(a => a.value_num).filter(v => v !== null);
        result = { ...result, ...calculateNPS(scores) };

      } else if (q.type === 'scale' || q.type === 'rating') {
        const values = answers.map(a => a.value_num).filter(v => v !== null);
        // A opção neutra ("Não se aplica") sai da média e do denominador.
        const scored = neutral != null ? values.filter(v => v !== neutral + 1) : values;
        result.average = calculateAverage(scored);
        result.neutralCount = values.length - scored.length;
        // Distribuição rotulada: mostra "Às vezes · 12 (50%)" em vez de só "3 · 50%".
        result.distribution = labelledDistribution(values, qOpts, q.type === 'rating' ? 5 : (qOpts ? qOpts.length : 5));
        result.choices = result.distribution;

      } else if (q.type === 'multiple' || q.type === 'dropdown') {
        const all = answers.flatMap(a => {
          if (a.value_json) { try { const v = JSON.parse(a.value_json); return Array.isArray(v) ? v : [v]; } catch { return []; } }
          return a.value_text ? [a.value_text] : [];
        });
        const totalR = answers.length || 1;
        // Mantém a ordem das alternativas cadastradas e acrescenta as respostas "Outros".
        const known = (qOpts || []).map(label => {
          const count = all.filter(v => String(v) === label).length;
          return { value: label, label, count, pct: Math.round((count / totalR) * 100) };
        });
        const extras = calculateFrequency(all.map(String).filter(v => !(qOpts || []).includes(v)))
          .map(f => ({ value: f.value, label: f.value, count: f.count, pct: Math.round((f.count / totalR) * 100), other: true }));
        result.choices = known.concat(extras);
        result.frequency = result.choices;

      } else if (q.type === 'yesno') {
        const values  = answers.map(a => a.value_text);
        const yes     = values.filter(v => v === 'true' || v === 'sim' || v === '1').length;
        const no      = values.length - yes;
        result.yes    = yes;
        result.no     = no;
        result.yesPct = values.length ? Math.round((yes / values.length) * 100) : 0;
        result.choices = [
          { value: 'Sim', label: 'Sim', count: yes, pct: result.yesPct },
          { value: 'Não', label: 'Não', count: no,  pct: values.length ? 100 - result.yesPct : 0 },
        ];

      } else if (q.type === 'matrix') {
        // Uma média (e uma distribuição) por linha da matriz.
        const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
        const byRow = {};
        answers.forEach(a => {
          let v = null; try { v = a.value_json ? JSON.parse(a.value_json) : null; } catch {}
          if (!v || typeof v !== 'object') return;
          rows.forEach(rowLabel => {
            const pos = Number(v[rowLabel]);
            if (pos > 0) (byRow[rowLabel] = byRow[rowLabel] || []).push(pos);
          });
        });
        result.rows = rows.map(rowLabel => {
          const vals = byRow[rowLabel] || [];
          const scored = neutral != null ? vals.filter(x => x !== neutral + 1) : vals;
          return {
            label: rowLabel, count: vals.length, average: calculateAverage(scored),
            distribution: labelledDistribution(vals, qOpts, qOpts ? qOpts.length : 5),
          };
        });
        const flat = Object.values(byRow).flat();
        result.average = calculateAverage(neutral != null ? flat.filter(x => x !== neutral + 1) : flat);

      } else if (q.type === 'form') {
        // Bloco de campos: devolve as respostas por campo, para leitura/exportação.
        const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        const byField = {};
        answers.forEach(a => {
          let v = null; try { v = a.value_json ? JSON.parse(a.value_json) : null; } catch {}
          if (!v || typeof v !== 'object') return;
          fields.forEach(f => { const val = String(v[f.label] ?? '').trim(); if (val) (byField[f.label] = byField[f.label] || []).push(val); });
        });
        result.fields = fields.map(f => ({ label: f.label, kind: f.kind, count: (byField[f.label] || []).length, responses: (byField[f.label] || []).slice(0, 200) }));

      } else if (q.type === 'text') {
        result.responses = answers.map(a => a.value_text).filter(Boolean).slice(0, 50);
      }

      // Pontuação por opção (%) — quando a pergunta tem pesos definidos por alternativa.
      if (pts && pts.length) {
        const opts = qOpts || [];
        let sum = 0, n = 0;
        const earn = (a) => {
          if (q.type === 'scale' || q.type === 'rating') {
            const pos = a.value_num;
            // A opção neutra não pontua nem entra no denominador.
            if (pos == null || (neutral != null && pos === neutral + 1)) return null;
            return pts[pos - 1] != null ? Number(pts[pos - 1]) : null;
          }
          if (q.type === 'multiple' || q.type === 'dropdown') {
            let sel = []; try { sel = JSON.parse(a.value_json || '[]'); } catch {}
            if (!Array.isArray(sel)) sel = [sel];
            const vals = sel.map(l => { const idx = opts.indexOf(l); return (idx >= 0 && idx !== neutral && pts[idx] != null) ? Number(pts[idx]) : null; }).filter(v => v != null);
            return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
          }
          if (q.type === 'matrix') {
            let v = null; try { v = a.value_json ? JSON.parse(a.value_json) : null; } catch {}
            if (!v || typeof v !== 'object') return null;
            const vals = Object.values(v).map(Number)
              .filter(pos => pos > 0 && !(neutral != null && pos === neutral + 1))
              .map(pos => (pts[pos - 1] != null ? Number(pts[pos - 1]) : null)).filter(x => x != null);
            return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
          }
          return null;
        };
        answers.forEach(a => { const e = earn(a); if (e != null) { sum += e; n++; } });
        if (n) result.scorePct = Math.round(sum / n);
        gScoreSum += sum; gScoreN += n;
      }

      // Comentários livres (value_text) — aparecem mesmo se a pergunta não for do tipo "texto"
      // (ex.: campo "Outros" preenchido, ou pergunta sem opções respondida como texto).
      if (q.type !== 'text' && q.type !== 'form') {
        const skip = new Set(['true', 'false', 'sim', 'não', 'nao', 'yes', 'no', '1', '0']);
        const comments = answers.map(a => a.value_text).filter(v => v != null && String(v).trim() !== '' && !skip.has(String(v).trim().toLowerCase()));
        if (comments.length) result.comments = comments.slice(0, 300);
      }

      return result;
    });

    // Overall NPS (first NPS question)
    const npsQ = questionResults.find(q => q.type === 'nps');

    return ok(res, {
      survey:       { ...survey, totalResponses: totalResp, startedResponses: startedResp },
      completionRate: startedResp > 0 ? Math.round((totalResp / startedResp) * 100) : 0,
      overallNPS:   npsQ ? { nps: npsQ.nps, classification: npsQ.classification } : null,
      overallScore: gScoreN ? Math.round(gScoreSum / gScoreN) : null,
      questions:    questionResults,
      dimensions:   dimensionSummary(questionResults),
      scoped:       !!scope.sql,
    });
  } catch (e) { return err(res, 'Erro ao carregar resultados', 500, e.message); }
}

/* Distribuição já rotulada: cada posição vira { value, label, count, pct }.
   `value` continua sendo o número (1..n) para não quebrar quem lê por posição. */
function labelledDistribution(values, options, size) {
  const total = values.length;
  if (!total) return [];
  const n = Math.max(size || 0, ...values.map(v => Math.round(v) || 0));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const count = values.filter(v => Math.round(v) === i).length;
    const label = (options && options[i - 1]) ? options[i - 1] : String(i);
    out.push({ value: String(i), label, count, pct: total ? Math.round((count / total) * 100) : 0 });
  }
  return out;
}

/* Consolida a nota por dimensão (média das perguntas vinculadas a cada dimensão). */
function dimensionSummary(questionResults) {
  const acc = {};
  questionResults.forEach(q => {
    (q.dimensions || []).forEach(d => {
      const e = acc[d.id] = acc[d.id] || { id: d.id, name: d.name, set: d.set, questions: 0, scoreSum: 0, scoreN: 0, avgSum: 0, avgN: 0, responses: 0 };
      e.questions++;
      e.responses += q.responseCount || 0;
      if (typeof q.scorePct === 'number') { e.scoreSum += q.scorePct; e.scoreN++; }
      if (typeof q.average === 'number' && q.average > 0) { e.avgSum += q.average; e.avgN++; }
    });
  });
  return Object.values(acc).map(e => ({
    id: e.id, name: e.name, set: e.set, questions: e.questions, responses: e.responses,
    scorePct: e.scoreN ? Math.round(e.scoreSum / e.scoreN) : null,
    average:  e.avgN ? parseFloat((e.avgSum / e.avgN).toFixed(2)) : null,
  })).sort((a, b) => (a.set || '').localeCompare(b.set || '') || a.name.localeCompare(b.name));
}

/* GET /results/dashboard  — aggregate across all surveys */
function getDashboard(req, res) {
  try {
    const db    = getDB();
    const scope = responseScopeSQL(db, req.user, 'r');
    // O painel respeita o mesmo recorte dos resultados: categoria suprimida some da conta,
    // e um Gestor de distrito só soma as respostas do próprio distrito.
    const all   = db.prepare("SELECT * FROM surveys WHERE tenant_id=? AND status != 'excluido' ORDER BY created_at DESC").all(req.user.tenant_id)
                    .filter(sv => canSeeSurvey(req.user, sv));
    const totalSurveys = all.length;
    const active       = all.filter(sv => sv.status === 'ativo').length;
    const countResp    = db.prepare(`SELECT COUNT(*) as cnt FROM responses r WHERE r.survey_id=? AND r.completed_at IS NOT NULL${scope.sql}`);
    const totalResp    = all.reduce((acc, sv) => acc + countResp.get(sv.id, ...scope.params).cnt, 0);
    const recent       = all.slice(0, 5).map(sv => ({ ...sv, responses: countResp.get(sv.id, ...scope.params).cnt }));

    return ok(res, { totalSurveys, active, totalResponses: totalResp, recentSurveys: recent });
  } catch (e) { return err(res, 'Erro ao carregar dashboard', 500, e.message); }
}


/* POST /results/insights  — gera relatório executivo a partir de resultados REAIS */
// Relatório a partir dos números reais — usado quando a IA não está configurada ou falha.
function dataReport(lang, ctx) {
  const { surveyName, totalResp, taxaConclusao, overallNps, npsClass, perguntas } = ctx;
  const scale = (perguntas || []).filter(p => (p.tipo === 'scale' || p.tipo === 'rating') && typeof p.media === 'number' && p.media > 0).sort((a, b) => b.media - a.media);
  const best = scale[0], worst = scale.length > 1 ? scale[scale.length - 1] : null;
  const yn = (perguntas || []).filter(p => p.tipo === 'yesno' && typeof p.simPct === 'number');
  // Temas dos comentários abertos com contagem; sem eles, cai nas respostas cruas.
  const temas = (ctx.temasComentarios && ctx.temasComentarios.length)
    ? ctx.temasComentarios.slice(0, 8).map(t => `${t.tema} — ${t.count} menç${t.count === 1 ? 'ão' : 'ões'}`)
    : (perguntas || []).flatMap(p => Array.isArray(p.respostasAbertas) ? p.respostasAbertas : []).slice(0, 5);

  const L = {
    pt: {
      resumo: `A pesquisa "${surveyName}" recebeu ${totalResp} resposta(s) concluída(s), com taxa de conclusão de ${taxaConclusao}%.` + (overallNps !== null ? ` O NPS geral é ${overallNps}.` : ''),
      npsBom: n => `NPS de ${n} indica boa percepção geral.`, maiorNota: (q, m) => `Maior nota: "${q}" (média ${m}).`, ynAlto: (q, p) => `"${q}": ${p}% de respostas positivas.`, semForte: 'Volume de respostas suficiente para análise.',
      npsNeg: n => `NPS negativo (${n}): atenção à satisfação geral.`, menorNota: (q, m) => `Menor nota: "${q}" (média ${m}) — priorizar.`, txBaixa: tx => `Taxa de conclusão baixa (${tx}%): revisar tamanho/abordagem.`, semResp: 'Esta pesquisa ainda não recebeu respostas.', semAtencao: 'Sem pontos críticos evidentes nos números.',
      recom: ['Aprofundar os temas de menor nota com os times.', 'Reconhecer e manter as áreas de destaque.', 'Repetir a medição para acompanhar a evolução.'],
      prioWorst: q => `Agir no ponto de menor nota: "${q}".`, prioNps: 'Priorizar ações de satisfação (NPS negativo).', prioOk: 'Manter o acompanhamento dos indicadores.',
      bench: overallNps !== null ? `NPS ${overallNps} — referência: acima de 50 é bom, acima de 0 é neutro, abaixo de 0 é crítico.` : 'Defina metas internas para comparar as próximas medições.',
    },
    en: {
      resumo: `The survey "${surveyName}" received ${totalResp} completed response(s), with a completion rate of ${taxaConclusao}%.` + (overallNps !== null ? ` The overall NPS is ${overallNps}.` : ''),
      npsBom: n => `An NPS of ${n} indicates good overall perception.`, maiorNota: (q, m) => `Highest score: "${q}" (avg ${m}).`, ynAlto: (q, p) => `"${q}": ${p}% positive responses.`, semForte: 'Enough responses collected for analysis.',
      npsNeg: n => `Negative NPS (${n}): watch overall satisfaction.`, menorNota: (q, m) => `Lowest score: "${q}" (avg ${m}) — prioritize.`, txBaixa: tx => `Low completion rate (${tx}%): review survey length/approach.`, semResp: 'This survey has not received any responses yet.', semAtencao: 'No critical issues evident in the numbers.',
      recom: ['Dig deeper into the lowest-scoring topics with the teams.', 'Recognize and maintain the standout areas.', 'Repeat the measurement to track progress.'],
      prioWorst: q => `Act on the lowest-scoring item: "${q}".`, prioNps: 'Prioritize satisfaction actions (negative NPS).', prioOk: 'Keep monitoring the indicators.',
      bench: overallNps !== null ? `NPS ${overallNps} — reference: above 50 good, above 0 neutral, below 0 critical.` : 'Set internal targets to compare future measurements.',
    },
    es: {
      resumo: `La encuesta "${surveyName}" recibió ${totalResp} respuesta(s) completada(s), con una tasa de finalización del ${taxaConclusao}%.` + (overallNps !== null ? ` El NPS general es ${overallNps}.` : ''),
      npsBom: n => `Un NPS de ${n} indica buena percepción general.`, maiorNota: (q, m) => `Nota más alta: "${q}" (promedio ${m}).`, ynAlto: (q, p) => `"${q}": ${p}% de respuestas positivas.`, semForte: 'Volumen de respuestas suficiente para el análisis.',
      npsNeg: n => `NPS negativo (${n}): atención a la satisfacción general.`, menorNota: (q, m) => `Nota más baja: "${q}" (promedio ${m}) — priorizar.`, txBaixa: tx => `Tasa de finalización baja (${tx}%): revisar tamaño/enfoque.`, semResp: 'Esta encuesta aún no ha recibido respuestas.', semAtencao: 'Sin puntos críticos evidentes en los números.',
      recom: ['Profundizar en los temas de menor nota con los equipos.', 'Reconocer y mantener las áreas destacadas.', 'Repetir la medición para seguir la evolución.'],
      prioWorst: q => `Actuar en el punto de menor nota: "${q}".`, prioNps: 'Priorizar acciones de satisfacción (NPS negativo).', prioOk: 'Mantener el seguimiento de los indicadores.',
      bench: overallNps !== null ? `NPS ${overallNps} — referencia: más de 50 bueno, más de 0 neutro, menos de 0 crítico.` : 'Define metas internas para comparar próximas mediciones.',
    },
  }[lang] || {};

  const fortes = [], atencao = [];
  if (overallNps !== null && overallNps >= 50) fortes.push(L.npsBom(overallNps));
  if (best) fortes.push(L.maiorNota(best.pergunta, best.media));
  yn.filter(q => q.simPct >= 70).slice(0, 1).forEach(q => fortes.push(L.ynAlto(q.pergunta, q.simPct)));
  if (!fortes.length) fortes.push(L.semForte);
  if (totalResp === 0) atencao.push(L.semResp);
  if (overallNps !== null && overallNps < 0) atencao.push(L.npsNeg(overallNps));
  if (worst) atencao.push(L.menorNota(worst.pergunta, worst.media));
  if (taxaConclusao < 50 && totalResp > 0) atencao.push(L.txBaixa(taxaConclusao));
  if (!atencao.length) atencao.push(L.semAtencao);
  const prio = worst ? L.prioWorst(worst.pergunta) : (overallNps !== null && overallNps < 0 ? L.prioNps : L.prioOk);

  return { resumo: L.resumo, npsClassificacao: npsClass, pontosFortesArr: fortes, pontosAtencaoArr: atencao, recomendacoesArr: L.recom, temasAbertosArr: temas, prioridadeImediata: prio, benchmarkTexto: L.bench };
}

/* Agrupa comentários abertos por tema, com contagem. Roda sempre (sem depender da IA),
   por palavras-chave do vocabulário de clima/gestão usado nas pesquisas da RGIS. */
const SKIP_COMMENT = new Set(['true', 'false', 'sim', 'não', 'nao', 'yes', 'no']);

const TEMAS = [
  { tema: 'Liderança e gestão',        termos: ['gestor', 'gestão', 'lider', 'liderança', 'chefe', 'supervisor', 'coordenador', 'gerente'] },
  { tema: 'Comunicação',               termos: ['comunica', 'informa', 'aviso', 'transparen', 'feedback', 'retorno'] },
  { tema: 'Reconhecimento',            termos: ['reconhec', 'valoriza', 'elogio', 'mérito', 'merito', 'promoç', 'promoc'] },
  { tema: 'Remuneração e benefícios',  termos: ['salário', 'salario', 'remunera', 'benefício', 'beneficio', 'vale', 'plano de saúde', 'plano de saude', 'pagamento'] },
  { tema: 'Carga de trabalho',         termos: ['sobrecarga', 'carga', 'prazo', 'pressão', 'pressao', 'hora extra', 'cansa', 'exaust', 'estresse', 'stress'] },
  { tema: 'Jornada e escala',          termos: ['escala', 'jornada', 'turno', 'horário', 'horario', 'folga', 'férias', 'ferias'] },
  { tema: 'Treinamento e carreira',    termos: ['treinamento', 'capacita', 'curso', 'carreira', 'crescimento', 'desenvolv', 'aprend'] },
  { tema: 'Equipe e relacionamento',   termos: ['equipe', 'colega', 'time', 'convív', 'conviv', 'relacionamento', 'respeito', 'clima'] },
  { tema: 'Condições e estrutura',     termos: ['estrutura', 'equipamento', 'ferramenta', 'material', 'transporte', 'uniforme', 'refeit', 'instala'] },
  { tema: 'Segurança e saúde',         termos: ['segurança', 'seguranca', 'acidente', 'epi', 'saúde', 'saude', 'risco', 'assédio', 'assedio'] },
  { tema: 'Processos e sistemas',      termos: ['processo', 'sistema', 'burocra', 'procedimento', 'contagem', 'inventário', 'inventario'] },
];

function agruparComentarios(comentarios) {
  const norm = s => String(s || '').toLowerCase();
  const buckets = TEMAS.map(t => ({ tema: t.tema, count: 0, exemplos: [] }));
  const outros = { tema: 'Outros', count: 0, exemplos: [] };
  (comentarios || []).forEach(c => {
    const txt = norm(c);
    if (txt.trim().length < 3) return;
    let matched = false;
    TEMAS.forEach((t, i) => {
      if (t.termos.some(k => txt.includes(k))) {
        buckets[i].count++;
        if (buckets[i].exemplos.length < 3) buckets[i].exemplos.push(String(c).slice(0, 240));
        matched = true;
      }
    });
    if (!matched) { outros.count++; if (outros.exemplos.length < 3) outros.exemplos.push(String(c).slice(0, 240)); }
  });
  return buckets.concat(outros).filter(b => b.count > 0).sort((a, b) => b.count - a.count);
}

/* Chamada à Anthropic com timeout — sem isso a requisição podia ficar pendurada até o
   gateway derrubar a conexão, e o painel mostrava "Erro de conexão com o servidor". */
async function callAnthropic(apiKey, body, timeoutMs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 55000);
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) { const et = await resp.text().catch(() => ''); throw new Error('Anthropic ' + resp.status + ' ' + et.slice(0, 160)); }
    return await resp.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Tempo esgotado ao falar com a IA');
    throw e;
  } finally { clearTimeout(timer); }
}

async function getInsights(req, res) {
  try {
    const db     = getDB();
    const id     = req.body.surveyId || req.params.surveyId;
    const lang   = (req.body.lang === 'en' || req.body.lang === 'es') ? req.body.lang : 'pt';
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para ver os resultados desta pesquisa', 403);
    const scope = responseScopeSQL(db, req.user, 'r');
    const respWhere = `r.survey_id = ? AND r.completed_at IS NOT NULL${scope.sql}`;

    const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const totalResp = db.prepare(`SELECT COUNT(*) c FROM responses r WHERE ${respWhere}`).get(survey.id, ...scope.params).c;
    const started   = db.prepare(`SELECT COUNT(*) c FROM responses r WHERE r.survey_id=?${scope.sql}`).get(survey.id, ...scope.params).c;

    const dimsByQuestion = {};
    db.prepare(`SELECT qd.question_id, d.name, ds.name AS set_name FROM question_dimensions qd
                JOIN dimensions d ON d.id = qd.dimension_id
                LEFT JOIN dimension_sets ds ON ds.id = d.set_id
                JOIN questions q ON q.id = qd.question_id WHERE q.survey_id = ?`).all(survey.id)
      .forEach(r => (dimsByQuestion[r.question_id] = dimsByQuestion[r.question_id] || []).push(r.set_name ? `${r.set_name} › ${r.name}` : r.name));

    const answersOf = db.prepare(`SELECT a.value_text, a.value_num FROM answers a
      JOIN responses r ON r.id = a.response_id WHERE a.question_id = ? AND ${respWhere}`);

    let overallNps = null;
    const todosComentarios = [];
    const perguntas = questions.map(q => {
      const answers = answersOf.all(q.id, survey.id, ...scope.params);
      const dimensoes = dimsByQuestion[q.id] || [];
      // Só entra como comentário aberto o que é texto de verdade: tokens de sim/não e
      // números soltos não são tema.
      const livres = answers.map(a => a.value_text)
        .filter(v => v && String(v).trim().length > 2 && !SKIP_COMMENT.has(String(v).trim().toLowerCase()) && !/^\d+$/.test(String(v).trim()));
      todosComentarios.push(...livres);
      const base = { dimensoes, categoria: survey.category || null };
      if (q.type === 'nps') {
        const sc = answers.map(a => a.value_num).filter(v => v !== null);
        const n  = calculateNPS(sc);
        if (overallNps === null) overallNps = n.nps;
        return { ...base, pergunta: q.text, tipo: 'nps', nps: n.nps, promotores: n.promoters, detratores: n.detractors };
      }
      if (q.type === 'scale' || q.type === 'rating') {
        const v = answers.map(a => a.value_num).filter(x => x !== null);
        return { ...base, pergunta: q.text, tipo: q.type, media: calculateAverage(v) };
      }
      if (q.type === 'yesno') {
        const v = answers.map(a => a.value_text);
        const yes = v.filter(x => x === 'true' || x === 'sim' || x === '1').length;
        return { ...base, pergunta: q.text, tipo: 'yesno', simPct: v.length ? Math.round(yes / v.length * 100) : 0 };
      }
      if (q.type === 'text') {
        return { ...base, pergunta: q.text, tipo: 'text', respostasAbertas: livres.slice(0, 15) };
      }
      return { ...base, pergunta: q.text, tipo: q.type };
    });

    const taxaConclusao = started > 0 ? Math.round((totalResp / started) * 100) : 0;
    const npsClass = overallNps === null ? '—' : overallNps >= 75 ? 'Excelente' : overallNps >= 50 ? 'Bom' : overallNps >= 0 ? 'Neutro' : 'Ruim';
    const temasComentarios = agruparComentarios(todosComentarios);
    const ctx = { surveyName: survey.name, totalResp, taxaConclusao, overallNps, npsClass, perguntas, temasComentarios };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your-anthropic-key-here') {
      // Modo demo — relatório a partir dos números reais, no idioma selecionado.
      const D = {
        pt: {
          resumo: `A pesquisa "${survey.name}" recebeu ${totalResp} resposta(s) concluída(s), com taxa de conclusão de ${taxaConclusao}%.` + (overallNps !== null ? ` O NPS geral é ${overallNps}.` : ''),
          fortes: ['Configure a ANTHROPIC_API_KEY no servidor para gerar a análise completa com IA.'],
          atencao: totalResp === 0 ? ['Esta pesquisa ainda não recebeu respostas.'] : ['Modo demo — recomendações detalhadas requerem IA ativa.'],
          recom: ['Ativar a IA real para recomendações estratégicas.'],
          prio: 'Configurar a chave de IA (ANTHROPIC_API_KEY) no Railway.',
          bench: 'Comparação com benchmarks disponível com IA real.',
        },
        en: {
          resumo: `The survey "${survey.name}" received ${totalResp} completed response(s), with a completion rate of ${taxaConclusao}%.` + (overallNps !== null ? ` The overall NPS is ${overallNps}.` : ''),
          fortes: ['Set ANTHROPIC_API_KEY on the server to generate the full AI analysis.'],
          atencao: totalResp === 0 ? ['This survey has not received any responses yet.'] : ['Demo mode — detailed recommendations require active AI.'],
          recom: ['Enable real AI for strategic recommendations.'],
          prio: 'Configure the AI key (ANTHROPIC_API_KEY) on Railway.',
          bench: 'Benchmark comparison available with real AI.',
        },
        es: {
          resumo: `La encuesta "${survey.name}" recibió ${totalResp} respuesta(s) completada(s), con una tasa de finalización del ${taxaConclusao}%.` + (overallNps !== null ? ` El NPS general es ${overallNps}.` : ''),
          fortes: ['Configura ANTHROPIC_API_KEY en el servidor para generar el análisis completo con IA.'],
          atencao: totalResp === 0 ? ['Esta encuesta aún no ha recibido respuestas.'] : ['Modo demostración — las recomendaciones detalladas requieren IA activa.'],
          recom: ['Activar la IA real para recomendaciones estratégicas.'],
          prio: 'Configurar la clave de IA (ANTHROPIC_API_KEY) en Railway.',
          bench: 'Comparación con benchmarks disponible con IA real.',
        },
      }[lang];
      return ok(res, { insights: dataReport(lang, ctx), temasComentarios, demo: true }, 'Insights gerados a partir dos dados (IA não configurada)');
    }

    try {
    const LANGNAME = { pt: 'português do Brasil', en: 'English', es: 'español' }[lang];
    const summary = { nome: survey.name, categoria: survey.category, respostas: totalResp, taxaConclusao, npsGeral: overallNps, perguntas, temasComentarios };
    const data = await callAnthropic(apiKey, {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 2500,
      messages: [{ role: 'user', content: `Você é especialista em RH e People Analytics. Analise os dados REAIS desta pesquisa organizacional e gere um relatório executivo.\n\nDados:\n${JSON.stringify(summary, null, 2)}\n\nCada pergunta traz o campo "dimensoes" (a que dimensão/tema ela pertence) e há um bloco "temasComentarios" com os comentários abertos já agrupados por tema e contagem. Use ambos: analise por dimensão e por tema, não pergunta a pergunta.\n\nRetorne APENAS JSON puro (sem markdown) neste formato exato (mantenha as CHAVES exatamente como estão):\n{"resumo":"2-3 frases","npsClassificacao":"","pontosFortesArr":["..."],"pontosAtencaoArr":["..."],"recomendacoesArr":["..."],"temasAbertosArr":["tema — n menções: leitura"],"analiseDimensoesArr":["dimensão: leitura dos números"],"leituraResultados":"3-5 frases de rascunho de leitura dos resultados, pronto para colar no relatório","prioridadeImediata":"...","benchmarkTexto":"..."}\n\nIMPORTANTE: Escreva TODOS os valores de texto em ${LANGNAME}. Não traduza as chaves do JSON. Deixe "npsClassificacao" como string vazia.` }]
    }, 55000);
    if (data && data.error) throw new Error(data.error.message || 'Anthropic error');
    let raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    const insights = JSON.parse(raw || '{}');
    if (!insights || typeof insights !== 'object' || !insights.resumo) throw new Error('Formato inesperado da IA');
    insights.npsClassificacao = npsClass;
    ['pontosFortesArr', 'pontosAtencaoArr', 'recomendacoesArr', 'temasAbertosArr', 'analiseDimensoesArr'].forEach(k => { if (!Array.isArray(insights[k])) insights[k] = insights[k] != null ? [String(insights[k])] : []; });
    return ok(res, { insights, temasComentarios }, 'Insights gerados com IA');
    } catch (aiErr) {
      // A IA indisponível nunca derruba o módulo: cai no relatório a partir dos números.
      logger.warn('Insights IA falhou, usando relatorio de dados: ' + (aiErr && aiErr.message));
      return ok(res, { insights: dataReport(lang, ctx), temasComentarios, aiUnavailable: true, aiError: aiErr && aiErr.message },
        'Insights gerados a partir dos dados (a IA não respondeu a tempo)');
    }
  } catch (e) { return err(res, 'Erro ao gerar insights', 500, e.message); }
}

/* GET /results/segments?surveyId= — participação + nota (NPS/média) consolidadas por distrito → regional → corporação e por departamento */
function getSegments(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const surveyId = req.query.surveyId;
    if (!surveyId) return badReq(res, 'surveyId é obrigatório');
    const survey = db.prepare('SELECT id, name, category FROM surveys WHERE id=? AND tenant_id=?').get(surveyId, t);
    if (!survey) return notFound(res, 'Pesquisa');
    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para ver os resultados desta pesquisa', 403);
    const scope = responseScopeSQL(db, req.user, 'r');

    // ── participação (respostas concluídas) ──
    const distCount = {};
    db.prepare(`SELECT r.distrito_id, COUNT(*) c FROM responses r WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND r.distrito_id IS NOT NULL${scope.sql} GROUP BY r.distrito_id`).all(surveyId, ...scope.params).forEach(r => distCount[r.distrito_id] = r.c);
    const depCount = {};
    db.prepare(`SELECT r.departamento_id, COUNT(*) c FROM responses r WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND r.departamento_id IS NOT NULL${scope.sql} GROUP BY r.departamento_id`).all(surveyId, ...scope.params).forEach(r => depCount[r.departamento_id] = r.c);

    // ── nota por segmento ──
    // Prioridade da métrica: (1) pontuação por opção (%), (2) NPS, (3) média de escala/rating.
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const scoredQ = db.prepare("SELECT id, type, options, option_points FROM questions WHERE survey_id=? AND option_points IS NOT NULL").all(surveyId)
      .map(q => ({ id: q.id, type: q.type, options: PJ(q.options) || [], points: PJ(q.option_points) || [] }))
      .filter(q => q.points.length);
    const npsIds   = db.prepare("SELECT id FROM questions WHERE survey_id=? AND type='nps'").all(surveyId).map(q => q.id);
    const scaleIds = db.prepare("SELECT id FROM questions WHERE survey_id=? AND type IN ('scale','rating')").all(surveyId).map(q => q.id);
    const metric   = scoredQ.length ? 'score' : (npsIds.length ? 'nps' : (scaleIds.length ? 'avg' : null));
    const distItems = {}, depItems = {}, allItems = [];
    const pushItem = (dd, pp, value, w) => {
      const item = { score: value, value, weight: w };
      allItems.push(item);
      if (dd) (distItems[dd] = distItems[dd] || []).push(item);
      if (pp) (depItems[pp] = depItems[pp] || []).push(item);
    };
    if (metric === 'score') {
      const qmap = {}; scoredQ.forEach(q => qmap[q.id] = q);
      const ids = scoredQ.map(q => q.id); const ph = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT r.distrito_id dd, r.departamento_id pp, COALESCE(r.weight,1) w, a.question_id qid, a.value_num vn, a.value_json vj
        FROM answers a JOIN responses r ON a.response_id = r.id
        WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND a.question_id IN (${ph})${scope.sql}`).all(surveyId, ...ids, ...scope.params);
      rows.forEach(row => {
        const q = qmap[row.qid]; if (!q) return;
        let earned = null;
        if (q.type === 'scale' || q.type === 'rating') {
          const pos = row.vn; if (pos != null && q.points[pos - 1] != null) earned = Number(q.points[pos - 1]);
        } else if (q.type === 'multiple') {
          let sel = []; try { sel = JSON.parse(row.vj || '[]'); } catch {}
          const vals = (Array.isArray(sel) ? sel : []).map(lbl => { const idx = q.options.indexOf(lbl); return (idx >= 0 && q.points[idx] != null) ? Number(q.points[idx]) : null; }).filter(v => v != null);
          if (vals.length) earned = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        if (earned != null) pushItem(row.dd, row.pp, earned, row.w);
      });
    } else if (metric === 'nps' || metric === 'avg') {
      const ids = metric === 'nps' ? npsIds : scaleIds; const ph = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT r.distrito_id dd, r.departamento_id pp, COALESCE(r.weight,1) w, a.value_num v
        FROM answers a JOIN responses r ON a.response_id = r.id
        WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND a.value_num IS NOT NULL AND a.question_id IN (${ph})${scope.sql}`).all(surveyId, ...ids, ...scope.params);
      rows.forEach(row => pushItem(row.dd, row.pp, row.v, row.w));
    }
    const scoreOf = (items) => {
      if (!metric || !items || !items.length) return { score: null, n: 0, detail: null };
      if (metric === 'nps') { const r = calculateNPSWeighted(items); return { score: r.nps, n: items.length, detail: { promoters: r.promoters, passives: r.passives, detractors: r.detractors, classification: r.classification } }; }
      if (metric === 'score') return { score: Math.round(calculateAverageWeighted(items)), n: items.length, detail: null };
      return { score: calculateAverageWeighted(items), n: items.length, detail: null };
    };

    const allowed       = scopeDistritos(db, req.user);
    const regionais     = db.prepare('SELECT id, name FROM regionais WHERE tenant_id=? ORDER BY name').all(t);
    let   distritos     = db.prepare('SELECT id, name, regional_id, meta FROM distritos WHERE tenant_id=? ORDER BY name').all(t);
    if (allowed) distritos = distritos.filter(d => allowed.includes(d.id));
    // Departamentos são um corte transversal: fora do escopo por distrito, ficam ocultos.
    const departamentos = allowed ? [] : db.prepare('SELECT id, name, meta FROM departamentos WHERE tenant_id=? ORDER BY name').all(t);
    const pct = (r, m) => m > 0 ? Math.round((r / m) * 100) : null;

    const distOut = distritos.map(d => { const sc = scoreOf(distItems[d.id]); return { id: d.id, name: d.name, regional_id: d.regional_id, responses: distCount[d.id] || 0, meta: d.meta || 0, pct: pct(distCount[d.id] || 0, d.meta || 0), score: sc.score, n: sc.n }; });
    const pub = ({ id, regional_id, ...x }) => x;
    const regBuild = (name, kids) => {
      const responses = kids.reduce((a, d) => a + d.responses, 0);
      const meta = kids.reduce((a, d) => a + d.meta, 0);
      const items = kids.flatMap(d => distItems[d.id] || []);
      const sc = scoreOf(items);
      return { name, responses, meta, pct: pct(responses, meta), score: sc.score, n: sc.n, distritos: kids.map(pub) };
    };
    const regOut = regionais.map(rg => regBuild(rg.name, distOut.filter(d => d.regional_id === rg.id)));
    const semReg = distOut.filter(d => !d.regional_id);
    if (semReg.length) regOut.push(regBuild(null, semReg));

    const depOut = departamentos.map(d => { const sc = scoreOf(depItems[d.id]); return { name: d.name, responses: depCount[d.id] || 0, meta: d.meta || 0, pct: pct(depCount[d.id] || 0, d.meta || 0), score: sc.score, n: sc.n }; });

    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const distTot = { responses: sum(distOut, 'responses'), meta: sum(distOut, 'meta') }; distTot.pct = pct(distTot.responses, distTot.meta);
    const depTot  = { responses: sum(depOut, 'responses'),  meta: sum(depOut, 'meta')  }; depTot.pct  = pct(depTot.responses, depTot.meta);
    const corpScore = scoreOf(allItems);
    const geral = { responses: distTot.responses + depTot.responses, meta: distTot.meta + depTot.meta, score: corpScore.score, n: corpScore.n, detail: corpScore.detail }; geral.pct = pct(geral.responses, geral.meta);

    return ok(res, { survey: { id: survey.id, name: survey.name }, metric, regionais: regOut, departamentos: depOut, totals: { distritos: distTot, departamentos: depTot, geral } }, 'ok');
  } catch (e) { return err(res, 'Erro ao consolidar resultados', 500, e.message); }
}

/* GET /results/:surveyId/pdf — relatório em PDF (apresentável, com comentários, médias e resultado geral) */
function getPdf(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.surveyId, t);
    if (!survey) return notFound(res, 'Pesquisa');
    const questions = db.prepare('SELECT * FROM questions WHERE survey_id=? ORDER BY order_num').all(survey.id);
    const totalResp = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL").get(survey.id).c;
    const started   = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id=?").get(survey.id).c;
    const completion = started > 0 ? Math.round(totalResp / started * 100) : 0;
    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const skip = new Set(['true', 'false', 'sim', 'não', 'nao', 'yes', 'no', '1', '0']);

    let overallNps = null, gSum = 0, gN = 0;
    const qdata = questions.map(q => {
      const answers = db.prepare('SELECT value_text, value_num, value_json FROM answers WHERE question_id=?').all(q.id);
      const opts = PJ(q.options) || [];
      const pts  = PJ(q.option_points);
      const item = { text: q.text, type: q.type, count: answers.length };
      if (q.type === 'nps') {
        const sc = answers.map(a => a.value_num).filter(v => v !== null); const n = calculateNPS(sc);
        if (overallNps === null) overallNps = n.nps;
        Object.assign(item, { nps: n.nps, promoters: n.promoters, passives: n.passives, detractors: n.detractors, classification: n.classification });
      } else if (q.type === 'scale' || q.type === 'rating') {
        const v = answers.map(a => a.value_num).filter(x => x !== null);
        item.average = calculateAverage(v);
        item.choices = opts.map((label, idx) => { const c = v.filter(x => x === idx + 1).length; return { label, pct: v.length ? Math.round(c / v.length * 100) : 0 }; });
      } else if (q.type === 'multiple') {
        const all = answers.flatMap(a => { try { return JSON.parse(a.value_json || '[]'); } catch { return []; } });
        item.choices = opts.map(label => { const c = all.filter(x => String(x) === label).length; return { label, pct: answers.length ? Math.round(c / answers.length * 100) : 0 }; });
      } else if (q.type === 'yesno') {
        const v = answers.map(a => a.value_text); const yes = v.filter(x => x === 'true' || x === 'sim' || x === '1').length;
        item.yesPct = v.length ? Math.round(yes / v.length * 100) : 0;
      }
      if (pts && pts.length) {
        let sum = 0, n2 = 0;
        answers.forEach(a => {
          let e = null;
          if (q.type === 'scale' || q.type === 'rating') { if (a.value_num != null && pts[a.value_num - 1] != null) e = Number(pts[a.value_num - 1]); }
          else if (q.type === 'multiple') { let sel = []; try { sel = JSON.parse(a.value_json || '[]'); } catch {} const vals = (Array.isArray(sel) ? sel : []).map(l => { const i2 = opts.indexOf(l); return (i2 >= 0 && pts[i2] != null) ? Number(pts[i2]) : null; }).filter(x => x != null); if (vals.length) e = vals.reduce((x, y) => x + y, 0) / vals.length; }
          if (e != null) { sum += e; n2++; }
        });
        if (n2) { item.scorePct = Math.round(sum / n2); gSum += sum; gN += n2; }
      }
      item.comments = answers.map(a => a.value_text).filter(x => x != null && String(x).trim() !== '' && !skip.has(String(x).trim().toLowerCase())).slice(0, 500);
      return item;
    });
    const overallScore = gN ? Math.round(gSum / gN) : null;

    // Idioma do relatório (PT/EN/ES) — conforme a língua selecionada na plataforma
    const lang = ['en', 'es'].includes(String(req.query.lang || '').toLowerCase()) ? String(req.query.lang).toLowerCase() : 'pt';
    const T = {
      pt: { subtitle: 'Relatório de Resultados  ·  Conforme à LGPD', locale: 'pt-BR', m_resp: 'Respostas concluídas', m_compl: 'Taxa de conclusão', m_score: 'Média geral atingida', m_nps: 'NPS geral', responses: n => `${n} resposta(s)`, npsLine: q => `Promotores ${q.promoters}%   ·   Neutros ${q.passives}%   ·   Detratores ${q.detractors}%`, avg: v => `Média ${v}`, yesno: y => `Sim ${y}%    ·    Não ${100 - y}%`, achieved: p => `% atingido: ${p}%`, comments: n => `Comentários (${n}):`, footer: (a, b) => `Confidencial · RH Survey    —    Página ${a} de ${b}` },
      en: { subtitle: 'Results Report  ·  LGPD compliant', locale: 'en-US', m_resp: 'Completed responses', m_compl: 'Completion rate', m_score: 'Overall score achieved', m_nps: 'Overall NPS', responses: n => `${n} response(s)`, npsLine: q => `Promoters ${q.promoters}%   ·   Passives ${q.passives}%   ·   Detractors ${q.detractors}%`, avg: v => `Average ${v}`, yesno: y => `Yes ${y}%    ·    No ${100 - y}%`, achieved: p => `% achieved: ${p}%`, comments: n => `Comments (${n}):`, footer: (a, b) => `Confidential · RH Survey    —    Page ${a} of ${b}` },
      es: { subtitle: 'Informe de Resultados  ·  Conforme a la LGPD', locale: 'es-ES', m_resp: 'Respuestas completadas', m_compl: 'Tasa de finalización', m_score: 'Promedio general alcanzado', m_nps: 'NPS general', responses: n => `${n} respuesta(s)`, npsLine: q => `Promotores ${q.promoters}%   ·   Neutros ${q.passives}%   ·   Detractores ${q.detractors}%`, avg: v => `Promedio ${v}`, yesno: y => `Sí ${y}%    ·    No ${100 - y}%`, achieved: p => `% alcanzado: ${p}%`, comments: n => `Comentarios (${n}):`, footer: (a, b) => `Confidencial · RH Survey    —    Página ${a} de ${b}` },
    }[lang];
    let dateStr; try { dateStr = new Date().toLocaleDateString(T.locale); } catch { dateStr = new Date().toLocaleDateString('pt-BR'); }

    // ───────── desenho ─────────
    const NAVY = '#1E1B4B', PURPLE = '#5B21B6', SLATE = '#475569', LIGHT = '#64748B', LINE = '#EAECF3';
    const sc = p => p >= 70 ? '#16A34A' : p >= 40 ? '#D97706' : '#DC2626';
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: 'Relatório - ' + survey.name, Author: 'RH Survey' } });
    const safe = (survey.name || 'relatorio').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'relatorio';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-${safe}.pdf"`);
    doc.pipe(res);
    const PW = doc.page.width, M = 50, CW = PW - M * 2;
    const need = h => { if (doc.y + h > doc.page.height - 55) doc.addPage(); };

    // Cabeçalho
    doc.rect(0, 0, PW, 96).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('RH Survey', M, 26);
    doc.fillColor('#C7CBE6').font('Helvetica').fontSize(10).text(T.subtitle, M, 54);
    doc.fillColor('#C7CBE6').fontSize(9).text(dateStr, PW - M - 120, 30, { width: 120, align: 'right' });
    doc.y = 120;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(survey.name, M, 120, { width: CW });
    doc.moveDown(0.4);

    // Métricas gerais
    const metrics = [[T.m_resp, String(totalResp)], [T.m_compl, completion + '%']];
    if (overallScore != null) metrics.push([T.m_score, overallScore + '%']);
    else if (overallNps != null) metrics.push([T.m_nps, String(overallNps)]);
    const my = doc.y + 4, bw = CW / metrics.length;
    metrics.forEach((m, i) => {
      const x = M + i * bw;
      doc.roundedRect(x + (i ? 5 : 0), my, bw - 10, 58, 8).fillAndStroke('#F8FAFC', '#E6E9F2');
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text(m[1], x + 14, my + 11, { width: bw - 28 });
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8.5).text(m[0], x + 14, my + 39, { width: bw - 28 });
    });
    doc.y = my + 58 + 22;

    const drawChoices = (choices) => {
      (choices || []).forEach(c => {
        need(15);
        const y = doc.y, barW = 120, barX = M + CW - barW - 42;
        doc.fillColor(SLATE).font('Helvetica').fontSize(9).text(c.label || '', M + 4, y, { width: barX - M - 12, ellipsis: true });
        doc.roundedRect(barX, y + 1, barW, 7, 3).fill('#EEF0F4');
        doc.roundedRect(barX, y + 1, Math.max(2, barW * Math.min(100, c.pct) / 100), 7, 3).fill(PURPLE);
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(c.pct + '%', barX + barW + 6, y, { width: 34 });
        doc.y = y + 13;
      });
    };

    qdata.forEach((q, idx) => {
      need(54);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(`${idx + 1}. ${q.text}`, M, doc.y, { width: CW });
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(T.responses(q.count), M, doc.y + 1);
      doc.moveDown(0.35);
      if (q.type === 'nps') {
        doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(15).text(`NPS ${q.nps}`, M, doc.y);
        doc.fillColor(SLATE).font('Helvetica').fontSize(9).text(T.npsLine(q), M, doc.y + 1);
      } else if (q.type === 'scale' || q.type === 'rating') {
        doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(15).text(T.avg(q.average != null ? q.average : '—'), M, doc.y);
        doc.moveDown(0.2); drawChoices(q.choices);
      } else if (q.type === 'multiple') {
        drawChoices(q.choices);
      } else if (q.type === 'yesno') {
        doc.fillColor(SLATE).font('Helvetica').fontSize(10).text(T.yesno(q.yesPct), M, doc.y);
      }
      if (q.scorePct != null) { need(14); doc.fillColor(sc(q.scorePct)).font('Helvetica-Bold').fontSize(9.5).text(T.achieved(q.scorePct), M, doc.y + 2); }
      if (q.comments && q.comments.length) {
        doc.moveDown(0.25); need(16);
        doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(9).text(T.comments(q.comments.length), M, doc.y);
        doc.moveDown(0.1);
        q.comments.forEach(c => { need(14); doc.fillColor(SLATE).font('Helvetica').fontSize(9).text('•  ' + c, M + 6, doc.y, { width: CW - 12 }); });
      }
      doc.moveDown(0.5); need(6);
      doc.moveTo(M, doc.y).lineTo(M + CW, doc.y).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(0.5);
    });

    // Rodapé com numeração
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(T.footer(i + 1, range.count), M, doc.page.height - 38, { width: CW, align: 'center' });
    }
    doc.end();
  } catch (e) { if (!res.headersSent) return err(res, 'Erro ao gerar PDF', 500, e.message); try { res.end(); } catch {} }
}
/* POST /results/insights-pdf — exporta a análise da IA (resumo, pontos fortes/atenção, recomendações) em PDF, no idioma escolhido */
function getInsightsPdf(req, res) {
  try {
    const db = getDB(); const tenant = req.user.tenant_id;
    const id = req.body.surveyId; const ins = req.body.insights;
    if (!ins || typeof ins !== 'object') return badReq(res, 'Análise ausente. Gere a análise antes de exportar.');
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(id, tenant);
    if (!survey) return notFound(res, 'Pesquisa');
    const lang = ['en', 'es'].includes(String(req.body.lang || '').toLowerCase()) ? String(req.body.lang).toLowerCase() : 'pt';
    const T = {
      pt: { subtitle: 'Análise com IA  ·  Conforme à LGPD', locale: 'pt-BR', summary: 'Resumo Executivo', strong: 'Pontos Fortes', attention: 'Pontos de Atenção', recom: 'Recomendações', themes: 'Temas das Respostas Abertas', priority: 'Prioridade Imediata', benchmark: 'Comparação (Benchmark)', npsClass: { Excelente: 'Excelente', Bom: 'Bom', Neutro: 'Neutro', Ruim: 'Ruim' }, footer: (a, b) => `Confidencial · RH Survey    —    Página ${a} de ${b}` },
      en: { subtitle: 'AI Analysis  ·  LGPD compliant', locale: 'en-US', summary: 'Executive Summary', strong: 'Strengths', attention: 'Points of Attention', recom: 'Recommendations', themes: 'Open-Response Themes', priority: 'Immediate Priority', benchmark: 'Benchmark', npsClass: { Excelente: 'Excellent', Bom: 'Good', Neutro: 'Neutral', Ruim: 'Poor' }, footer: (a, b) => `Confidential · RH Survey    —    Page ${a} of ${b}` },
      es: { subtitle: 'Análisis con IA  ·  Conforme a la LGPD', locale: 'es-ES', summary: 'Resumen Ejecutivo', strong: 'Puntos Fuertes', attention: 'Puntos de Atención', recom: 'Recomendaciones', themes: 'Temas de Respuestas Abiertas', priority: 'Prioridad Inmediata', benchmark: 'Comparación (Benchmark)', npsClass: { Excelente: 'Excelente', Bom: 'Bueno', Neutro: 'Neutral', Ruim: 'Malo' }, footer: (a, b) => `Confidencial · RH Survey    —    Página ${a} de ${b}` },
    }[lang];

    const NAVY = '#1E1B4B', PURPLE = '#5B21B6', SLATE = '#475569', LIGHT = '#64748B', GREEN = '#16A34A', AMBER = '#D97706', RED = '#DC2626';
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: 'Análise IA - ' + survey.name, Author: 'RH Survey' } });
    const safe = (survey.name || 'analise').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'analise';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="analise-ia-${safe}.pdf"`);
    doc.pipe(res);
    const PW = doc.page.width, M = 50, CW = PW - M * 2;
    const need = h => { if (doc.y + h > doc.page.height - 55) doc.addPage(); };
    let dateStr; try { dateStr = new Date().toLocaleDateString(T.locale); } catch { dateStr = new Date().toLocaleDateString('pt-BR'); }

    doc.rect(0, 0, PW, 96).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('RH Survey', M, 26);
    doc.fillColor('#C7CBE6').font('Helvetica').fontSize(10).text(T.subtitle, M, 54);
    doc.fillColor('#C7CBE6').fontSize(9).text(dateStr, PW - M - 120, 30, { width: 120, align: 'right' });
    doc.y = 120;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(survey.name, M, 120, { width: CW });
    doc.moveDown(0.4);

    if (ins.npsClassificacao && ins.npsClassificacao !== '—') {
      const label = (T.npsClass[ins.npsClassificacao] || ins.npsClassificacao);
      const txt = 'NPS ' + label;
      doc.font('Helvetica-Bold').fontSize(9); const w = doc.widthOfString(txt) + 18; const by = doc.y;
      doc.roundedRect(M, by, w, 18, 9).fill('#EDE9FE');
      doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(9).text(txt, M + 9, by + 5.5);
      doc.y = by + 28;
    }

    const section = (title, color) => { need(34); doc.moveDown(0.35); const y = doc.y; doc.circle(M + 4, y + 6, 3.2).fill(color || PURPLE); doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(title, M + 14, y); doc.moveDown(0.25); };
    const para = (txt) => { if (!txt) return; need(20); doc.fillColor(SLATE).font('Helvetica').fontSize(10).text(String(txt), M, doc.y, { width: CW, lineGap: 2.5 }); };
    const bullets = (arr, color) => { (arr || []).forEach(it => { need(16); const y = doc.y; doc.circle(M + 5, y + 5, 1.7).fill(color || PURPLE); doc.fillColor(SLATE).font('Helvetica').fontSize(10).text(String(it), M + 15, y, { width: CW - 15, lineGap: 1.5 }); }); };

    section(T.summary, PURPLE); para(ins.resumo);
    if ((ins.pontosFortesArr || []).length) { section(T.strong, GREEN); bullets(ins.pontosFortesArr, GREEN); }
    if ((ins.pontosAtencaoArr || []).length) { section(T.attention, AMBER); bullets(ins.pontosAtencaoArr, AMBER); }
    if ((ins.recomendacoesArr || []).length) { section(T.recom, PURPLE); bullets(ins.recomendacoesArr, PURPLE); }
    if ((ins.temasAbertosArr || []).length) { section(T.themes, SLATE); bullets(ins.temasAbertosArr, SLATE); }
    if (ins.prioridadeImediata) { section(T.priority, RED); para(ins.prioridadeImediata); }
    if (ins.benchmarkTexto) { section(T.benchmark, NAVY); para(ins.benchmarkTexto); }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) { doc.switchToPage(range.start + i); doc.fillColor(LIGHT).font('Helvetica').fontSize(8).text(T.footer(i + 1, range.count), M, doc.page.height - 38, { width: CW, align: 'center' }); }
    doc.end();
  } catch (e) { if (!res.headersSent) return err(res, 'Erro ao gerar PDF', 500, e.message); try { res.end(); } catch {} }
}
function getSegmentQuestions(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const surveyId = req.query.surveyId;
    if (!surveyId) return badReq(res, 'surveyId é obrigatório');
    const survey = db.prepare('SELECT id, name, category FROM surveys WHERE id=? AND tenant_id=?').get(surveyId, t);
    if (!survey) return notFound(res, 'Pesquisa');
    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para ver os resultados desta pesquisa', 403);
    const scope = responseScopeSQL(db, req.user, 'r');

    const PJ = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const scoredQ = db.prepare("SELECT id, text, type, options, option_points FROM questions WHERE survey_id=? AND option_points IS NOT NULL").all(surveyId)
      .map(q => ({ id: q.id, text: q.text, type: q.type, options: PJ(q.options) || [], points: PJ(q.option_points) || [] }))
      .filter(q => q.points.length);
    if (!scoredQ.length) return ok(res, { metric: null, questions: [], corporacao: {}, regionais: [], departamentos: [] }, 'ok');

    const qmap = {}; scoredQ.forEach(q => qmap[q.id] = q);
    const ids = scoredQ.map(q => q.id); const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT r.distrito_id dd, r.departamento_id pp, a.question_id qid, a.value_num vn, a.value_json vj
      FROM answers a JOIN responses r ON a.response_id = r.id
      WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND a.question_id IN (${ph})${scope.sql}`).all(surveyId, ...ids, ...scope.params);

    const distB = {}, depB = {}, corpB = {};
    const add = (obj, qid, e) => { const k = obj[qid] || (obj[qid] = { sum: 0, n: 0 }); k.sum += e; k.n++; };
    const earnedOf = (q, vn, vj) => {
      if (q.type === 'scale' || q.type === 'rating') { return (vn != null && q.points[vn - 1] != null) ? Number(q.points[vn - 1]) : null; }
      if (q.type === 'multiple') { let sel = []; try { sel = JSON.parse(vj || '[]'); } catch {} const vals = (Array.isArray(sel) ? sel : []).map(l => { const idx = q.options.indexOf(l); return (idx >= 0 && q.points[idx] != null) ? Number(q.points[idx]) : null; }).filter(v => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }
      return null;
    };
    rows.forEach(row => {
      const q = qmap[row.qid]; if (!q) return;
      const e = earnedOf(q, row.vn, row.vj); if (e == null) return;
      add(corpB, row.qid, e);
      if (row.dd) { (distB[row.dd] = distB[row.dd] || {}); add(distB[row.dd], row.qid, e); }
      if (row.pp) { (depB[row.pp] = depB[row.pp] || {}); add(depB[row.pp], row.qid, e); }
    });
    const pctMap = (obj) => { const o = {}; Object.keys(obj || {}).forEach(qid => { o[qid] = Math.round(obj[qid].sum / obj[qid].n); }); return o; };
    const poolDistritos = (distIds) => {
      const agg = {};
      distIds.forEach(did => { const b = distB[did]; if (!b) return; Object.keys(b).forEach(qid => { const k = agg[qid] || (agg[qid] = { sum: 0, n: 0 }); k.sum += b[qid].sum; k.n += b[qid].n; }); });
      return pctMap(agg);
    };

    const allowed       = scopeDistritos(db, req.user);
    const regionais     = db.prepare('SELECT id, name FROM regionais WHERE tenant_id=? ORDER BY name').all(t);
    let   distritos     = db.prepare('SELECT id, name, regional_id FROM distritos WHERE tenant_id=? ORDER BY name').all(t);
    if (allowed) distritos = distritos.filter(d => allowed.includes(d.id));
    const departamentos = allowed ? [] : db.prepare('SELECT id, name FROM departamentos WHERE tenant_id=? ORDER BY name').all(t);

    const regOut = regionais.map(rg => {
      const kids = distritos.filter(d => d.regional_id === rg.id);
      return { name: rg.name, scores: poolDistritos(kids.map(d => d.id)), distritos: kids.map(d => ({ name: d.name, scores: pctMap(distB[d.id]) })) };
    });
    const semReg = distritos.filter(d => !d.regional_id);
    if (semReg.length) regOut.push({ name: null, scores: poolDistritos(semReg.map(d => d.id)), distritos: semReg.map(d => ({ name: d.name, scores: pctMap(distB[d.id]) })) });
    const depOut = departamentos.map(d => ({ name: d.name, scores: pctMap(depB[d.id]) }));

    return ok(res, { metric: 'score', questions: scoredQ.map(q => ({ id: q.id, text: q.text })), corporacao: pctMap(corpB), regionais: regOut, departamentos: depOut }, 'ok');
  } catch (e) { return err(res, 'Erro ao detalhar por pergunta', 500, e.message); }
}

module.exports = { getSurveyResults, getDashboard, getInsights, getSegments, getSegmentQuestions, getPdf, getInsightsPdf };
