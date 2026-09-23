'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');

/* Conjuntos de dimensões (taxonomias) e suas dimensões.
 *
 * São DUAS taxonomias paralelas sobre a mesma coleta, não uma lista única:
 *   • Clima RGIS — 12 dimensões, cada pergunta pertence a exatamente uma.
 *   • HSE Management Standards — 7 dimensões, alimenta o mapeamento de riscos
 *     psicossociais da NR-01 / PGR. Aqui uma pergunta pode pertencer a duas.
 * A mesma resposta gera os dois relatórios; a pesquisa não é aplicada duas vezes. */

// Nomes oficiais confirmados pelo RH (Capital Humano Brasil).
const SEED = [
  {
    code: 'clima',
    name: 'Clima Organizacional — RGIS',
    description: 'As 12 dimensões oficiais do Clima RGIS. Cada pergunta pertence a exatamente uma.',
    dimensions: [
      'Equilíbrio Vida Pessoal e Profissional',
      'Satisfação',
      'Compromisso',
      'Segurança no Trabalho',
      'Liderança',
      'Integridade',
      'Comunicação',
      'Desenvolvimento',
      'Remuneração',
      'Benefícios',
      'Capacitação e Treinamento',
      'Valores RGIS',
    ],
  },
  {
    code: 'hse',
    name: 'HSE Management Standards',
    description: 'As 7 dimensões do HSE Management Standards (riscos psicossociais — NR-01 / PGR).',
    dimensions: [
      'Demandas',
      'Controle',
      'Suporte do Gestor',
      'Suporte entre Pares',
      'Relacionamentos',
      'Clareza de Papel',
      'Mudança',
    ],
  },
];

/* Renomeações da lista provisória para os nomes oficiais. Roda uma única vez por
   conjunto (marcada pelo preenchimento do `code`), preservando os vínculos já feitos
   com as perguntas — renomear não é recriar. */
const RENAMES = {
  clima: {
    'Equilíbrio Vida–Trabalho': 'Equilíbrio Vida Pessoal e Profissional',
    'Equilíbrio Vida-Trabalho': 'Equilíbrio Vida Pessoal e Profissional',
    'Reconhecimento': 'Satisfação',
    'Trabalho em Equipe': 'Compromisso',
    'Ética e Respeito': 'Integridade',
    'Desenvolvimento e Carreira': 'Desenvolvimento',
    'Remuneração e Benefícios': 'Remuneração',
    'Processos e Ferramentas': 'Capacitação e Treinamento',
    'Orgulho e Imagem da Empresa': 'Valores RGIS',
  },
  hse: {
    'Suporte dos Colegas': 'Suporte entre Pares',
    'Função': 'Clareza de Papel',
    'Clareza de Função': 'Clareza de Papel',
  },
};

// Dimensão que a RGIS não usa — sai, desde que não tenha pergunta vinculada.
const DROP = { clima: ['Condições de Trabalho'] };

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Quantas perguntas usam uma dimensão (em qualquer vigência). */
function linkCount(db, dimensionId) {
  return db.prepare('SELECT COUNT(*) c FROM question_dimension_links WHERE dimension_id = ?').get(dimensionId).c;
}

/* Cria os conjuntos oficiais na primeira vez, e acerta os nomes de quem já recebeu a
   lista provisória. Idempotente: roda em todo acesso à tela sem efeito colateral. */
function seedIfEmpty(db, tenantId) {
  const insSet = db.prepare('INSERT INTO dimension_sets (id, tenant_id, name, description, code, order_num) VALUES (?,?,?,?,?,?)');
  const insDim = db.prepare('INSERT INTO dimensions (id, tenant_id, set_id, name, order_num) VALUES (?,?,?,?,?)');

  SEED.forEach((seed, si) => {
    // Localiza o conjunto pelo código ou, para quem veio da lista provisória, pelo nome.
    let set = db.prepare('SELECT * FROM dimension_sets WHERE tenant_id=? AND code=?').get(tenantId, seed.code)
           || db.prepare('SELECT * FROM dimension_sets WHERE tenant_id=? AND name=?').get(tenantId, seed.name);

    if (!set) {
      const sid = uuid();
      insSet.run(sid, tenantId, seed.name, seed.description, seed.code, si + 1);
      seed.dimensions.forEach((name, i) => insDim.run(uuid(), tenantId, sid, name, i + 1));
      return;
    }

    // Já marcado com o código: o RH assume o controle da lista daqui em diante.
    if (set.code === seed.code) return;

    db.prepare('UPDATE dimension_sets SET code=?, order_num=? WHERE id=?').run(seed.code, si + 1, set.id);

    const current = db.prepare('SELECT id, name FROM dimensions WHERE set_id=?').all(set.id);
    const byName  = {}; current.forEach(d => byName[norm(d.name)] = d);

    // 1) renomeia o que mudou de nome, mantendo os vínculos com as perguntas
    Object.entries(RENAMES[seed.code] || {}).forEach(([from, to]) => {
      const d = byName[norm(from)];
      if (d && !byName[norm(to)]) {
        db.prepare('UPDATE dimensions SET name=? WHERE id=?').run(to, d.id);
        byName[norm(to)] = d; delete byName[norm(from)];
      }
    });

    // 2) remove as que não existem na RGIS — só se ninguém estiver usando
    (DROP[seed.code] || []).forEach(name => {
      const d = byName[norm(name)];
      if (d && linkCount(db, d.id) === 0) {
        db.prepare('DELETE FROM dimensions WHERE id=?').run(d.id);
        delete byName[norm(name)];
      }
    });

    // 3) acrescenta as que faltam e reordena conforme a lista oficial
    seed.dimensions.forEach((name, i) => {
      const d = byName[norm(name)];
      if (d) db.prepare('UPDATE dimensions SET order_num=? WHERE id=?').run(i + 1, d.id);
      else insDim.run(uuid(), tenantId, set.id, name, i + 1);
    });
  });
}

/* GET /dimensions — conjuntos com suas dimensões e quantas perguntas usam cada uma */
function list(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    seedIfEmpty(db, t);
    const sets = db.prepare('SELECT id, name, description, code FROM dimension_sets WHERE tenant_id=? ORDER BY order_num, name').all(t);
    const dims = db.prepare(`
      SELECT d.id, d.set_id, d.name, d.description, d.order_num,
             (SELECT COUNT(DISTINCT l.question_id) FROM question_dimension_links l WHERE l.dimension_id = d.id) AS question_count
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
    const db = getDB();
    const next = db.prepare('SELECT COALESCE(MAX(order_num),0)+1 n FROM dimension_sets WHERE tenant_id=?').get(req.user.tenant_id).n;
    const id = uuid();
    db.prepare('INSERT INTO dimension_sets (id, tenant_id, name, description, order_num) VALUES (?,?,?,?,?)')
      .run(id, req.user.tenant_id, name, String(req.body.description || '').trim() || null, next);
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

/* DELETE /dimensions/sets/:id — só quando nenhuma dimensão do conjunto está em uso */
function deleteSet(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT id FROM dimension_sets WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Conjunto');
    const ids = db.prepare('SELECT id FROM dimensions WHERE set_id=?').all(cur.id).map(d => d.id);
    const used = ids.filter(id => linkCount(db, id) > 0).length;
    // Excluir com pergunta vinculada apagaria a classificação da série histórica.
    if (used) return badReq(res, `Este conjunto tem ${used} dimensão(ões) vinculada(s) a perguntas. Desvincule antes de excluir.`);
    if (ids.length) db.prepare(`DELETE FROM dimensions WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
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
    const dup = db.prepare('SELECT id FROM dimensions WHERE set_id=? AND lower(name)=lower(?)').get(set.id, name);
    if (dup) return badReq(res, 'Já existe uma dimensão com este nome no conjunto');
    const next = db.prepare('SELECT COALESCE(MAX(order_num),0)+1 n FROM dimensions WHERE set_id=?').get(set.id).n;
    const id = uuid();
    db.prepare('INSERT INTO dimensions (id, tenant_id, set_id, name, description, order_num) VALUES (?,?,?,?,?,?)')
      .run(id, req.user.tenant_id, set.id, name, String(req.body.description || '').trim() || null, next);
    return created(res, { id, name, setId: set.id }, 'Dimensão criada');
  } catch (e) { return err(res, 'Erro ao criar dimensão', 500, e.message); }
}

/* PUT /dimensions/:id — renomear propaga para tudo que já usa a dimensão */
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

/* DELETE /dimensions/:id — só sem pergunta vinculada */
function deleteDimension(req, res) {
  try {
    const db = getDB();
    const cur = db.prepare('SELECT id, name FROM dimensions WHERE id=? AND tenant_id=?').get(req.params.id, req.user.tenant_id);
    if (!cur) return notFound(res, 'Dimensão');
    const n = linkCount(db, cur.id);
    if (n > 0) return badReq(res, `"${cur.name}" está vinculada a ${n} pergunta(s). Desvincule-a das perguntas antes de excluir.`);
    db.prepare('DELETE FROM dimensions WHERE id=?').run(cur.id);
    return ok(res, { deleted: true }, 'Dimensão removida');
  } catch (e) { return err(res, 'Erro ao remover dimensão', 500, e.message); }
}

/* Resolve nomes de dimensão vindos da planilha para ids. Tolerante a acento, caixa e
   a variações curtas ("Segurança" ↔ "Segurança no Trabalho"), porque a planilha do RH
   nem sempre repete o nome oficial por extenso. Devolve { ids, unmatched }. */
function resolveNames(db, tenantId, names) {
  const all = db.prepare(`SELECT d.id, d.name, s.code AS set_code FROM dimensions d
                          LEFT JOIN dimension_sets s ON s.id = d.set_id
                          WHERE d.tenant_id=?`).all(tenantId);
  const exact = {}; all.forEach(d => exact[norm(d.name)] = d);
  const ids = [], unmatched = [];
  [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))].forEach(raw => {
    const k = norm(raw);
    let hit = exact[k];
    if (!hit) {
      const partial = all.filter(d => norm(d.name).startsWith(k) || k.startsWith(norm(d.name)));
      if (partial.length === 1) hit = partial[0];
    }
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); }
    else unmatched.push(raw);
  });
  return { ids, unmatched };
}

/* POST /dimensions/resolve — usado pela importação para converter nomes em ids */
function resolve(req, res) {
  try {
    const db = getDB();
    const r = resolveNames(db, req.user.tenant_id, req.body.names || []);
    return ok(res, r);
  } catch (e) { return err(res, 'Erro ao resolver dimensões', 500, e.message); }
}

module.exports = {
  list, createSet, updateSet, deleteSet,
  createDimension, updateDimension, deleteDimension,
  resolve, resolveNames, seedIfEmpty,
};
