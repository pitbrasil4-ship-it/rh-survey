process.env.PORT='4211'; process.env.SQLITE_PATH='./test.db';
const app=require(process.cwd()+'/src/app'); const base='http://127.0.0.1:4211/api/v1';
const J=async r=>({s:r.status,b:await r.json()});
const srv=app.listen(4211,'127.0.0.1',async()=>{
 let pass=0,fail=0; const ck=(n,ok,extra='')=>{ok?pass++:fail++; console.log((ok?' ok   ':' FALHA')+' '+n+(extra?'  '+extra:''));};
 try{
  const lg=await J(await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@empresa.com',password:'Admin@2025!'})}));
  const H={'Content-Type':'application/json','Authorization':'Bearer '+lg.b.data.accessToken};
  // RESPOSTA ÚNICA
  const cr=await J(await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Única TESTE',category:'NPS',targetGroup:'t',anonymous:true,questions:[
    {type:'multiple',text:'Qual o principal ponto?',options:['Comunicação','Prazo','Qualidade'],singleChoice:true},
    {type:'multiple',text:'Quais competências?',options:['A','B','C']}
  ]})}));
  const id=cr.b.data.survey.id; await fetch(base+'/surveys/'+id+'/publish',{method:'POST',headers:H});
  const tok=(await J(await fetch(base+'/surveys/'+id,{headers:H}))).b.data.survey.public_token;
  const pq=(await J(await fetch(base+'/public/survey/'+tok))).b.data.questions;
  ck('resposta única marcada na pergunta 1', pq[0].singleChoice===true);
  ck('pergunta 2 segue múltipla', pq[1].singleChoice===false);
  // 360 completo
  const FREQ={options:['Nunca','Às vezes','Sempre'],option_points:[0,50,100]};
  const s2=await J(await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Gestores 2026',category:'Gestores',targetGroup:'t',anonymous:true,questions:[
    {type:'scale',text:'O avaliado ouve a equipe.',text_self:'Eu ouço a equipe.',...FREQ}]})}));
  const cy=await J(await fetch(base+'/eval/cycles',{method:'POST',headers:H,body:JSON.stringify({name:'Ciclo A',surveyId:s2.b.data.survey.id})}));
  const cid=cy.b.data.cycle.id;
  const rows=[{subjectName:'Ana Lima',relationship:'auto',evaluatorName:'Ana Lima'}];
  for(let i=1;i<=5;i++) rows.push({subjectName:'Ana Lima',relationship:'subordinado',evaluatorName:'Sub '+i,evaluatorEmail:`s${i}@rgis.com`});
  rows.push({subjectName:'Ana Lima',relationship:'xxx',evaluatorName:'Erro'});
  const bk=await J(await fetch(base+`/eval/cycles/${cid}/assignments/bulk`,{method:'POST',headers:H,body:JSON.stringify({rows})}));
  ck('importação em massa', bk.b.data.criados.length===6 && bk.b.data.erros.length===1, `criados ${bk.b.data.criados.length}, erros ${bk.b.data.erros.length}`);
  ck('avaliado novo cadastrado automaticamente', bk.b.data.criados[0].subjectId.length>10);
  const pend=await J(await fetch(base+`/eval/cycles/${cid}/pending`,{headers:H}));
  ck('lista de pendentes', pend.b.data.total===6, `${pend.b.data.total} pendentes`);
  // responde 2 (abaixo do mínimo)
  const resp=async(tok)=>{const q=(await J(await fetch(base+'/public/eval/'+tok))).b.data.questions;
    return fetch(base+'/public/eval/'+tok,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:q.map(qq=>({questionId:qq.id,value:3}))})});};
  const subs=bk.b.data.criados.filter(c=>c.relationship==='subordinado');
  await resp(bk.b.data.criados.find(c=>c.relationship==='auto').token);
  await resp(subs[0].token); await resp(subs[1].token);
  let r=await J(await fetch(base+'/eval/results/'+cid,{headers:H}));
  ck('abaixo do mínimo: perspectiva oculta', r.b.data.matrix[0].subordinado===null && r.b.data.matrix[0].hidden.subordinado===true);
  const sid=r.b.data.matrix[0].subjectId;
  let sr=await J(await fetch(`${base}/eval/results/${cid}/subject/${sid}`,{headers:H}));
  ck('devolutiva bloqueada abaixo do mínimo', sr.b.data.released===false, `${sr.b.data.totalResponses}/${sr.b.data.minResponses}`);
  // completa
  for(let i=2;i<5;i++) await resp(subs[i].token);
  r=await J(await fetch(base+'/eval/results/'+cid,{headers:H}));
  ck('no mínimo: perspectiva revelada', r.b.data.matrix[0].subordinado!==null, `${r.b.data.matrix[0].subordinado}%`);
  sr=await J(await fetch(`${base}/eval/results/${cid}/subject/${sid}`,{headers:H}));
  ck('devolutiva liberada', sr.b.data.released===true && sr.b.data.geral!==null, `geral ${sr.b.data.geral}%`);
  const pdf=await fetch(`${base}/eval/results/${cid}/subject/${sid}/pdf`,{headers:{'Authorization':'Bearer '+lg.b.data.accessToken}});
  const buf=Buffer.from(await pdf.arrayBuffer());
  ck('PDF da devolutiva', pdf.status===200 && buf.slice(0,5).toString()==='%PDF-', `${buf.length} bytes`);
 }catch(e){console.log('ERRO',e.message); fail++;}
 console.log(`\nTOTAL FASE 2: ${pass} passou · ${fail} falhou`);
 srv.close(()=>process.exit());
});
