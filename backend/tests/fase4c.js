process.env.PORT = '4250'; process.env.SQLITE_PATH = './test.db';
const app = require(process.cwd() + '/src/app'); const base = 'http://127.0.0.1:4250/api/v1';
const J = async r => ({ s: r.status, b: await r.json() });

const srv = app.listen(4250, '127.0.0.1', async () => {
  let pass = 0, fail = 0;
  const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? ' ok   ' : ' FALHA') + ' ' + n + (x ? '  ' + x : '')); };
  try {
    const lg = await J(await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@empresa.com', password: 'Admin@2025!' }) }));
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lg.b.data.accessToken };

    // Questionário de Desligamento: quem NÃO está saindo pula o bloco de motivos.
    const cr = await J(await fetch(base + '/surveys', { method: 'POST', headers: H, body: JSON.stringify({
      name: 'Desligamento 2026', category: 'Feedback', targetGroup: 't', anonymous: true, questions: [
        { type: 'yesno', text: 'Você está saindo da empresa?', jump: [{ op: 'eq', value: 'false', toPage: 3 }] },
        { type: 'text',  text: 'Qual o principal motivo?', pageBreak: true,
          logic: { mode: 'all', conditions: [{ questionId: '__q1__', op: 'eq', value: 'true' }] } },
        { type: 'scale', text: 'Como avalia a liderança?', options: ['Ruim', 'Boa', 'Ótima'], option_points: [0, 50, 100] },
        { type: 'text',  text: 'Deixe um comentário final.', pageBreak: true },
      ] }) }));
    const id = cr.b.data.survey.id;

    // A condição precisa apontar para o id real da primeira pergunta.
    let d = (await J(await fetch(base + '/surveys/' + id, { headers: H }))).b.data;
    const q1 = d.questions[0].id;
    const corrigidas = d.questions.map(q => ({
      id: q.id, type: q.type, text: q.text,
      options: q.options, option_points: q.option_points,
      ...(q.page_break ? { pageBreak: true } : {}),
      ...(q.jump ? { jump: JSON.parse(q.jump) } : {}),
      ...(q.text.includes('motivo') ? { logic: { mode: 'all', conditions: [{ questionId: q1, op: 'eq', value: 'true' }] } } : {}),
    }));
    const up = await J(await fetch(base + `/surveys/${id}/questions`, { method: 'PUT', headers: H, body: JSON.stringify({ questions: corrigidas }) }));
    ck('salva lógica, quebra de página e salto', up.s === 200);

    await fetch(base + '/surveys/' + id + '/publish', { method: 'POST', headers: H });
    const tok = (await J(await fetch(base + '/surveys/' + id, { headers: H }))).b.data.survey.public_token;
    const PQ = (await J(await fetch(base + '/public/survey/' + tok))).b.data.questions;

    ck('formulário recebe a quebra de página', PQ[1].pageBreak === true && PQ[3].pageBreak === true);
    ck('formulário recebe a condição', PQ[1].logic && PQ[1].logic.conditions[0].questionId === q1, JSON.stringify(PQ[1].logic && PQ[1].logic.mode));
    ck('formulário recebe o salto', Array.isArray(PQ[0].jump) && PQ[0].jump[0].toPage === 3);

    // Avaliação com o mesmo avaliador que o formulário usa.
    const { perguntaVisivel, montarPaginas, proximaPagina } = await import('file://' + process.cwd() + '/../frontend/src/logic.js');
    const byId = Object.fromEntries(PQ.map(q => [q.id, q]));
    const paginas = montarPaginas(PQ);
    ck('o questionário tem 3 páginas', paginas.length === 3, `${paginas.map(p => p.length).join(' + ')} perguntas`);

    ck('quem está saindo vê o motivo', perguntaVisivel(PQ[1], { [q1]: 'true' }, byId) === true);
    ck('quem não está saindo não vê o motivo', perguntaVisivel(PQ[1], { [q1]: 'false' }, byId) === false);
    ck('quem não está saindo salta para a página 3', proximaPagina(paginas[0], { [q1]: 'false' }, byId) === 2);
    ck('quem está saindo segue para a página 2', proximaPagina(paginas[0], { [q1]: 'true' }, byId) === null);

    // Envio só com o que é visível, como o formulário faz.
    const visiveis = PQ.filter(q => perguntaVisivel(q, { [q1]: 'false' }, byId));
    const vals = { [q1]: 'false' };
    const resp = await fetch(base + '/public/survey/' + tok, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'nav-logica', answers: visiveis.filter(q => vals[q.id] !== undefined).map(q => ({ questionId: q.id, value: vals[q.id] })) }) });
    ck('aceita o envio sem as perguntas ocultas', resp.status === 200 || resp.status === 201, 'status ' + resp.status);

    const r = await J(await fetch(base + '/results/' + id, { headers: H }));
    const motivo = r.b.data.questions.find(x => x.text.includes('motivo'));
    ck('pergunta oculta não registra resposta', motivo.responseCount === 0, `${motivo.responseCount} respostas`);

    // Duplicar preserva a lógica.
    const dup = await J(await fetch(base + `/surveys/${id}/duplicate`, { method: 'POST', headers: H, body: JSON.stringify({}) }));
    const dq = (await J(await fetch(base + '/surveys/' + dup.b.data.survey.id, { headers: H }))).b.data.questions;
    ck('a cópia mantém lógica e páginas', !!dq[1].logic && dq[1].page_break === 1);
  } catch (e) { console.log('ERRO', e.message); fail++; }
  console.log(`\nTOTAL FASE 4C: ${pass} passou · ${fail} falhou`);
  srv.close(() => process.exit());
});
