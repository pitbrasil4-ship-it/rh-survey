'use strict';
const { v4: uuid } = require('uuid');
const { getDB } = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');
const { canSeeSurvey } = require('../utils/scope');

/* Visões nomeadas: uma combinação de recorte, cruzamento e filtros salva com nome.
 *
 * Existe porque a mesma leitura é refeita toda semana — "Intermitentes do Sudeste",
 * "modalidade × Q2", "só os comentários sinalizados" — e hoje isso é remontado do zero
 * a cada vez, ou vira uma exportação manual que envelhece no dia seguinte.
 *
 * A visão guarda o RECORTE, nunca o resultado: reabrir recalcula sobre os dados de hoje.
 * É a diferença entre uma visão e um print — e é o que faz ela continuar certa depois
 * que novas respostas entram.
 *
 * Compartilhar torna a visão visível para o tenant inteiro, mas não empresta permissão
 * nenhuma: quem abrir continua vendo só o que o próprio escopo deixa ver. */

const TIPOS = ['resultados', 'cruzamento', 'comentarios'];

function linha(v, userId) {
  let filtros = {};
  try { filtros = v.filters ? JSON.parse(v.filters) : {}; } catch {}
  return {
    id: v.id, name: v.name, kind: v.kind, surveyId: v.survey_id, surveyName: v.survey_name || null,
    filters: filtros, shared: !!v.shared, createdAt: v.created_at,
    owner: v.owner_name || null, mine: v.user_id === userId,
  };
}

/* GET /views?surveyId=&kind= — as minhas visões mais as compartilhadas do tenant. */
function list(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const cond = [], params = [t, req.user.id];
    if (req.query.surveyId) { cond.push('v.survey_id = ?'); params.push(req.query.surveyId); }
    if (req.query.kind)     { cond.push('v.kind = ?');      params.push(req.query.kind); }
    const extra = cond.length ? ' AND ' + cond.join(' AND ') : '';

    const rows = db.prepare(`
      SELECT v.*, s.name AS survey_name, u.name AS owner_name
      FROM saved_views v
      LEFT JOIN surveys s ON s.id = v.survey_id
      LEFT JOIN users u   ON u.id = v.user_id
      WHERE v.tenant_id = ? AND (v.user_id = ? OR v.shared = 1)${extra}
      ORDER BY v.created_at DESC`).all(...params);

    // Uma visão de pesquisa que o usuário não pode ver não aparece na lista dele.
    const visiveis = rows.filter(v => {
      if (!v.survey_id) return true;
      const sv = db.prepare('SELECT * FROM surveys WHERE id=? AND tenant_id=?').get(v.survey_id, t);
      return sv ? canSeeSurvey(req.user, sv) : false;
    });

    return ok(res, { views: visiveis.map(v => linha(v, req.user.id)) });
  } catch (e) { return err(res, 'Erro ao listar as visões', 500, e.message); }
}

/* POST /views — { name, kind, surveyId, filters, shared } */
function create(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) return badReq(res, 'Dê um nome à visão');
    const kind = TIPOS.includes(req.body.kind) ? req.body.kind : 'resultados';

    let surveyId = null;
    if (req.body.surveyId) {
      const sv = db.prepare("SELECT * FROM surveys WHERE id=? AND tenant_id=? AND status != 'excluido'").get(req.body.surveyId, t);
      if (!sv) return notFound(res, 'Pesquisa');
      if (!canSeeSurvey(req.user, sv)) return err(res, 'Você não tem permissão para esta pesquisa', 403);
      surveyId = sv.id;
    }

    const filtros = (req.body.filters && typeof req.body.filters === 'object') ? req.body.filters : {};
    const id = uuid();
    db.prepare(`INSERT INTO saved_views (id, tenant_id, user_id, survey_id, name, kind, filters, shared)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, t, req.user.id, surveyId, name, kind, JSON.stringify(filtros), req.body.shared ? 1 : 0);
    return created(res, { id, name }, 'Visão salva');
  } catch (e) { return err(res, 'Erro ao salvar a visão', 500, e.message); }
}

/* PUT /views/:id — renomear, regravar os filtros ou (des)compartilhar. Só o dono. */
function update(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT * FROM saved_views WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Visão');
    if (cur.user_id !== req.user.id) return err(res, 'Só quem criou a visão pode alterá-la', 403);

    const name = req.body.name === undefined ? cur.name : String(req.body.name || '').trim().slice(0, 120) || cur.name;
    const filtros = (req.body.filters && typeof req.body.filters === 'object') ? JSON.stringify(req.body.filters) : cur.filters;
    const shared = req.body.shared === undefined ? cur.shared : (req.body.shared ? 1 : 0);
    db.prepare('UPDATE saved_views SET name=?, filters=?, shared=? WHERE id=?').run(name, filtros, shared, cur.id);
    return ok(res, { id: cur.id, name, shared: !!shared }, 'Visão atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar a visão', 500, e.message); }
}

/* DELETE /views/:id — só o dono. */
function remove(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT * FROM saved_views WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Visão');
    if (cur.user_id !== req.user.id) return err(res, 'Só quem criou a visão pode removê-la', 403);
    db.prepare('DELETE FROM saved_views WHERE id=?').run(cur.id);
    return ok(res, { deleted: true }, 'Visão removida');
  } catch (e) { return err(res, 'Erro ao remover a visão', 500, e.message); }
}

module.exports = { list, create, update, remove, TIPOS };
