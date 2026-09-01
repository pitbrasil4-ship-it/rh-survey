'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');

/* Conjuntos de dimensões (taxonomias) e suas dimensões.
 *
 * Uma pergunta pode pertencer a várias dimensões ao mesmo tempo, inclusive de
 * conjuntos diferentes: "Liderança" no Clima Organizacional e, na mesma pergunta,
 * "Demandas" + "Suporte do Gestor" no HSE Management Standards. Daí o N:N em
 * question_dimensions e o fato de o conjunto ser só um agrupador de cadastro. */

// Conjuntos pré-carregados no primeiro acesso — todos editáveis pelo RH depois.
const SEED = [
  {
    name: 'Clima Organizacional — RGIS',
    description: 'As 12 dimensões usadas nas pesquisas de clima da RGIS.',
    dimensions: [
      'Liderança',
      'Comunicação',
      'Reconhecimento',
      'Remuneração e Benefícios',
      'Desenvolvimento e Carreira',
      'Trabalho em Equipe',
      'Condições de Trabalho',
      'Segurança no Trabalho',
      'Processos e Ferramentas',
      'Orgulho e Imagem da Empresa',
      'Equilíbrio Vida–Trabalho',
      'Ética e Respeito',
    ],
  },
  {
    name: 'HSE Management Standards',
    description: 'As 7 dimensões do HSE Management Standards (riscos psicossociais).',
    dimensions: [
      'Demandas',
      'Controle',
      'Suporte do Gestor',
      'Suporte dos Colegas',
      'Relacionamentos',
      'Função',
      'Mudança',
    ],
  },
];

/* Cria os conjuntos padrão na primeira vez que o tenant abre a tela. */
function seedIfEmpty(db, tenantId) {
  const has = db.prepare('SELECT COUNT(*) c FROM dimension_sets WHERE tenant_id = ?').get(tenantId).c;
  if (has > 0) return;
  const insSet = db.prepare('INSERT INTO dimension_sets (id, tenant_id, name, description) VALUES (?,?,?,?)');
  const insDim = db.prepare('INSERT INTO dimensions (id, tenant_id, set_id, name, order_num) VALUES (?,?,?,?,?)');
  SEED.forEach(s => {
    const sid = uuid();
    insSet.run(sid, tenantId, s.name, s.description);
    s.dimensions.forEach((name, i) => insDim.run(uuid(), tenantId, sid, name, i + 1));
  });
}

/* GET /dimensions — conjuntos com suas dimensões e quantas perguntas usam cada uma */
function list(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    seedIfEmpty(db, t);
    const sets = db.prepare('SELECT id, name, description FROM dimension_sets WHERE tenant_id=? ORDER BY name').all(t);
    const dims = db.prepare(`
      SELECT d.id, d.set_id, d.name, d.description, d.order_num,
             (SELECT COUNT(*) FROM question_dimensions qd WHERE qd.dimension_id = d.id) AS question_count
      FROM dimensions d WHERE d.tenant_id=? ORDER BY d.order_num, d.name`).all(t);
    return ok(res, {
      sets: sets.map(s => ({ ...s, dimensions: dims.filter(d => d.set_id === s.id) })),
    });
  } catch (e) { return err(res, 'Erro ao carregar dimensões', 500, e.message); }
}

/* POST /dimensions/sets */
function createSet(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return badReq(res, 'Nome do conjunto é obrigatório');
    const id = uuid();
    getDB().prepare('INSERT INTO dimension_sets (id, tenant_id, name, description) VALUES (?,?,?,?)')
      .run(id, req.user.tenant_id, name, String(req.body.description || '').trim() || null);
    return created(res, { id, name }, 'Conjunto criado');
  } catch (e) { return err(res, 'Erro ao criar conjunto', 500, e.message); }
}

/* PUT /dimensions/sets/:id */
function updateSet(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT * FROM dimension_sets WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Conjunto');
    const name = String(req.body.name ?? cur.name).trim() || cur.name;
    const desc = req.body.description === undefined ? cur.description : (String(req.body.description).trim() || null);
    db.prepare('UPDATE dimension_sets SET name=?, description=? WHERE id=?').run(name, desc, cur.id);
    return ok(res, { id: cur.id, name }, 'Conjunto atualizado');
  } catch (e) { return err(res, 'Erro ao atualizar conjunto', 500, e.message); }
}

/* DELETE /dimensions/sets/:id — remove o conjunto, suas dimensões e os vínculos */
function deleteSet(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT id FROM dimension_sets WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Conjunto');
    const ids = db.prepare('SELECT id FROM dimensions WHERE set_id=?').all(cur.id).map(d => d.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM question_dimensions WHERE dimension_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM dimensions WHERE id IN (${ph})`).run(...ids);
    }
    db.prepare('DELETE FROM dimension_sets WHERE id=?').run(cur.id);
    return ok(res, { deleted: true }, 'Conjunto removido');
  } catch (e) { return err(res, 'Erro ao remover conjunto', 500, e.message); }
}

/* POST /dimensions */
function createDimension(req, res) {
  try {
    const db = getDB();
    const name = String(req.body.name || '').trim();
    if (!name) return badReq(res, 'Nome da dimensão é obrigatório');
    const set = db.prepare('SELECT id FROM dimension_sets WHERE id=? AND tenant_id=?').get(req.body.setId, req.user.tenant_id);
    if (!set) return badReq(res, 'Conjunto inválido');
    const next = db.prepare('SELECT COALESCE(MAX(order_num),0)+1 n FROM dimensions WHERE set_id=?').get(set.id).n;
    const id = uuid();
    db.prepare('INSERT INTO dimensions (id, tenant_id, set_id, name, description, order_num) VALUES (?,?,?,?,?,?)')
      .run(id, req.user.tenant_id, set.id, name, String(req.body.description || '').trim() || null, next);
    return created(res, { id, name, setId: set.id }, 'Dimensão criada');
  } catch (e) { return err(res, 'Erro ao criar dimensão', 500, e.message); }
}

/* PUT /dimensions/:id */
function updateDimension(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT * FROM dimensions WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Dimensão');
    const name = String(req.body.name ?? cur.name).trim() || cur.name;
    const desc = req.body.description === undefined ? cur.description : (String(req.body.description).trim() || null);
    db.prepare('UPDATE dimensions SET name=?, description=? WHERE id=?').run(name, desc, cur.id);
    return ok(res, { id: cur.id, name }, 'Dimensão atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar dimensão', 500, e.message); }
}

/* DELETE /dimensions/:id */
function deleteDimension(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT id FROM dimensions WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Dimensão');
    db.prepare('DELETE FROM question_dimensions WHERE dimension_id=?').run(cur.id);
    db.prepare('DELETE FROM dimensions WHERE id=?').run(cur.id);
    return ok(res, { deleted: true }, 'Dimensão removida');
  } catch (e) { return err(res, 'Erro ao remover dimensão', 500, e.message); }
}

module.exports = { list, createSet, updateSet, deleteSet, createDimension, updateDimension, deleteDimension, seedIfEmpty };
