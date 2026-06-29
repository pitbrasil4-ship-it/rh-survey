'use strict';
const { getDB }                                       = require('../config/database');
const { calculateNPS, calculateAverage, calculateFrequency, calculateNPSWeighted, calculateAverageWeighted } = require('../utils/nps');
const { ok, err, notFound, badReq }                   = require('../utils/response');

/* GET /results/:surveyId */
function getSurveyResults(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.surveyId, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    const questions    = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const totalResp    = db.prepare('SELECT COUNT(*) as cnt FROM responses WHERE survey_id = ? AND completed_at IS NOT NULL').get(survey.id).cnt;
    const startedResp  = db.prepare('SELECT COUNT(*) as cnt FROM responses WHERE survey_id = ?').get(survey.id).cnt;
    let gScoreSum = 0, gScoreN = 0; // acumulador da média geral atingida (pontuação por opção)

    const questionResults = questions.map(q => {
      const answers = db.prepare('SELECT value_text, value_num, value_json FROM answers WHERE question_id = ?').all(q.id);

      let result = { questionId: q.id, type: q.type, text: q.text, responseCount: answers.length };

      const PJc = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
      const qOpts = PJc(q.options);

      if (q.type === 'nps') {
        const scores = answers.map(a => a.value_num).filter(v => v !== null);
        result = { ...result, ...calculateNPS(scores) };

      } else if (q.type === 'scale' || q.type === 'rating') {
        const values = answers.map(a => a.value_num).filter(v => v !== null);
        result.average  = calculateAverage(values);
        result.distribution = calculateFrequency(values.map(v => String(v)));
        if (qOpts && qOpts.length) {
          const total = values.length;
          result.choices = qOpts.map((label, idx) => { const cnt = values.filter(v => v === idx + 1).length; return { label, count: cnt, pct: total ? Math.round((cnt / total) * 100) : 0 }; });
        }

      } else if (q.type === 'multiple') {
        const all = answers.flatMap(a => { try { return JSON.parse(a.value_json || '[]'); } catch { return []; } });
        result.frequency = calculateFrequency(all.map(String));
        if (qOpts && qOpts.length) {
          const totalR = answers.length;
          result.choices = qOpts.map(label => { const cnt = all.filter(v => String(v) === label).length; return { label, count: cnt, pct: totalR ? Math.round((cnt / totalR) * 100) : 0 }; });
        }

      } else if (q.type === 'yesno') {
        const values   = answers.map(a => a.value_text);
        const yes      = values.filter(v => v === 'true' || v === 'sim' || v === '1').length;
        result.yes     = yes;
        result.no      = values.length - yes;
        result.yesPct  = values.length ? Math.round((yes / values.length) * 100) : 0;
        result.choices = [{ label: 'Sim', count: yes, pct: result.yesPct }, { label: 'Não', count: values.length - yes, pct: values.length ? 100 - result.yesPct : 0 }];

      } else if (q.type === 'text') {
        result.responses = answers.map(a => a.value_text).filter(Boolean).slice(0, 50);
      }

      // Pontuação por opção (%) — quando a pergunta tem pesos definidos por alternativa.
      const PJq = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
      const pts = PJq(q.option_points);
      if (pts && pts.length) {
        const opts = PJq(q.options) || [];
        let sum = 0, n = 0;
        answers.forEach(a => {
          let earned = null;
          if (q.type === 'scale' || q.type === 'rating') { const pos = a.value_num; if (pos != null && pts[pos - 1] != null) earned = Number(pts[pos - 1]); }
          else if (q.type === 'multiple') { let sel = []; try { sel = JSON.parse(a.value_json || '[]'); } catch {} const vals = (Array.isArray(sel) ? sel : []).map(l => { const idx = opts.indexOf(l); return (idx >= 0 && pts[idx] != null) ? Number(pts[idx]) : null; }).filter(v => v != null); if (vals.length) earned = vals.reduce((x, y) => x + y, 0) / vals.length; }
          if (earned != null) { sum += earned; n++; }
        });
        if (n) result.scorePct = Math.round(sum / n);
        gScoreSum += sum; gScoreN += n;
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
    });
  } catch (e) { return err(res, 'Erro ao carregar resultados', 500, e.message); }
}

/* GET /results/dashboard  — aggregate across all surveys */
function getDashboard(req, res) {
  try {
    const db          = getDB();
    const totalSurveys = db.prepare("SELECT COUNT(*) as cnt FROM surveys WHERE tenant_id=? AND status != 'excluido'").get(req.user.tenant_id).cnt;
    const active       = db.prepare("SELECT COUNT(*) as cnt FROM surveys WHERE tenant_id=? AND status='ativo'").get(req.user.tenant_id).cnt;
    const totalResp    = db.prepare('SELECT COUNT(*) as cnt FROM responses r JOIN surveys s ON r.survey_id=s.id WHERE s.tenant_id=? AND r.completed_at IS NOT NULL').get(req.user.tenant_id).cnt;
    const recent       = db.prepare("SELECT s.*, (SELECT COUNT(*) FROM responses WHERE survey_id=s.id AND completed_at IS NOT NULL) as responses FROM surveys s WHERE s.tenant_id=? AND s.status!='excluido' ORDER BY s.created_at DESC LIMIT 5").all(req.user.tenant_id);

    return ok(res, { totalSurveys, active, totalResponses: totalResp, recentSurveys: recent });
  } catch (e) { return err(res, 'Erro ao carregar dashboard', 500, e.message); }
}


/* POST /results/insights  — gera relatório executivo a partir de resultados REAIS */
async function getInsights(req, res) {
  try {
    const db     = getDB();
    const id     = req.body.surveyId || req.params.surveyId;
    const lang   = (req.body.lang === 'en' || req.body.lang === 'es') ? req.body.lang : 'pt';
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(id, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    const questions = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const totalResp = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL").get(survey.id).c;
    const started   = db.prepare("SELECT COUNT(*) c FROM responses WHERE survey_id=?").get(survey.id).c;

    let overallNps = null;
    const perguntas = questions.map(q => {
      const answers = db.prepare('SELECT value_text, value_num FROM answers WHERE question_id=?').all(q.id);
      if (q.type === 'nps') {
        const sc = answers.map(a => a.value_num).filter(v => v !== null);
        const n  = calculateNPS(sc);
        if (overallNps === null) overallNps = n.nps;
        return { pergunta: q.text, tipo: 'nps', nps: n.nps, promotores: n.promoters, detratores: n.detractors };
      }
      if (q.type === 'scale' || q.type === 'rating') {
        const v = answers.map(a => a.value_num).filter(x => x !== null);
        return { pergunta: q.text, tipo: q.type, media: calculateAverage(v) };
      }
      if (q.type === 'yesno') {
        const v = answers.map(a => a.value_text);
        const yes = v.filter(x => x === 'true' || x === 'sim' || x === '1').length;
        return { pergunta: q.text, tipo: 'yesno', simPct: v.length ? Math.round(yes / v.length * 100) : 0 };
      }
      if (q.type === 'text') {
        return { pergunta: q.text, tipo: 'text', respostasAbertas: answers.map(a => a.value_text).filter(Boolean).slice(0, 15) };
      }
      return { pergunta: q.text, tipo: q.type };
    });

    const taxaConclusao = started > 0 ? Math.round((totalResp / started) * 100) : 0;
    const npsClass = overallNps === null ? '—' : overallNps >= 75 ? 'Excelente' : overallNps >= 50 ? 'Bom' : overallNps >= 0 ? 'Neutro' : 'Ruim';

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
      return ok(res, { insights: {
        resumo: D.resumo,
        npsClassificacao: npsClass,
        pontosFortesArr: D.fortes,
        pontosAtencaoArr: D.atencao,
        recomendacoesArr: D.recom,
        temasAbertosArr: [],
        prioridadeImediata: D.prio,
        benchmarkTexto: D.bench,
      }, demo: true }, 'Insights em modo demo (configure ANTHROPIC_API_KEY)');
    }

    const LANGNAME = { pt: 'português do Brasil', en: 'English', es: 'español' }[lang];
    const summary = { nome: survey.name, categoria: survey.category, respostas: totalResp, taxaConclusao, npsGeral: overallNps, perguntas };
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1200,
        messages: [{ role: 'user', content: `Você é especialista em RH e People Analytics. Analise os dados REAIS desta pesquisa organizacional e gere um relatório executivo.\n\nDados:\n${JSON.stringify(summary, null, 2)}\n\nRetorne APENAS JSON puro (sem markdown) neste formato exato (mantenha as CHAVES exatamente como estão):\n{"resumo":"2-3 frases","npsClassificacao":"","pontosFortesArr":["..."],"pontosAtencaoArr":["..."],"recomendacoesArr":["..."],"temasAbertosArr":["..."],"prioridadeImediata":"...","benchmarkTexto":"..."}\n\nIMPORTANTE: Escreva TODOS os valores de texto em ${LANGNAME}. Não traduza as chaves do JSON. Deixe "npsClassificacao" como string vazia.` }]
      })
    });
    const data = await resp.json();
    const raw  = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    const insights = JSON.parse(raw);
    insights.npsClassificacao = npsClass; // token PT determinístico p/ a cor do selo; o front traduz o rótulo exibido.
    return ok(res, { insights }, 'Insights gerados com IA');
  } catch (e) { return err(res, 'Erro ao gerar insights', 500, e.message); }
}

/* GET /results/segments?surveyId= — participação + nota (NPS/média) consolidadas por distrito → regional → corporação e por departamento */
function getSegments(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const surveyId = req.query.surveyId;
    if (!surveyId) return badReq(res, 'surveyId é obrigatório');
    const survey = db.prepare('SELECT id, name FROM surveys WHERE id=? AND tenant_id=?').get(surveyId, t);
    if (!survey) return notFound(res, 'Pesquisa');

    // ── participação (respostas concluídas) ──
    const distCount = {};
    db.prepare("SELECT distrito_id, COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL AND distrito_id IS NOT NULL GROUP BY distrito_id").all(surveyId).forEach(r => distCount[r.distrito_id] = r.c);
    const depCount = {};
    db.prepare("SELECT departamento_id, COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL AND departamento_id IS NOT NULL GROUP BY departamento_id").all(surveyId).forEach(r => depCount[r.departamento_id] = r.c);

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
        WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND a.question_id IN (${ph})`).all(surveyId, ...ids);
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
        WHERE r.survey_id=? AND r.completed_at IS NOT NULL AND a.value_num IS NOT NULL AND a.question_id IN (${ph})`).all(surveyId, ...ids);
      rows.forEach(row => pushItem(row.dd, row.pp, row.v, row.w));
    }
    const scoreOf = (items) => {
      if (!metric || !items || !items.length) return { score: null, n: 0, detail: null };
      if (metric === 'nps') { const r = calculateNPSWeighted(items); return { score: r.nps, n: items.length, detail: { promoters: r.promoters, passives: r.passives, detractors: r.detractors, classification: r.classification } }; }
      if (metric === 'score') return { score: Math.round(calculateAverageWeighted(items)), n: items.length, detail: null };
      return { score: calculateAverageWeighted(items), n: items.length, detail: null };
    };

    const regionais     = db.prepare('SELECT id, name FROM regionais WHERE tenant_id=? ORDER BY name').all(t);
    const distritos     = db.prepare('SELECT id, name, regional_id, meta FROM distritos WHERE tenant_id=? ORDER BY name').all(t);
    const departamentos = db.prepare('SELECT id, name, meta FROM departamentos WHERE tenant_id=? ORDER BY name').all(t);
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

module.exports = { getSurveyResults, getDashboard, getInsights, getSegments };
