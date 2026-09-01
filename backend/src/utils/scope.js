'use strict';
/* Escopo de visualização por usuário.
 *
 * Um Gestor pode ficar amarrado a um distrito (ou a uma regional inteira) no cadastro
 * de Equipe & Acesso. A partir daí, todo resultado que ele abre é filtrado por esse
 * escopo — participação, notas e segmentos só contam as respostas do próprio distrito.
 * Além disso, `blocked_categories` esconde categorias inteiras de pesquisa (ex.: o
 * Gestor não enxerga os resultados da Avaliação de Gestores, onde ele é o avaliado).
 *
 * Admin nunca é filtrado. */

const { parseJSON } = require('./questions');

/* Lista de distritos que o usuário pode enxergar, ou null quando não há restrição. */
function scopeDistritos(db, user) {
  if (!user || user.role === 'admin') return null;
  if (user.distrito_id) return [user.distrito_id];
  if (user.regional_id) {
    const rows = db.prepare('SELECT id FROM distritos WHERE tenant_id=? AND regional_id=?').all(user.tenant_id, user.regional_id);
    return rows.map(r => r.id);
  }
  return null;
}

/* Categorias de pesquisa ocultas para este usuário. */
function blockedCategories(user) {
  if (!user || user.role === 'admin') return [];
  const arr = parseJSON(user.blocked_categories);
  return Array.isArray(arr) ? arr.map(String) : [];
}

/* O usuário pode abrir os resultados desta pesquisa? */
function canSeeSurvey(user, survey) {
  if (!survey) return false;
  const blocked = blockedCategories(user);
  return !(survey.category && blocked.includes(String(survey.category)));
}

/* Fragmento SQL + parâmetros para restringir `responses` ao escopo do usuário.
 * Devolve { sql: '', params: [] } quando não há restrição. */
function responseScopeSQL(db, user, alias = 'r') {
  const dist = scopeDistritos(db, user);
  if (!dist) return { sql: '', params: [] };
  if (!dist.length) return { sql: ` AND 1 = 0`, params: [] }; // regional sem distritos: não vê nada
  return { sql: ` AND ${alias}.distrito_id IN (${dist.map(() => '?').join(',')})`, params: dist };
}

/* Ids das pesquisas que o usuário pode listar/abrir resultados. */
function visibleSurveyIds(db, user, tenantId) {
  const blocked = blockedCategories(user);
  if (!blocked.length) return null; // sem restrição por categoria
  const rows = db.prepare(`SELECT id FROM surveys WHERE tenant_id=? AND status != 'excluido'`).all(tenantId);
  const all  = db.prepare(`SELECT id, category FROM surveys WHERE tenant_id=?`).all(tenantId);
  const hide = new Set(all.filter(s => s.category && blocked.includes(String(s.category))).map(s => s.id));
  return rows.map(r => r.id).filter(id => !hide.has(id));
}

module.exports = { scopeDistritos, blockedCategories, canSeeSurvey, responseScopeSQL, visibleSurveyIds };
