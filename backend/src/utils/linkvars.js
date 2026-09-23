'use strict';
/* Variáveis no link do formulário.
 *
 * O link pode trazer distrito, regional, departamento e modalidade já resolvidos:
 *   /r/<token>?distrito=SP%20Capital&modalidade=Mensalista
 *
 * Com isso a resposta nasce classificada sem o respondente ter de informar nada — e a
 * pergunta de segmentação some do formulário, porque já foi respondida pelo link.
 * Aceita tanto o id quanto o nome (sem diferenciar acento ou caixa), porque quem monta
 * a planilha de disparo tem o nome, não o id. */

const norm = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Lê as variáveis de um objeto de query/body. Devolve só o que foi informado. */
function readVars(src) {
  const get = (...names) => {
    for (const n of names) {
      const v = src && src[n];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const out = {};
  const d = get('distrito', 'district', 'dist');
  const r = get('regional', 'region');
  const p = get('departamento', 'department', 'depto');
  const m = get('modalidade', 'modality', 'contrato');
  if (d) out.distrito = d;
  if (r) out.regional = r;
  if (p) out.departamento = p;
  if (m) out.modalidade = m;
  return out;
}

/* Resolve os nomes/ids da estrutura. Devolve { distritoId, departamentoId, modalidade,
   resolved: {...}, unknown: [...] } — o que não casar é reportado, não inventado. */
function resolveVars(db, tenantId, vars) {
  const out = { distritoId: null, departamentoId: null, modalidade: null, resolved: {}, unknown: [] };
  if (!vars || !Object.keys(vars).length) return out;

  const distritos = db.prepare('SELECT id, name, regional_id FROM distritos WHERE tenant_id=?').all(tenantId);
  const regionais = db.prepare('SELECT id, name FROM regionais WHERE tenant_id=?').all(tenantId);
  const deptos    = db.prepare('SELECT id, name FROM departamentos WHERE tenant_id=?').all(tenantId);
  const find = (list, v) => list.find(x => x.id === v) || list.find(x => norm(x.name) === norm(v));

  if (vars.distrito) {
    const d = find(distritos, vars.distrito);
    if (d) { out.distritoId = d.id; out.resolved.distrito = d.name; }
    else out.unknown.push('distrito=' + vars.distrito);
  }
  // Regional sem distrito não marca a resposta (a resposta é marcada por distrito),
  // mas vale registrar o que veio no link e validar que a regional existe.
  if (vars.regional) {
    const r = find(regionais, vars.regional);
    if (r) {
      out.resolved.regional = r.name;
      // Regional informada junto com um distrito de outra regional: o distrito manda,
      // mas a divergência fica registrada para quem for auditar o disparo.
      if (out.distritoId) {
        const d = distritos.find(x => x.id === out.distritoId);
        if (d && d.regional_id && d.regional_id !== r.id) out.unknown.push('regional≠distrito');
      }
    } else out.unknown.push('regional=' + vars.regional);
  }
  if (vars.departamento) {
    const p = find(deptos, vars.departamento);
    if (p) { out.departamentoId = p.id; out.resolved.departamento = p.name; }
    else out.unknown.push('departamento=' + vars.departamento);
  }
  if (vars.modalidade) { out.modalidade = vars.modalidade; out.resolved.modalidade = vars.modalidade; }
  return out;
}

/* Casa a modalidade do link com uma das alternativas da pergunta de segmentação.
   Devolve o rótulo exato cadastrado, ou null se não bater com nenhuma. */
function matchOption(options, value) {
  if (!value || !Array.isArray(options)) return null;
  return options.find(o => norm(o) === norm(value)) || null;
}

module.exports = { readVars, resolveVars, matchOption, norm };
