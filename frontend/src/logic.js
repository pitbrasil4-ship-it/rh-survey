/* Lógica condicional do formulário.
 *
 * Uma pergunta pode ter uma condição para aparecer:
 *   { mode: 'all' | 'any', conditions: [ { questionId, op, value } ] }
 *     mode 'all' = todas as condições precisam ser verdadeiras (E)
 *     mode 'any' = basta uma ser verdadeira (OU)
 *
 * E pode ter regras de salto, avaliadas ao avançar de página:
 *   [ { op, value, toPage } ]
 *
 * Operadores: eq (igual), neq (diferente), contains (contém), gt, lt, answered, empty.
 * O mesmo avaliador vale para o formulário público e para a prévia do construtor.
 */

const texto = v => (v == null ? '' : String(v)).trim().toLowerCase();

/* Deixa a resposta comparável, qualquer que seja o tipo da pergunta. */
function comparavel(resposta) {
  if (resposta == null) return { vazio: true, textos: [], numero: null };
  if (Array.isArray(resposta)) return { vazio: resposta.length === 0, textos: resposta.map(texto), numero: null };
  if (typeof resposta === 'object') {
    const vals = Object.values(resposta);
    return { vazio: vals.length === 0, textos: vals.map(texto), numero: null };
  }
  if (typeof resposta === 'number') return { vazio: false, textos: [texto(resposta)], numero: resposta };
  const s = String(resposta);
  const n = Number(s);
  return { vazio: s.trim() === '', textos: [texto(s)], numero: Number.isFinite(n) && s.trim() !== '' ? n : null };
}

/* Na escala a resposta é a POSIÇÃO: compara pelo rótulo quando a condição usa texto. */
function textosDaResposta(resposta, pergunta) {
  const c = comparavel(resposta);
  if (pergunta && (pergunta.type === 'scale' || pergunta.type === 'rating') && typeof resposta === 'number') {
    const opts = Array.isArray(pergunta.options) ? pergunta.options : [];
    const rotulo = opts[resposta - 1];
    if (rotulo != null) return { ...c, textos: [texto(rotulo), texto(resposta)] };
  }
  return c;
}

export function avaliarCondicao(cond, respostas, perguntasPorId) {
  if (!cond || !cond.questionId) return true;
  const pergunta = perguntasPorId ? perguntasPorId[cond.questionId] : null;
  const bruta = respostas ? respostas[cond.questionId] : undefined;
  const { vazio, textos, numero } = textosDaResposta(bruta, pergunta);
  const alvo = texto(cond.value);
  const alvoNum = Number(cond.value);

  switch (cond.op) {
    case 'answered': return !vazio;
    case 'empty':    return vazio;
    case 'eq':       return textos.includes(alvo);
    case 'neq':      return !textos.includes(alvo);
    case 'contains': return textos.some(t => t.includes(alvo));
    case 'gt':       return numero != null && Number.isFinite(alvoNum) && numero > alvoNum;
    case 'lt':       return numero != null && Number.isFinite(alvoNum) && numero < alvoNum;
    default:         return true;
  }
}

/* A pergunta deve aparecer? Sem lógica definida, aparece sempre. */
export function perguntaVisivel(pergunta, respostas, perguntasPorId) {
  const L = pergunta && pergunta.logic;
  if (!L || !Array.isArray(L.conditions) || L.conditions.length === 0) return true;
  const resultados = L.conditions.map(c => avaliarCondicao(c, respostas, perguntasPorId));
  return L.mode === 'any' ? resultados.some(Boolean) : resultados.every(Boolean);
}

/* Agrupa as perguntas em páginas, a partir das quebras marcadas. */
export function montarPaginas(questions) {
  const paginas = [];
  let atual = [];
  (questions || []).forEach((q, i) => {
    if (i > 0 && q.pageBreak) { paginas.push(atual); atual = []; }
    atual.push(q);
  });
  if (atual.length) paginas.push(atual);
  return paginas.length ? paginas : [[]];
}

/* Para onde ir depois desta página? Devolve o índice (0-based) ou null para "a próxima". */
export function proximaPagina(perguntasDaPagina, respostas, perguntasPorId) {
  for (const q of perguntasDaPagina || []) {
    if (!perguntaVisivel(q, respostas, perguntasPorId)) continue;
    const regras = Array.isArray(q.jump) ? q.jump : [];
    for (const r of regras) {
      if (!r || r.toPage == null) continue;
      if (avaliarCondicao({ questionId: q.id, op: r.op || 'eq', value: r.value }, respostas, perguntasPorId)) {
        const alvo = Number(r.toPage) - 1;
        if (Number.isFinite(alvo) && alvo >= 0) return alvo;
      }
    }
  }
  return null;
}

/* Páginas que têm ao menos uma pergunta visível — as vazias são puladas. */
export function paginaTemConteudo(perguntasDaPagina, respostas, perguntasPorId) {
  return (perguntasDaPagina || []).some(q => perguntaVisivel(q, respostas, perguntasPorId));
}
