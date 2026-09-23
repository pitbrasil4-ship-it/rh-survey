'use strict';
const { v4: uuid } = require('uuid');
const { getDB } = require('../config/database');
const { ok, err, notFound, badReq } = require('../utils/response');
const Q = require('../utils/questions');
const { canSeeSurvey, responseScopeSQL } = require('../utils/scope');

/* Análise dos comentários abertos, COM REVISÃO HUMANA.
 *
 * A classificação automática é um ponto de partida, não um veredito: é palavra-chave e
 * léxico, erra em ironia, negação e gíria. Por isso toda leitura aqui é "o que a pessoa
 * revisou, e só na falta disso o automático" — e a tela diz de qual das duas veio cada
 * número. Sem isso, um relatório de clima passaria a repetir um palpite de máquina com
 * cara de dado apurado.
 *
 * A revisão nunca reescreve o comentário: ela grava uma classificação ao lado. O texto
 * original continua intocado, que é o que permite reclassificar de novo depois. */

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
  { tema: 'Segurança e saúde',         termos: ['segurança', 'seguranca', 'acidente', 'epi', 'saúde', 'saude', 'risco'] },
  { tema: 'Assédio e conduta',         termos: ['assédio', 'assedio', 'humilha', 'grosseria', 'desrespeito', 'discrimina', 'preconceito', 'ameaça', 'ameaca'] },
  { tema: 'Processos e sistemas',      termos: ['processo', 'sistema', 'burocra', 'procedimento', 'contagem', 'inventário', 'inventario'] },
];
const TEMA_OUTROS = 'Outros';
const TEMA_NOMES = TEMAS.map(t => t.tema).concat(TEMA_OUTROS);

/* Termos que, sozinhos, pedem olho humano: não classificam, sinalizam. */
const ALERTA = ['assédio', 'assedio', 'humilha', 'discrimina', 'preconceito', 'ameaça', 'ameaca',
                'acidente', 'ferido', 'processo trabalhista', 'denúncia', 'denuncia', 'roubo', 'fraude'];

const POSITIVO = ['bom', 'boa', 'ótim', 'otim', 'excelente', 'gosto', 'gostei', 'adoro', 'feliz', 'satisfeit',
                  'parabéns', 'parabens', 'obrigad', 'melhor', 'orgulho', 'agradeç', 'agradec', 'apoio',
                  'justo', 'respeit', 'valoriz', 'reconhec', 'tranquilo', 'positiv'];
const NEGATIVO = ['ruim', 'péssim', 'pessim', 'horrível', 'horrivel', 'não gosto', 'nao gosto', 'insatisfeit',
                  'falta', 'falho', 'problema', 'difícil', 'dificil', 'injust', 'desrespeit', 'sobrecarga',
                  'cansa', 'exaust', 'pressão', 'pressao', 'atraso', 'demora', 'nunca', 'pior', 'reclama',
                  'descaso', 'abandonad', 'desvaloriz', 'baixo', 'precári', 'precari', 'atrapalha', 'prejudica',
                  'ninguém faz', 'ninguem faz', 'ninguém fez', 'ninguem fez', 'deixa a desejar'];
/* Negação antes de um termo positivo inverte o sinal. É o erro mais comum e o mais
   barato de tratar; o resto fica para a revisão. */
const NEGADORES = ['não ', 'nao ', 'nunca ', 'nem ', 'jamais '];

const norm = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Temas automáticos de um comentário. Pode cair em mais de um. */
function temasDe(texto) {
  const t = norm(texto);
  const achados = TEMAS.filter(x => x.termos.some(k => t.includes(norm(k)))).map(x => x.tema);
  return achados.length ? achados : [TEMA_OUTROS];
}

/* Sentimento automático: contagem de termos, com a negação invertendo o positivo.
   É heurística declarada — a tela sempre mostra que veio do automático. */
function sentimentoDe(texto) {
  const t = norm(texto);
  let pos = 0, neg = 0;
  POSITIVO.forEach(k => {
    const alvo = norm(k);
    let i = t.indexOf(alvo);
    while (i >= 0) {
      const antes = t.slice(Math.max(0, i - 12), i);
      if (NEGADORES.some(n => antes.includes(norm(n)))) neg++; else pos++;
      i = t.indexOf(alvo, i + alvo.length);
    }
  });
  NEGATIVO.forEach(k => { if (t.includes(norm(k))) neg++; });
  // Assédio, acidente, ameaça: não há leitura positiva disso. Sem esta linha, um relato
  // grave escrito em tom seco saía como "neutro" só por não trazer palavra de queixa.
  ALERTA.forEach(k => { if (t.includes(norm(k))) neg += 2; });
  if (pos > neg) return 'positivo';
  if (neg > pos) return 'negativo';
  return 'neutro';
}

function temAlerta(texto) {
  const t = norm(texto);
  return ALERTA.some(k => t.includes(norm(k)));
}

/* GET /comments/:surveyId — comentários com a classificação automática e a revisão. */
function list(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.surveyId, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para ver os resultados desta pesquisa', 403);

    const scope = responseScopeSQL(db, req.user, 'r');
    const questions = db.prepare("SELECT * FROM questions WHERE survey_id=? ORDER BY order_num").all(survey.id).map(Q.fromRow);
    const abertas = questions.filter(q => q.type === 'text');
    if (!abertas.length) return ok(res, { comments: [], themes: [], sentiments: [], total: 0, reviewed: 0, questions: [] });

    const ph = abertas.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT a.id, a.question_id, a.value_text, r.id AS response_id, r.completed_at, r.distrito_id, r.departamento_id
      FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE a.question_id IN (${ph}) AND r.completed_at IS NOT NULL${scope.sql}
      ORDER BY r.completed_at DESC`).all(...abertas.map(q => q.id), ...scope.params);

    const nomes = {};
    db.prepare('SELECT id, name FROM distritos WHERE tenant_id=?').all(req.user.tenant_id).forEach(d => nomes[d.id] = d.name);
    const deptos = {};
    db.prepare('SELECT id, name FROM departamentos WHERE tenant_id=?').all(req.user.tenant_id).forEach(d => deptos[d.id] = d.name);

    // Modalidade vem da pergunta de segmentação — é o recorte que a Carina usa primeiro.
    const segQ = questions.find(q => q.config && q.config.segmentation);
    const modalidade = {};
    if (segQ) {
      db.prepare('SELECT response_id, value_text, value_json FROM answers WHERE question_id=?').all(segQ.id)
        .forEach(a => {
          let v = a.value_text;
          if (a.value_json) { try { const j = JSON.parse(a.value_json); if (Array.isArray(j) && j.length) v = j[0]; } catch {} }
          if (v) modalidade[a.response_id] = String(v);
        });
    }

    const revisoes = {};
    db.prepare(`SELECT cr.*, u.name AS reviewer FROM comment_reviews cr
                LEFT JOIN users u ON u.id = cr.reviewed_by_id
                WHERE cr.survey_id=?`).all(survey.id).forEach(r => revisoes[r.answer_id] = r);

    const textoDaPergunta = {}; abertas.forEach(q => textoDaPergunta[q.id] = q.text);

    const comments = rows
      .map(r => {
        const texto = String(r.value_text || '').trim();
        if (texto.length < 2) return null;
        const rev = revisoes[r.id];
        const autoTemas = temasDe(texto);
        const autoSent  = sentimentoDe(texto);
        return {
          id: r.id,
          questionId: r.question_id,
          question: textoDaPergunta[r.question_id] || '',
          text: texto,
          date: r.completed_at,
          distrito: nomes[r.distrito_id] || null,
          departamento: deptos[r.departamento_id] || null,
          modalidade: modalidade[r.response_id] || null,
          auto: { themes: autoTemas, sentiment: autoSent, alert: temAlerta(texto) },
          review: rev ? {
            theme: rev.tema || null, sentiment: rev.sentimento || null,
            flagged: !!rev.flagged, note: rev.note || '',
            by: rev.reviewer || null, at: rev.reviewed_at,
          } : null,
          // O que vale para a contagem: o revisado manda, o automático completa.
          theme: (rev && rev.tema) || autoTemas[0],
          sentiment: (rev && rev.sentimento) || autoSent,
          source: (rev && (rev.tema || rev.sentimento)) ? 'revisado' : 'automático',
        };
      })
      .filter(Boolean);

    const contar = (chave, lista) => {
      const m = {};
      comments.forEach(c => { const k = c[chave]; m[k] = (m[k] || 0) + 1; });
      return (lista || Object.keys(m)).filter(k => m[k]).map(k => ({
        key: k, count: m[k], pct: comments.length ? Math.round((m[k] / comments.length) * 100) : 0,
        reviewed: comments.filter(c => c[chave] === k && c.source === 'revisado').length,
      })).sort((a, b) => b.count - a.count);
    };

    return ok(res, {
      comments,
      total: comments.length,
      reviewed: comments.filter(c => c.source === 'revisado').length,
      flagged: comments.filter(c => (c.review ? c.review.flagged : c.auto.alert)).length,
      themes: contar('theme', TEMA_NOMES),
      sentiments: contar('sentiment', ['positivo', 'neutro', 'negativo']),
      themeOptions: TEMA_NOMES,
      questions: abertas.map(q => ({ id: q.id, text: q.text })),
      scoped: !!scope.sql,
    });
  } catch (e) { return err(res, 'Erro ao carregar os comentários', 500, e.message); }
}

/* PUT /comments/:surveyId/:answerId — grava (ou apaga) a revisão humana de um comentário.
   Enviar tudo vazio remove a revisão e devolve o comentário ao automático. */
function review(req, res) {
  try {
    const db = getDB();
    const survey = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(req.params.surveyId, req.user.tenant_id);
    if (!survey) return notFound(res, 'Pesquisa');
    if (!canSeeSurvey(req.user, survey)) return err(res, 'Você não tem permissão para revisar esta pesquisa', 403);

    const answer = db.prepare(`SELECT a.id FROM answers a
                               JOIN questions q ON q.id = a.question_id
                               WHERE a.id=? AND q.survey_id=?`).get(req.params.answerId, survey.id);
    if (!answer) return notFound(res, 'Comentário');

    const tema = String(req.body.theme || '').trim();
    if (tema && !TEMA_NOMES.includes(tema)) return badReq(res, 'Tema desconhecido: ' + tema);
    const sent = String(req.body.sentiment || '').trim();
    if (sent && !['positivo', 'neutro', 'negativo'].includes(sent)) return badReq(res, 'Sentimento inválido: ' + sent);
    const flagged = req.body.flagged ? 1 : 0;
    const note = String(req.body.note || '').trim().slice(0, 1000);

    const vazio = !tema && !sent && !flagged && !note;
    const atual = db.prepare('SELECT id FROM comment_reviews WHERE answer_id=?').get(answer.id);
    if (vazio) {
      if (atual) db.prepare('DELETE FROM comment_reviews WHERE id=?').run(atual.id);
      return ok(res, { answerId: answer.id, review: null }, 'Revisão removida — vale a classificação automática');
    }
    if (atual) {
      db.prepare(`UPDATE comment_reviews SET tema=?, sentimento=?, flagged=?, note=?,
                  reviewed_by_id=?, reviewed_at=datetime('now') WHERE id=?`)
        .run(tema || null, sent || null, flagged, note || null, req.user.id, atual.id);
    } else {
      db.prepare(`INSERT INTO comment_reviews (id, tenant_id, survey_id, answer_id, tema, sentimento, flagged, note, reviewed_by_id)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(uuid(), req.user.tenant_id, survey.id, answer.id, tema || null, sent || null, flagged, note || null, req.user.id);
    }
    return ok(res, { answerId: answer.id, review: { theme: tema || null, sentiment: sent || null, flagged: !!flagged, note } }, 'Revisão salva');
  } catch (e) { return err(res, 'Erro ao salvar a revisão', 500, e.message); }
}

module.exports = { list, review, TEMAS, TEMA_NOMES, temasDe, sentimentoDe, temAlerta };
