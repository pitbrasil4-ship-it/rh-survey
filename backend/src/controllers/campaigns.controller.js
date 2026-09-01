'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');

/* Campanha = instrumento (pesquisa) × período.
 * Aplicação = campanha × distrito, com a meta de respondentes daquele distrito.
 *
 * É o elo que faltava entre Estrutura, Respondentes e Pesquisas: com a campanha,
 * a meta cadastrada na Estrutura passa a ser consumida pelos indicadores de
 * participação, e cada distrito tem meta e adesão próprias dentro da campanha. */

/* GET /campaigns — campanhas do tenant com aplicações e números de participação */
function list(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const campaigns = db.prepare(`
      SELECT c.*, s.name AS survey_name, s.status AS survey_status, s.category AS survey_category
      FROM survey_campaigns c LEFT JOIN surveys s ON s.id = c.survey_id
      WHERE c.tenant_id = ? ORDER BY c.created_at DESC`).all(t);

    const distNames = {};
    db.prepare('SELECT id, name FROM distritos WHERE tenant_id=?').all(t).forEach(d => distNames[d.id] = d.name);

    const apps = db.prepare(`
      SELECT ca.* FROM campaign_applications ca
      JOIN survey_campaigns c ON c.id = ca.campaign_id WHERE c.tenant_id = ?`).all(t);

    const respByCampaign = {};
    db.prepare(`SELECT r.campaign_id, r.distrito_id, COUNT(*) c FROM responses r
                JOIN surveys s ON s.id = r.survey_id
                WHERE s.tenant_id=? AND r.completed_at IS NOT NULL AND r.campaign_id IS NOT NULL
                GROUP BY r.campaign_id, r.distrito_id`).all(t)
      .forEach(r => { (respByCampaign[r.campaign_id] = respByCampaign[r.campaign_id] || {})[r.distrito_id || '—'] = r.c; });

    return ok(res, {
      campaigns: campaigns.map(c => {
        const mine = apps.filter(a => a.campaign_id === c.id);
        const resp = respByCampaign[c.id] || {};
        const aplicacoes = mine.map(a => {
          const respostas = resp[a.distrito_id] || 0;
          return { id: a.id, distritoId: a.distrito_id, distrito: distNames[a.distrito_id] || '—',
                   meta: a.meta || 0, respostas, adesao: a.meta > 0 ? Math.round((respostas / a.meta) * 100) : null };
        });
        const metaTotal = aplicacoes.reduce((s, a) => s + a.meta, 0);
        const respTotal = aplicacoes.reduce((s, a) => s + a.respostas, 0);
        return { ...c, aplicacoes, metaTotal, respostasTotal: respTotal,
                 adesao: metaTotal > 0 ? Math.round((respTotal / metaTotal) * 100) : null };
      }),
    });
  } catch (e) { return err(res, 'Erro ao listar campanhas', 500, e.message); }
}

/* POST /campaigns — { name, surveyId, startsAt, endsAt, aplicacoes:[{distritoId, meta}] } */
function create(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const name = String(req.body.name || '').trim();
    if (!name) return badReq(res, 'Nome da campanha é obrigatório');
    const survey = db.prepare("SELECT id FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(req.body.surveyId, t);
    if (!survey) return badReq(res, 'Selecione uma pesquisa válida para a campanha');

    const id = uuid();
    db.prepare(`INSERT INTO survey_campaigns (id, tenant_id, survey_id, name, starts_at, ends_at, status)
                VALUES (?,?,?,?,?,?,?)`).run(
      id, t, survey.id, name, req.body.startsAt || null, req.body.endsAt || null,
      req.body.status || 'planejada');

    saveApplications(db, t, id, req.body.aplicacoes);
    return created(res, { id, name }, 'Campanha criada');
  } catch (e) { return err(res, 'Erro ao criar campanha', 500, e.message); }
}

/* PUT /campaigns/:id */
function update(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const cur = db.prepare('SELECT * FROM survey_campaigns WHERE id=? AND tenant_id=?').get(req.params.id, t);
    if (!cur) return notFound(res, 'Campanha');
    db.prepare('UPDATE survey_campaigns SET name=?, starts_at=?, ends_at=?, status=? WHERE id=?').run(
      String(req.body.name ?? cur.name).trim() || cur.name,
      req.body.startsAt === undefined ? cur.starts_at : (req.body.startsAt || null),
      req.body.endsAt === undefined ? cur.ends_at : (req.body.endsAt || null),
      req.body.status ?? cur.status,
      cur.id);
    if (Array.isArray(req.body.aplicacoes)) saveApplications(db, t, cur.id, req.body.aplicacoes);
    return ok(res, { id: cur.id }, 'Campanha atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar campanha', 500, e.message); }
}

/* Regrava as aplicações (campanha × distrito) da campanha. */
function saveApplications(db, tenantId, campaignId, aplicacoes) {
  if (!Array.isArray(aplicacoes)) return;
  const valid = new Set(db.prepare('SELECT id FROM distritos WHERE tenant_id=?').all(tenantId).map(d => d.id));
  db.prepare('DELETE FROM campaign_applications WHERE campaign_id=?').run(campaignId);
  const ins = db.prepare('INSERT INTO campaign_applications (id, campaign_id, distrito_id, meta) VALUES (?,?,?,?)');
  const seen = new Set();
  aplicacoes.forEach(a => {
    const did = a && a.distritoId;
    if (!did || !valid.has(did) || seen.has(did)) return;
    seen.add(did);
    ins.run(uuid(), campaignId, did, Math.max(0, Math.round(Number(a.meta) || 0)));
  });
}

/* DELETE /campaigns/:id */
function remove(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT id FROM survey_campaigns WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Campanha');
    db.prepare('DELETE FROM campaign_applications WHERE campaign_id=?').run(cur.id);
    db.prepare('UPDATE responses SET campaign_id=NULL WHERE campaign_id=?').run(cur.id);
    db.prepare('DELETE FROM survey_campaigns WHERE id=?').run(cur.id);
    return ok(res, { deleted: true }, 'Campanha removida');
  } catch (e) { return err(res, 'Erro ao remover campanha', 500, e.message); }
}

/* Campanha ativa de uma pesquisa no momento do envio da resposta (marca a resposta). */
function activeCampaignId(db, surveyId) {
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT id FROM survey_campaigns WHERE survey_id=?
      AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY starts_at DESC LIMIT 1`).get(surveyId, now, now);
  return row ? row.id : null;
}

module.exports = { list, create, update, remove, activeCampaignId };
