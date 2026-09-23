'use strict';
const bcrypt       = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, err, notFound, badReq, forbidden } = require('../utils/response');
const { hashIP }   = require('../utils/crypto');
const Q            = require('../utils/questions');
const LV           = require('../utils/linkvars');
const { activeCampaignId } = require('./campaigns.controller');

const SURVEY_COLS = `id, tenant_id, name, name_en, name_es, description, description_en, description_es,
                     category, anonymous, status, deadline, one_per_device, max_responses,
                     access_password_hash, thank_you, allow_edit, randomize_questions,
                     randomize_options, enforce_quota`;

/* Resolve o token recebido no link: link geral da pesquisa, link por segmento
   (distrito/departamento) ou convite individual (uso único). */
function resolveToken(db, token) {
  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
  if (inv) {
    return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE id = ?`).get(inv.survey_id),
             invitation: inv, distritoId: inv.distrito_id, departamentoId: inv.departamento_id };
  }
  const link = db.prepare('SELECT survey_id, distrito_id, departamento_id FROM survey_links WHERE token = ?').get(token);
  if (link) {
    return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE id = ?`).get(link.survey_id),
             invitation: null, distritoId: link.distrito_id, departamentoId: link.departamento_id };
  }
  return { survey: db.prepare(`SELECT ${SURVEY_COLS} FROM surveys WHERE public_token = ?`).get(token),
           invitation: null, distritoId: null, departamentoId: null };
}

function isClosed(survey) {
  return survey.status !== 'ativo' || (survey.deadline && new Date(survey.deadline).getTime() < Date.now());
}

/* Atingiu o limite de respostas configurado para a pesquisa? */
function reachedLimit(db, survey) {
  if (!survey.max_responses) return false;
  const c = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id=? AND completed_at IS NOT NULL').get(survey.id).c;
  return c >= survey.max_responses;
}

/* Cota do distrito: a meta cadastrada na Estrutura (ou na campanha, quando houver)
   passa a ser um teto — ao atingi-la, aquele distrito para de receber respostas. */
function quotaReached(db, survey, distritoId) {
  if (!survey.enforce_quota || !distritoId) return null;
  const dist = db.prepare('SELECT name, meta FROM distritos WHERE id=?').get(distritoId);
  if (!dist) return null;
  const app = db.prepare(`SELECT ca.meta FROM campaign_applications ca
                          JOIN survey_campaigns c ON c.id = ca.campaign_id
                          WHERE c.survey_id = ? AND ca.distrito_id = ? AND ca.meta > 0
                          ORDER BY c.starts_at DESC LIMIT 1`).get(survey.id, distritoId);
  const meta = (app && app.meta) || dist.meta || 0;
  if (meta <= 0) return null;
  const n = db.prepare('SELECT COUNT(*) c FROM responses WHERE survey_id=? AND distrito_id=? AND completed_at IS NOT NULL')
    .get(survey.id, distritoId).c;
  return n >= meta ? { distrito: dist.name, meta, recebidas: n } : null;
}

/* Embaralhamento estável por resposta: a mesma pessoa vê sempre a mesma ordem se
   recarregar a página, mas pessoas diferentes veem ordens diferentes. */
function shuffleWithSeed(arr, seed) {
  const a = arr.slice();
  let s = 0;
  for (const ch of String(seed || 'x')) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Aplica a randomização configurada, sem quebrar a lógica condicional nem a
   posição das alternativas pontuadas. */
function applyRandomization(survey, questions, seed) {
  let list = questions;

  if (survey.randomize_options) {
    list = list.map(q => {
      // Só embaralha quando a posição não carrega significado: escala e matriz têm
      // ordem (peso, favorabilidade) e alternativa neutra, então ficam de fora.
      const scored = Array.isArray(q.option_points) && q.option_points.length;
      const hasNeutral = Number.isInteger((q.config || {}).neutralIndex);
      if (!['multiple', 'dropdown'].includes(q.type) || scored || hasNeutral) return q;
      if (!Array.isArray(q.options) || q.options.length < 2) return q;
      const order = shuffleWithSeed(q.options.map((_, i) => i), seed + q.id);
      const pick = arr => (Array.isArray(arr) && arr.length === q.options.length) ? order.map(i => arr[i]) : arr;
      return { ...q, options: order.map(i => q.options[i]), options_en: pick(q.options_en), options_es: pick(q.options_es) };
    });
  }

  if (survey.randomize_questions) {
    // A lógica condicional aponta para o número de ordem da pergunta-gatilho: embaralhar
    // as perguntas quebraria a referência, então esse par de recursos não se combina.
    const hasLogic = list.some(q => q.logic && (q.logic.showIf || q.logic.endIf || q.logic.jumpIf));
    // Com páginas, o sorteio é dentro de cada página: passar pergunta de uma página para
    // outra desmontaria o questionário desenhado em blocos e os saltos entre eles.
    if (!hasLogic) list = shufflePages(list, seed);
  }
  return list;
}

/* Embaralha as perguntas respeitando as páginas. Sem quebra de página o questionário é
   uma página só, e o resultado é o sorteio simples de antes. A marca de quebra fica na
   primeira pergunta de cada página, então é reposta depois do sorteio. */
function shufflePages(questions, seed) {
  const pages = [];
  questions.forEach(q => {
    if (!pages.length || (q.config && q.config.pageBreak)) pages.push([]);
    pages[pages.length - 1].push(q);
  });
  return pages.flatMap((page, pi) => {
    const shuffled = shuffleWithSeed(page, seed + ':' + pi);
    return shuffled.map((q, i) => {
      const cfg = { ...(q.config || {}) };
      if (pi > 0 && i === 0) cfg.pageBreak = true; else delete cfg.pageBreak;
      return { ...q, config: Object.keys(cfg).length ? cfg : null };
    });
  });
}

/* Resposta anterior deste respondente, quando a pesquisa permite corrigir o envio.
 * Pelo convite quando o link é nominal; pelo dispositivo quando é o link geral — numa
 * pesquisa anônima o dispositivo é o único identificador que sobra de quem já respondeu.
 * Sem isso, "permitir corrigir a resposta" só valeria para quem recebeu convite. */
function previousResponse(db, survey, invitation, device) {
  if (!survey.allow_edit) return null;
  if (invitation) {
    if (!invitation.responded_at) return null;
    return db.prepare(`SELECT id FROM responses WHERE invitation_id=? AND completed_at IS NOT NULL
                       ORDER BY completed_at DESC LIMIT 1`).get(invitation.id) || null;
  }
  if (!device) return null;
  return db.prepare(`SELECT id FROM responses WHERE survey_id=? AND device_id=? AND completed_at IS NOT NULL
                     ORDER BY completed_at DESC LIMIT 1`).get(survey.id, device) || null;
}

/* GET /public/survey/:token  — get survey by public token (no auth) */
function getPublic(req, res) {
  try {
    const db = getDB();
    const { survey, invitation, distritoId, departamentoId } = resolveToken(db, req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');

    const shortSurvey = { name: survey.name, name_en: survey.name_en, name_es: survey.name_es };
    if (isClosed(survey)) return ok(res, { closed: true, survey: shortSurvey }, 'Pesquisa encerrada');
    if (reachedLimit(db, survey)) return ok(res, { closed: true, limitReached: true, survey: shortSurvey }, 'Limite de respostas atingido');

    // Senha do coletor: o formulário só abre com a senha correta.
    if (survey.access_password_hash) {
      const pw = String(req.query.password || req.headers['x-survey-password'] || '');
      if (!pw) return ok(res, { passwordRequired: true, survey: shortSurvey }, 'Esta pesquisa é protegida por senha');
      if (!bcrypt.compareSync(pw, survey.access_password_hash))
        return ok(res, { passwordRequired: true, wrongPassword: true, survey: shortSurvey }, 'Senha incorreta');
    }

    // Variáveis do link: classificam a resposta sem o respondente informar nada.
    const linkVars = LV.resolveVars(db, survey.tenant_id, LV.readVars(req.query));
    const finalDistrito = distritoId || linkVars.distritoId;
    const finalDepto    = departamentoId || linkVars.departamentoId;

    const quota = quotaReached(db, survey, finalDistrito);
    if (quota) return ok(res, { closed: true, quotaReached: quota, survey: shortSurvey }, 'Cota deste distrito atingida');

    // Convite já respondido: só reabre quando a pesquisa permite editar a resposta.
    const device = String(req.query.device || '').trim().slice(0, 64) || null;
    const previous = previousResponse(db, survey, invitation, device);
    if (invitation && invitation.responded_at && !survey.allow_edit)
      return ok(res, { alreadyAnswered: true, survey: shortSurvey }, 'Este convite já foi respondido');

    if (invitation && !invitation.opened_at)
      db.prepare("UPDATE invitations SET opened_at=datetime('now') WHERE id=?").run(invitation.id);

    const rows = db.prepare(`SELECT id, order_num, type, text, text_en, text_es, options, options_en, options_es,
                                    required, config, logic
                             FROM questions WHERE survey_id = ? ORDER BY order_num`).all(survey.id);
    let questions = rows.map(Q.fromRow);

    // Modalidade veio no link: responde a pergunta de segmentação e tira-a do caminho.
    const segQ = questions.find(q => q.config && q.config.segmentation);
    let prefill = null;
    if (segQ && linkVars.modalidade) {
      const label = LV.matchOption(segQ.options, linkVars.modalidade);
      if (label) prefill = { questionId: segQ.id, value: [label], label };
      else linkVars.unknown.push('modalidade=' + linkVars.modalidade);
    }
    if (prefill) questions = questions.filter(q => q.id !== segQ.id);

    questions = applyRandomization(survey, questions, req.params.token);

    // Respostas anteriores, quando a pesquisa permite corrigir o que foi enviado.
    let answers = null;
    if (previous) {
      answers = {};
      db.prepare('SELECT question_id, value_text, value_num, value_json FROM answers WHERE response_id=?').all(previous.id)
        .forEach(a => {
          answers[a.question_id] = a.value_num != null ? a.value_num
            : a.value_json != null ? (() => { try { return JSON.parse(a.value_json); } catch { return null; } })()
            : a.value_text;
        });
    }

    return ok(res, {
      survey: { id: survey.id, name: survey.name, name_en: survey.name_en, name_es: survey.name_es,
                description: survey.description, description_en: survey.description_en,
                description_es: survey.description_es, category: survey.category, anonymous: survey.anonymous },
      questions,
      onePerDevice: !!survey.one_per_device,
      allowEdit: !!survey.allow_edit,
      thankYou: survey.thank_you || null,
      invited: invitation ? { name: invitation.name } : null,
      distritoId: finalDistrito || null,
      linkVars: Object.keys(linkVars.resolved).length ? linkVars.resolved : null,
      prefill,
      editing: answers ? { responseId: previous.id, answers } : null,
    });
  } catch (e) { return err(res, 'Erro ao carregar pesquisa', 500, e.message); }
}

/* POST /public/survey/:token  — submit response (no auth) */
function submitPublic(req, res) {
  try {
    const { answers, respondentId, deviceId } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length === 0) return badReq(res, 'Respostas são obrigatórias');

    const db = getDB();
    const { survey, invitation, distritoId, departamentoId } = resolveToken(db, req.params.token);
    if (!survey) return notFound(res, 'Pesquisa');
    if (isClosed(survey)) return badReq(res, 'Esta pesquisa está encerrada e não aceita mais respostas.');

    // A senha é revalidada no envio: sem isso, bastaria chamar a API direto.
    if (survey.access_password_hash) {
      const pw = String(req.body.password || req.headers['x-survey-password'] || '');
      if (!pw || !bcrypt.compareSync(pw, survey.access_password_hash))
        return forbidden(res, 'Senha incorreta ou ausente.');
    }

    // As variáveis do link são resolvidas de novo aqui — nada do que o cliente manda
    // como id entra sem passar pelo cadastro.
    const linkVars = LV.resolveVars(db, survey.tenant_id, LV.readVars(req.body.linkVars || req.body));
    const finalDistrito = distritoId || linkVars.distritoId;
    const finalDepto    = departamentoId || linkVars.departamentoId;

    // Correção de uma resposta já enviada, quando a pesquisa permite.
    const device = String(deviceId || '').trim().slice(0, 64) || null;
    const previous = previousResponse(db, survey, invitation, device);

    if (!previous) {
      if (reachedLimit(db, survey)) return badReq(res, 'Esta pesquisa já atingiu o limite de respostas definido.');
      const quota = quotaReached(db, survey, finalDistrito);
      if (quota) return badReq(res, `A cota de ${quota.distrito} já foi atingida (${quota.recebidas} de ${quota.meta}).`);
      if (invitation && invitation.responded_at)
        return badReq(res, 'Este convite já foi respondido. Cada link aceita uma única resposta.');
    }

    if (!previous && survey.one_per_device && device) {
      const dup = db.prepare('SELECT 1 FROM responses WHERE survey_id=? AND device_id=? AND completed_at IS NOT NULL').get(survey.id, device);
      if (dup) return badReq(res, 'Já registramos uma resposta deste dispositivo para esta pesquisa.');
    }

    let responseId;
    if (previous) {
      // Corrigir = regravar as respostas da mesma submissão, preservando a identidade
      // dela (versão, distrito, convite) para não inflar a contagem.
      responseId = previous.id;
      db.prepare('DELETE FROM answers WHERE response_id=?').run(responseId);
      db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    } else {
      responseId = uuid();
      const campaignId = activeCampaignId(db, survey.id);
      const version = db.prepare('SELECT id, number FROM survey_versions WHERE survey_id=? ORDER BY number DESC LIMIT 1').get(survey.id);
      db.prepare(`INSERT INTO responses (id, survey_id, respondent_id, ip_hash, distrito_id, departamento_id,
                                         device_id, invitation_id, campaign_id, version_id, version_number, link_vars)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        responseId, survey.id, survey.anonymous ? null : (respondentId || (invitation && invitation.respondent_id) || null),
        hashIP(req.ip || ''), finalDistrito || null, finalDepto || null,
        (survey.one_per_device || survey.allow_edit) ? device : null, invitation ? invitation.id : null, campaignId,
        version ? version.id : null, version ? version.number : null,
        Object.keys(linkVars.resolved).length ? JSON.stringify(linkVars.resolved) : null
      );
    }

    const stmt = db.prepare('INSERT INTO answers (id, response_id, question_id, value_text, value_num, value_json) VALUES (?,?,?,?,?,?)');
    const valid = new Set(db.prepare('SELECT id FROM questions WHERE survey_id=?').all(survey.id).map(q => q.id));
    answers.forEach(a => {
      if (!valid.has(a.questionId)) return;   // ignora pergunta de outra pesquisa
      const isNum = typeof a.value === 'number';
      const isJson = Array.isArray(a.value) || (a.value !== null && typeof a.value === 'object');
      stmt.run(uuid(), responseId, a.questionId,
        !isNum && !isJson ? String(a.value) : null,
        isNum            ? a.value : null,
        isJson           ? JSON.stringify(a.value) : null
      );
    });

    if (!previous) db.prepare("UPDATE responses SET completed_at=datetime('now') WHERE id=?").run(responseId);
    if (invitation) db.prepare("UPDATE invitations SET responded_at=datetime('now'), status='respondido' WHERE id=?").run(invitation.id);
    if (!previous) { try { require('../utils/push').notifyNewResponse(db, survey.id).catch(() => {}); } catch {} }

    return ok(res, { responseId, updated: !!previous, thankYou: survey.thank_you || null },
      previous ? 'Resposta atualizada. Obrigado!' : 'Resposta registrada com sucesso. Obrigado!');
  } catch (e) { return err(res, 'Erro ao registrar resposta', 500, e.message); }
}

module.exports = { getPublic, submitPublic };
