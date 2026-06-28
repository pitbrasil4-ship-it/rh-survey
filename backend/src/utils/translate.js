'use strict';
// Tradução automática do conteúdo de pesquisas (título, descrição, perguntas e opções)
// do português para inglês (en) e espanhol (es), via API da Anthropic.
const logger = require('./logger');

function aiKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  return (!k || k === 'your-anthropic-key-here') ? null : k;
}

// Entrada: { name, description, questions: [{ text, options }] } em PT.
// Saída:   { name_en, name_es, description_en, description_es,
//            questions: [{ text_en, text_es, options_en, options_es }] } alinhado por índice,
//          ou null se a IA não estiver disponível / a resposta for inválida.
async function translateSurvey({ name, description, questions = [] }) {
  const apiKey = aiKey();
  if (!apiKey) return null;

  const payload = {
    name: name || '',
    description: description || '',
    questions: questions.map(q => ({
      text: q.text || '',
      options: (Array.isArray(q.options) && q.options.length) ? q.options : null,
    })),
  };

  const prompt = `Traduza o conteúdo desta pesquisa de RH do português para inglês (en) e espanhol (es).
Responda APENAS com JSON válido (sem markdown, sem comentários), exatamente neste formato:
{"en":{"name":"...","description":"...","questions":[{"text":"...","options":["..."]}]},"es":{"name":"...","description":"...","questions":[{"text":"...","options":["..."]}]}}
Regras:
- Mantenha o MESMO número e a MESMA ordem de perguntas e de opções da entrada.
- Quando uma pergunta não tiver opções, use "options": null.
- NÃO traduza valores puramente numéricos de escala (ex.: "1","2",...,"10"): mantenha-os idênticos.
- Preserve o sentido e o tom; seja conciso e natural no idioma de destino.
Conteúdo (pt):
${JSON.stringify(payload, null, 2)}`;

  let data;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
    });
    data = await resp.json();
  } catch (e) { logger.warn('translateSurvey: falha na chamada à IA — ' + e.message); return null; }

  let parsed;
  try {
    const raw = ((data && data.content && data.content[0] && data.content[0].text) || '{}').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(raw);
  } catch (e) { logger.warn('translateSurvey: resposta da IA não é JSON válido'); return null; }

  const en = parsed.en, es = parsed.es;
  if (!en || !es || !Array.isArray(en.questions) || !Array.isArray(es.questions)) return null;

  const str = v => (v != null && String(v).trim()) ? String(v) : null;
  const pickQ = (langObj, i, srcOptions) => {
    const tq = langObj.questions[i] || {};
    let opts = null;
    if (Array.isArray(srcOptions) && srcOptions.length) {
      // Só aceita as opções traduzidas se vierem com o MESMO tamanho; caso contrário
      // deixa null, e o front faz fallback para as opções originais em PT.
      opts = (Array.isArray(tq.options) && tq.options.length === srcOptions.length) ? tq.options.map(String) : null;
    }
    return { text: str(tq.text), options: opts };
  };

  const outQuestions = [];
  for (let i = 0; i < questions.length; i++) {
    const src = payload.questions[i];
    const e = pickQ(en, i, src.options);
    const s = pickQ(es, i, src.options);
    outQuestions.push({ text_en: e.text, text_es: s.text, options_en: e.options, options_es: s.options });
  }

  return {
    name_en: str(en.name),
    name_es: str(es.name),
    description_en: description ? str(en.description) : null,
    description_es: description ? str(es.description) : null,
    questions: outQuestions,
  };
}

module.exports = { translateSurvey, aiEnabled: () => !!aiKey() };
