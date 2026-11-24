process.env.PORT = '4251'; process.env.SQLITE_PATH = './test.db';
const app = require(process.cwd() + '/src/app'); const base = 'http://127.0.0.1:4251/api/v1';
const J = async r => ({ s: r.status, b: await r.json() });

const srv = app.listen(4251, '127.0.0.1', async () => {
  let pass = 0, fail = 0;
  const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? ' ok   ' : ' FALHA') + ' ' + n + (x ? '  ' + x : '')); };
  try {
    const lg = await J(await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@empresa.com', password: 'Admin@2025!' }) }));
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lg.b.data.accessToken };

    // ---------- Opções do coletor ----------
    const cr = await J(await fetch(base + '/surveys', { method: 'POST', headers: H, body: JSON.stringify({
      name: 'Coletor F5', category: 'Clima', targetGroup: 't', anonymous: true, questions: [
        { type: 'scale',    text: 'Como você avalia a liderança?', options: ['Ruim','Boa','Ótima'], option_points: [0,50,100] },
        { type: 'multiple', text: 'O que mais te motiva?', options: ['A','B','C'] },
        { type: 'text',     text: 'Comentário livre', pageBreak: true },
      ] }) }));
    const id = cr.b.data.survey.id;
    await fetch(base + '/surveys/' + id + '/publish', { method: 'POST', headers: H });
    const token = (await J(await fetch(base + '/surveys/' + id, { headers: H }))).b.data.survey.public_token;

    // 1. Senha de acesso bloqueia a abertura
    await fetch(base + '/surveys/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ accessPassword: 'rgis2026' }) });
    let g = await J(await fetch(base + '/public/survey/' + token));
    ck('1. senha pedida ao abrir', g.b.data.requiresPassword === true && !g.b.data.questions);

    // 2. Senha errada continua barrando
    g = await J(await fetch(base + '/public/survey/' + token + '?pwd=errada'));
    ck('2. senha errada barra', g.b.data.requiresPassword === true && g.b.data.wrong === true);

    // 3. Senha certa libera as perguntas
    g = await J(await fetch(base + '/public/survey/' + token + '?pwd=rgis2026'));
    ck('3. senha certa libera', !g.b.data.requiresPassword && (g.b.data.questions || []).length === 3);

    // 4. A senha nunca vai no corpo da resposta pública
    ck('4. senha não é exposta', g.b.data.survey.access_password === undefined);

    // 5. Envio sem senha é recusado
    const qs = g.b.data.questions;
    let p = await J(await fetch(base + '/public/survey/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: qs[0].id, value: 2 }], clientId: 'disp-a' }) }));
    ck('5. envio sem senha recusado', p.s === 400);

    // 6. Envio com senha passa
    p = await J(await fetch(base + '/public/survey/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: qs[0].id, value: 2 }], clientId: 'disp-a', password: 'rgis2026' }) }));
    ck('6. envio com senha aceito', p.s === 201 || p.s === 200, 'status ' + p.s);

    // 7. Mesmo aparelho de novo: recusado sem permitir correção
    p = await J(await fetch(base + '/public/survey/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: qs[0].id, value: 3 }], clientId: 'disp-a', password: 'rgis2026' }) }));
    ck('7. repetição barrada', p.s === 400);

    // 8. Com correção ligada, a segunda resposta substitui a primeira
    await fetch(base + '/surveys/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ allowEdit: true }) });
    p = await J(await fetch(base + '/public/survey/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: qs[0].id, value: 3 }], clientId: 'disp-a', password: 'rgis2026' }) }));
    const res1 = (await J(await fetch(base + '/results/' + id, { headers: H }))).b.data;
    ck('8. correção substitui', (p.s === 200 || p.s === 201) && res1.survey.totalResponses === 1, 'respostas ' + res1.survey.totalResponses);

    // 9. A correção vale: a nota passou de 50 para 100
    const q0 = (res1.questions || []).find(x => x.text.includes('liderança'));
    ck('9. nota recalculada', q0 && Number(q0.average) === 3, 'média ' + (q0 && q0.average));

    // 10. Embaralhar alternativas mexe em múltipla escolha, não em escala
    await fetch(base + '/surveys/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ shuffleOptions: true }) });
    let escalaIgual = true, multiMudou = false;
    for (let i = 0; i < 12; i++) {
      const d = (await J(await fetch(base + '/public/survey/' + token + '?pwd=rgis2026'))).b.data.questions;
      const esc = d.find(x => x.text.includes('liderança'));
      const mul = d.find(x => x.text.includes('motiva'));
      if (JSON.stringify(esc.options) !== JSON.stringify(['Ruim','Boa','Ótima'])) escalaIgual = false;
      if (JSON.stringify(mul.options) !== JSON.stringify(['A','B','C'])) multiMudou = true;
    }
    ck('10. escala mantém a ordem', escalaIgual);
    ck('11. múltipla escolha embaralha', multiMudou);

    // 12. Cota por distrito consome a meta da Estrutura
    const dist = await J(await fetch(base + '/org/distritos', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Distrito Cota', meta: 1 }) }));
    const distId = dist.b.data?.distrito?.id || dist.b.data?.id;
    const cr2 = await J(await fetch(base + '/surveys', { method: 'POST', headers: H, body: JSON.stringify({
      name: 'Cota F5', category: 'Clima', targetGroup: 't', anonymous: true,
      questions: [{ type: 'scale', text: 'Nota geral', options: ['Ruim','Boa'], option_points: [0,100] }] }) }));
    const id2 = cr2.b.data.survey.id;
    await fetch(base + '/surveys/' + id2 + '/publish', { method: 'POST', headers: H });
    await fetch(base + '/surveys/' + id2, { method: 'PUT', headers: H, body: JSON.stringify({ quotaEnabled: true }) });
    const tk2 = (await J(await fetch(base + '/surveys/' + id2, { headers: H }))).b.data.survey.public_token;
    const q2 = (await J(await fetch(base + '/public/survey/' + tk2))).b.data.questions[0].id;
    const envia = async (cid) => J(await fetch(base + '/public/survey/' + tk2, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: q2, value: 2 }], clientId: cid, distrito: distId }) }));
    const e1 = await envia('cota-1');
    const e2 = await envia('cota-2');
    ck('12. primeira resposta entra na cota', e1.s === 200 || e1.s === 201, 'status ' + e1.s);
    ck('13. cota cheia recusa a segunda', e2.s === 400 && /cota/i.test(e2.b.message || ''), (e2.b.message || '').slice(0, 50));

    // 14. Escopo: gestor restrito a um distrito não vê a resposta de outro
    const u = await J(await fetch(base + '/users', { method: 'POST', headers: H, body: JSON.stringify({
      name: 'Gestor Escopo', email: 'escopo.f5@empresa.com', password: 'Teste@2026!', role: 'manager' }) }));
    const uid = u.b.data?.user?.id;
    const outro = await J(await fetch(base + '/org/distritos', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Distrito Fora', meta: 0 }) }));
    const foraId = outro.b.data?.distrito?.id || outro.b.data?.id;
    await fetch(base + '/users/' + uid, { method: 'PUT', headers: H, body: JSON.stringify({ scopeDistritos: [foraId] }) });
    const lg2 = await J(await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'escopo.f5@empresa.com', password: 'Teste@2026!' }) }));
    const H2 = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (lg2.b.data?.accessToken || '') };
    const vistoAdmin  = (await J(await fetch(base + '/results/' + id2, { headers: H  }))).b.data.survey.totalResponses;
    const vistoGestor = (await J(await fetch(base + '/results/' + id2, { headers: H2 }))).b.data.survey.totalResponses;
    ck('14. admin vê a resposta', vistoAdmin === 1, 'admin ' + vistoAdmin);
    ck('15. gestor fora do escopo não vê', vistoGestor === 0, 'gestor ' + vistoGestor);

    // 16. Categoria bloqueada some da lista do gestor
    await fetch(base + '/users/' + uid, { method: 'PUT', headers: H, body: JSON.stringify({ scopeDistritos: [], blockedCategories: ['Clima'] }) });
    const lg3 = await J(await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'escopo.f5@empresa.com', password: 'Teste@2026!' }) }));
    const H3 = { 'Authorization': 'Bearer ' + (lg3.b.data?.accessToken || '') };
    const lista = (await J(await fetch(base + '/surveys', { headers: H3 }))).b.data.surveys || [];
    ck('16. categoria bloqueada some', lista.every(sv => sv.category !== 'Clima'), lista.length + ' pesquisas');
    const direto = await J(await fetch(base + '/results/' + id2, { headers: H3 }));
    ck('17. resultado da categoria bloqueada nega', direto.s === 404, 'status ' + direto.s);

  } catch (e) { fail++; console.log(' FALHA exceção: ' + e.message); }
  console.log(`\n Fase 5 · ${pass} passou · ${fail} falhou`);
  srv.close(); process.exit(fail ? 1 : 0);
});
