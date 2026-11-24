process.env.PORT = '4240'; process.env.SQLITE_PATH = './test.db';
const app = require(process.cwd() + '/src/app'); const base = 'http://127.0.0.1:4240/api/v1';
const J = async r => ({ s: r.status, b: await r.json() });

const srv = app.listen(4240, '127.0.0.1', async () => {
  let pass = 0, fail = 0;
  const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? ' ok   ' : ' FALHA') + ' ' + n + (x ? '  ' + x : '')); };
  try {
    const lg = await J(await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@empresa.com', password: 'Admin@2025!' }) }));
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lg.b.data.accessToken };
    const ESC = ['Discordo', 'Neutro', 'Concordo'], PTS = [0, 50, 100];

    const cr = await J(await fetch(base + '/surveys', { method: 'POST', headers: H, body: JSON.stringify({
      name: 'Tipos novos', category: 'Clima', targetGroup: 't', anonymous: true, questions: [
        { type: 'matrix',   text: 'Avalie os itens abaixo:', options: ESC, option_points: PTS, rows: ['Comunicação', 'Liderança', 'Reconhecimento'] },
        { type: 'dropdown', text: 'Qual seu turno?', options: ['Manhã', 'Tarde', 'Noite'] },
        { type: 'enps',     text: 'Recomendaria a empresa como lugar para trabalhar?' },
        { type: 'ranking',  text: 'Ordene por prioridade:', options: ['Salário', 'Carreira', 'Clima', 'Benefícios'] },
        { type: 'scale',    text: 'Escala com neutra marcada', options: ['Ruim', 'Não sei dizer', 'Bom'], option_points: [0, 50, 100], neutralIdx: [1] },
      ] }) }));
    const id = cr.b.data.survey.id;
    await fetch(base + '/surveys/' + id + '/publish', { method: 'POST', headers: H });
    const tok = (await J(await fetch(base + '/surveys/' + id, { headers: H }))).b.data.survey.public_token;
    const PQ = (await J(await fetch(base + '/public/survey/' + tok))).b.data.questions;

    ck('matriz expõe as linhas no formulário', Array.isArray(PQ[0].rows) && PQ[0].rows.length === 3, JSON.stringify(PQ[0].rows));
    ck('neutra marcada chega ao formulário', JSON.stringify(PQ[4].neutralIdx) === '[1]');

    const send = (vals, cid) => fetch(base + '/public/survey/' + tok, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: PQ.map((q, i) => ({ questionId: q.id, value: vals[i] })), clientId: cid }) });

    await send([{ 'Comunicação': 3, 'Liderança': 1, 'Reconhecimento': 2 }, 'Manhã', 9, ['Salário', 'Carreira', 'Clima', 'Benefícios'], 3], 'n1');
    await send([{ 'Comunicação': 3, 'Liderança': 3, 'Reconhecimento': 3 }, 'Noite', 10, ['Carreira', 'Salário', 'Clima', 'Benefícios'], 2], 'n2');

    const r = await J(await fetch(base + '/results/' + id, { headers: H }));
    const [qm, qd, qe, qr, qs] = r.b.data.questions;

    ck('matriz guardou o objeto (não "[object Object]")', qm.rows && qm.rows.length === 3 && qm.rows[0].responses === 2);
    const lid = qm.rows.find(x => x.text === 'Liderança');
    ck('matriz calcula por linha', lid && lid.average === 2 && lid.scorePct === 50, `Liderança média ${lid && lid.average}, ${lid && lid.scorePct}%`);
    ck('matriz traz distribuição por linha', lid && lid.choices.length === 3);

    ck('lista suspensa conta as escolhas', (qd.choices || []).find(c => c.label === 'Manhã').count === 1, JSON.stringify((qd.choices || []).map(c => c.label + ':' + c.count)));
    ck('eNPS calculado como NPS', qe.nps != null, `NPS ${qe.nps}`);

    const sal = (qr.ranking || []).find(x => x.label === 'Salário');
    ck('ordenação calcula a posição média', sal && sal.avgPosition === 1.5, `Salário posição média ${sal && sal.avgPosition}`);
    ck('ordenação ordena pela prioridade', qr.ranking[0].avgPosition <= qr.ranking[1].avgPosition);

    ck('neutra marcada sai da média', qs.average === 3 && qs.scoredCount === 1, `média ${qs.average} com ${qs.scoredCount} de ${qs.responseCount}`);

    // o % atingido geral deve considerar matriz, lista, eNPS e ordenação
    ck('média geral considera os novos tipos', r.b.data.overallScore != null, `${r.b.data.overallScore}%`);

    // PDF não pode quebrar com os tipos novos
    const pdf = await fetch(base + '/results/' + id + '/pdf', { headers: { Authorization: 'Bearer ' + lg.b.data.accessToken } });
    const buf = Buffer.from(await pdf.arrayBuffer());
    ck('PDF gera com os tipos novos', pdf.status === 200 && buf.slice(0, 5).toString() === '%PDF-', `${buf.length} bytes`);
  } catch (e) { console.log('ERRO', e.message); fail++; }
  console.log(`\nTOTAL FASE 4B: ${pass} passou · ${fail} falhou`);
  srv.close(() => process.exit());
});
