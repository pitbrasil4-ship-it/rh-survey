'use strict';
/* Regras de pontuação compartilhadas por Resultados, PDF e ciclo 360°.
 *
 * 1) Alternativa NEUTRA ("Não se aplica", "Não sei", "Prefiro não responder") não entra
 *    na média, no % atingido nem na favorabilidade. Ela continua contando na distribuição,
 *    para o RH enxergar quantas pessoas marcaram, mas sai da base de cálculo.
 * 2) O % atingido de uma resposta usa os pesos por alternativa (option_points) quando existem
 *    e, sem eles, a posição na escala — a MESMA conta em todas as telas.
 */

const NEUTRAL_RE = /^(n[ãa]o\s*se\s*aplica|n\s*\/?\s*a|n[ãa]o\s*sei|n[ãa]o\s*sei\s*avaliar|prefiro\s*n[ãa]o\s*(responder|opinar|informar)|sem\s*opini[ãa]o|n[ãa]o\s*observei|n[ãa]o\s*tenho\s*como\s*avaliar|not\s*applicable|does\s*not\s*apply|no\s*aplica|no\s*se\s*aplica)$/i;

/* A alternativa é neutra? Compara o rótulo sem acento-sensibilidade de espaços e pontuação final. */
function isNeutralLabel(label) {
  if (typeof label !== 'string') return false;
  const clean = label.replace(/\s+/g, ' ').replace(/[.:;!?]+$/, '').trim();
  return NEUTRAL_RE.test(clean);
}

/* Índices (0-based) das alternativas neutras de uma pergunta. */
function neutralIndexes(options) {
  const set = new Set();
  (Array.isArray(options) ? options : []).forEach((label, i) => { if (isNeutralLabel(label)) set.add(i); });
  return set;
}

/* Notas de escala/estrelas que entram no cálculo (sem as neutras). */
function scoredValues(answers, options) {
  const neutral = neutralIndexes(options);
  return (answers || [])
    .map(a => a.value_num)
    .filter(v => v !== null && v !== undefined && !neutral.has(v - 1));
}

/* % atingido de UMA resposta (0 a 100). null = não entra na conta (neutra ou sem dado). */
function earnedPct(q, answer, options, points) {
  const opts    = Array.isArray(options) ? options : [];
  const neutral = neutralIndexes(opts);
  const type    = q && q.type;

  if (type === 'scale' || type === 'rating') {
    const pos = answer.value_num;
    if (pos == null || neutral.has(pos - 1)) return null;
    if (points && points[pos - 1] != null) return Number(points[pos - 1]);
    const max = opts.length || 5;                       // sem pesos: posição na escala
    return max > 0 ? (pos / max) * 100 : null;
  }

  if (type === 'nps') {
    const v = answer.value_num;
    return v == null ? null : (v / 10) * 100;
  }

  if (type === 'multiple') {
    let sel = [];
    try { sel = JSON.parse(answer.value_json || '[]'); } catch {}
    const vals = (Array.isArray(sel) ? sel : [])
      .filter(l => !isNeutralLabel(l))
      .map(l => { const i = opts.indexOf(l); return (i >= 0 && points && points[i] != null) ? Number(points[i]) : null; })
      .filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  if (type === 'yesno') {
    const v = String(answer.value_text || '').toLowerCase();
    if (!v) return null;
    const yes = (v === 'true' || v === 'sim' || v === '1' || v === 'yes');
    if (points && points.length >= 2) return Number(yes ? points[0] : points[1]);
    return yes ? 100 : 0;
  }

  return null;
}

/* Favorabilidade: % das respostas válidas nos pontos favoráveis da escala.
   Favorável = peso >= 75 quando há pesos; sem pesos, os dois pontos mais altos. */
function favorability(q, answers, options, points) {
  const opts    = Array.isArray(options) ? options : [];
  const neutral = neutralIndexes(opts);
  const valid   = (answers || []).filter(a => a.value_num != null && !neutral.has(a.value_num - 1));
  if (!valid.length || !opts.length) return null;

  const isFav = idx => {
    if (points && points[idx] != null) return Number(points[idx]) >= 75;
    return idx >= opts.length - 2;
  };
  const isUnfav = idx => {
    if (points && points[idx] != null) return Number(points[idx]) <= 25;
    return idx <= 1;
  };
  const fav   = valid.filter(a => isFav(a.value_num - 1)).length;
  const unfav = valid.filter(a => isUnfav(a.value_num - 1)).length;
  return {
    base: valid.length,
    favPct:   Math.round((fav   / valid.length) * 100),
    unfavPct: Math.round((unfav / valid.length) * 100),
    neutralCount: (answers || []).filter(a => a.value_num != null && neutral.has(a.value_num - 1)).length,
  };
}

module.exports = { isNeutralLabel, neutralIndexes, scoredValues, earnedPct, favorability };
