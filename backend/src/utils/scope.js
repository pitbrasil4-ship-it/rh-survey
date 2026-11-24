'use strict';
const { getDB } = require('../config/database');

/* Escopo de visão de um usuário.
 *
 * O Administrador enxerga tudo. Um Gestor pode ser amarrado a distritos: nesse caso
 * os resultados que ele abre contam apenas as respostas daqueles distritos, e as
 * categorias bloqueadas somem da lista de pesquisas.
 *
 * O escopo nunca é aplicado ao Administrador, para não haver como alguém se trancar fora.
 */

const PJ = s => { try { const p = s ? JSON.parse(s) : null; return Array.isArray(p) && p.length ? p : null; } catch { return null; } };

function scopeOf(user) {
  if (!user || user.role === 'admin') return { distritos: null, blocked: null };
  const db = getDB();
  const row = db.prepare('SELECT scope_distritos, blocked_categories FROM users WHERE id = ?').get(user.id);
  if (!row) return { distritos: null, blocked: null };
  return { distritos: PJ(row.scope_distritos), blocked: PJ(row.blocked_categories) };
}

/* Trecho de SQL para limitar as respostas aos distritos do usuário.
   Devolve { sql, args } — sql vem vazio quando não há limite. */
function responseScopeSql(user, alias = 'r') {
  const { distritos } = scopeOf(user);
  if (!distritos) return { sql: '', args: [] };
  return { sql: ` AND ${alias}.distrito_id IN (${distritos.map(() => '?').join(',')})`, args: distritos };
}

/* O usuário pode abrir esta pesquisa? Bloqueia pela categoria. */
function canSeeSurvey(user, survey) {
  const { blocked } = scopeOf(user);
  if (!blocked || !survey) return true;
  return !blocked.some(c => String(c).toLowerCase() === String(survey.category || '').toLowerCase());
}

module.exports = { scopeOf, responseScopeSql, canSeeSurvey };
