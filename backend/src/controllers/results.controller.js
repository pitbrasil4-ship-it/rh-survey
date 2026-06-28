'use strict';
const { getDB }                                       = require('../config/database');
const { calculateNPS, calculateAverage, calculateFrequency } = require('../utils/nps');
const { ok, err, notFound }                           = require('../utils/response');

/* GET /results/:surveyId */
function getSurveyResults(req, res) {
  try {
    const db     = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND tenant_id = ?').get(req.params.surveyId, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');

    const questions    = db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY order_num').all(survey.id);
    const totalResp    = db.prepare('SELECT COUNT(*) as cnt FROM responses WHERE survey_id = ? AND completed_at IS NOT NULL').get(survey.id).cnt;
    const startedResp  = db.prepare('SELECT COUNT(*) as cnt FROM responses WHERE survey_id = ?').get(survey.id).cnt;

    const questionResults = questions.map(q => {
      const answers = db.prepare('SELECT value_text, value_num, value_json FROM answers WHERE question_id = ?').all(q.id);

      let result = { questionId: q.id, type: q.type, text: q.text, responseCount: answers.length };

      if (q.type === 'nps') {
        const scores = answers.map(a => a.value_num).filter(v => v !== null);
        result = { ...result, ...calculateNPS(scores) };

      } else if (q.type === 'scale' || q.type === 'rating') {
        const values = answers.map(a => a.value_num).filter(v => v !== null);
        result.average  = calculateAverage(values);
        result.distribution = calculateFrequency(values.map(v => String(v)));

      } else if (q.type === 'multiple') {
        const all = answers.flatMap(a => { try { return JSON.parse(a.value_json || '[]'); } catch { return []; } });
        result.frequency = calculateFrequency(all.map(String));

      } else if (q.type === 'yesno') {
        const values   = answers.map(a => a.value_text);
        const yes      = values.filter(v => v === 'true' || v === 'sim' || v === '1').length;
        result.yes     = yes;
        result.no      = values.length - yes;
        result.yesPct  = values.length ? Math.round((yes / values.length) * 100) : 0;

      } else if (q.type === 'text') {
        result.responses = answers.map(a => a.value_text).filter(Boolean).slice(0, 50);
      }

      return result;
    });

    // Overall NPS (first NPS question)
    const npsQ = questionResults.find(q => q.type === 'nps');

    return ok(res, {
      survey:       { ...survey, totalResponses: totalResp, startedResponses: startedResp },
      completionRate: startedResp > 0 ? Math.round((totalResp / startedResp) * 100) : 0,
      overallNPS:   npsQ ? { nps: npsQ.nps, classification: npsQ.classification } : null,
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

module.exports = { getSurveyResults, getDashboard, getInsights };
