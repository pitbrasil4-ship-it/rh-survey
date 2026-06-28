'use strict';
const { v4: uuid } = require('uuid');
const { getDB }    = require('../config/database');
const { ok, created, err, notFound, badReq } = require('../utils/response');

/* GET /org — estrutura completa do tenant */
function list(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const regionais     = db.prepare('SELECT id, name FROM regionais WHERE tenant_id=? ORDER BY name').all(t);
    const distritos     = db.prepare('SELECT id, name, regional_id, meta FROM distritos WHERE tenant_id=? ORDER BY name').all(t);
    const departamentos = db.prepare('SELECT id, name, meta FROM departamentos WHERE tenant_id=? ORDER BY name').all(t);
    return ok(res, { regionais, distritos, departamentos });
  } catch (e) { return err(res, 'Erro ao carregar estrutura', 500, e.message); }
}

/* ---- Regionais ---- */
function createRegional(req, res) {
  try {
    const n = (req.body.name || '').trim(); if (!n) return badReq(res, 'Nome obrigatório');
    const id = uuid();
    getDB().prepare('INSERT INTO regionais (id, tenant_id, name) VALUES (?,?,?)').run(id, req.user.tenant_id, n);
    return created(res, { id, name: n }, 'Regional criada');
  } catch (e) { return err(res, 'Erro ao criar regional', 500, e.message); }
}
function updateRegional(req, res) {
  try {
    const n = (req.body.name || '').trim();
    const r = getDB().prepare('UPDATE regionais SET name=? WHERE id=? AND tenant_id=?').run(n, req.params.id, req.user.tenant_id);
    if (!r.changes) return notFound(res, 'Regional');
    return ok(res, { id: req.params.id, name: n }, 'Regional atualizada');
  } catch (e) { return err(res, 'Erro ao atualizar regional', 500, e.message); }
}
function deleteRegional(req, res) {
  try {
    const db = getDB();
    db.prepare('DELETE FROM regionais WHERE id=? AND tenant_id=?').run(req.params.id, req.user.tenant_id);
    db.prepare('UPDATE distritos SET regional_id=NULL WHERE regional_id=? AND tenant_id=?').run(req.params.id, req.user.tenant_id);
    return ok(res, { deleted: true }, 'Regional removida');
  } catch (e) { return err(res, 'Erro ao remover regional', 500, e.message); }
}

/* ---- Distritos ---- */
function createDistrito(req, res) {
  try {
    const { name, regionalId, meta } = req.body;
    const n = (name || '').trim(); if (!n) return badReq(res, 'Nome obrigatório');
    const id = uuid();
    getDB().prepare('INSERT INTO distritos (id, tenant_id, name, regional_id, meta) VALUES (?,?,?,?,?)')
      .run(id, req.user.tenant_id, n, regionalId || null, Number(meta) || 0);
    return created(res, { id }, 'Distrito criado');
  } catch (e) { return err(res, 'Erro ao criar distrito', 500, e.message); }
}
function updateDistrito(req, res) {
  try {
    const { name, regionalId, meta } = req.body;
    const r = getDB().prepare('UPDATE distritos SET name=?, regional_id=?, meta=? WHERE id=? AND tenant_id=?')
      .run((name || '').trim(), regionalId || null, Number(meta) || 0, req.params.id, req.user.tenant_id);
    if (!r.changes) return notFound(res, 'Distrito');
    return ok(res, { updated: true }, 'Distrito atualizado');
  } catch (e) { return err(res, 'Erro ao atualizar distrito', 500, e.message); }
}
function deleteDistrito(req, res) {
  try {
    getDB().prepare('DELETE FROM distritos WHERE id=? AND tenant_id=?').run(req.params.id, req.user.tenant_id);
    return ok(res, { deleted: true }, 'Distrito removido');
  } catch (e) { return err(res, 'Erro ao remover distrito', 500, e.message); }
}

/* ---- Departamentos ---- */
function createDepartamento(req, res) {
  try {
    const { name, meta } = req.body;
    const n = (name || '').trim(); if (!n) return badReq(res, 'Nome obrigatório');
    const id = uuid();
    getDB().prepare('INSERT INTO departamentos (id, tenant_id, name, meta) VALUES (?,?,?,?)')
      .run(id, req.user.tenant_id, n, Number(meta) || 0);
    return created(res, { id }, 'Departamento criado');
  } catch (e) { return err(res, 'Erro ao criar departamento', 500, e.message); }
}
function updateDepartamento(req, res) {
  try {
    const { name, meta } = req.body;
    const r = getDB().prepare('UPDATE departamentos SET name=?, meta=? WHERE id=? AND tenant_id=?')
      .run((name || '').trim(), Number(meta) || 0, req.params.id, req.user.tenant_id);
    if (!r.changes) return notFound(res, 'Departamento');
    return ok(res, { updated: true }, 'Departamento atualizado');
  } catch (e) { return err(res, 'Erro ao atualizar departamento', 500, e.message); }
}
function deleteDepartamento(req, res) {
  try {
    getDB().prepare('DELETE FROM departamentos WHERE id=? AND tenant_id=?').run(req.params.id, req.user.tenant_id);
    return ok(res, { deleted: true }, 'Departamento removido');
  } catch (e) { return err(res, 'Erro ao remover departamento', 500, e.message); }
}

/* POST /org/import — importa a estrutura da planilha (substitui por padrão) */
function importStructure(req, res) {
  try {
    const db = getDB(); const t = req.user.tenant_id;
    const { regionais = [], distritos = [], departamentos = [], replace = true } = req.body;
    if (replace) {
      db.prepare('DELETE FROM distritos WHERE tenant_id=?').run(t);
      db.prepare('DELETE FROM departamentos WHERE tenant_id=?').run(t);
      db.prepare('DELETE FROM regionais WHERE tenant_id=?').run(t);
    }
    const regMap = {};
    regionais.forEach(name => {
      const nm = String(name || '').trim(); if (!nm) return;
      const id = uuid();
      db.prepare('INSERT INTO regionais (id, tenant_id, name) VALUES (?,?,?)').run(id, t, nm);
      regMap[nm.toLowerCase()] = id;
    });
    distritos.forEach(d => {
      const nm = String(d.name || '').trim(); if (!nm) return;
      const rid = regMap[String(d.regional || '').trim().toLowerCase()] || null;
      db.prepare('INSERT INTO distritos (id, tenant_id, name, regional_id, meta) VALUES (?,?,?,?,?)').run(uuid(), t, nm, rid, Number(d.meta) || 0);
    });
    departamentos.forEach(d => {
      const nm = String(d.name || '').trim(); if (!nm) return;
      db.prepare('INSERT INTO departamentos (id, tenant_id, name, meta) VALUES (?,?,?,?)').run(uuid(), t, nm, Number(d.meta) || 0);
    });
    return ok(res, { regionais: regionais.length, distritos: distritos.length, departamentos: departamentos.length }, 'Estrutura importada');
  } catch (e) { return err(res, 'Erro ao importar estrutura', 500, e.message); }
}

module.exports = {
  list,
  createRegional, updateRegional, deleteRegional,
  createDistrito, updateDistrito, deleteDistrito,
  createDepartamento, updateDepartamento, deleteDepartamento,
  importStructure,
};
