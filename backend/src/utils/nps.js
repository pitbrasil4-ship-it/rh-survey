'use strict';

/**
 * Calculates NPS from an array of scores (0-10).
 * Promoters: 9-10  |  Passives: 7-8  |  Detractors: 0-6
 * NPS = % Promoters - % Detractors (range: -100 to +100)
 */
function calculateNPS(scores) {
  if (!scores || scores.length === 0) return { nps: 0, promoters: 0, passives: 0, detractors: 0, total: 0 };
  const total      = scores.length;
  const promoters  = scores.filter(s => s >= 9).length;
  const passives   = scores.filter(s => s >= 7 && s <= 8).length;
  const detractors = scores.filter(s => s <= 6).length;
  const nps        = Math.round(((promoters - detractors) / total) * 100);
  return {
    nps,
    promoters:  Math.round((promoters  / total) * 100),
    passives:   Math.round((passives   / total) * 100),
    detractors: Math.round((detractors / total) * 100),
    total,
    classification: nps >= 75 ? 'Excelente' : nps >= 50 ? 'Bom' : nps >= 0 ? 'Neutro' : 'Ruim'
  };
}

/**
 * Calculates average score for scale/rating questions.
 */
function calculateAverage(values) {
  if (!values || values.length === 0) return 0;
  return parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
}

/**
 * Calculates frequency distribution for multiple choice and text answers.
 */
function calculateFrequency(values) {
  const freq = {};
  values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  const total = values.length;
  return Object.entries(freq)
    .map(([value, count]) => ({ value, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

module.exports = { calculateNPS, calculateAverage, calculateFrequency };
