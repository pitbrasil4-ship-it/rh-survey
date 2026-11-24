process.env.PORT='4220'; process.env.SQLITE_PATH='./test.db';
const app=require(process.cwd()+'/src/app'); const base='http://127.0.0.1:4220/api/v1';
const J=async r=>({s:r.status,b:await r.json()});
const srv=app.listen(4220,'127.0.0.1',async()=>{
 let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++; console.log((ok?' ok   ':' FALHA')+' '+n+(x?'  '+x:''));};
 try{
  const lg=await J(await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@empresa.com',password:'Admin@2025!'})}));
  const H={'Content-Type':'application/json','Authorization':'Bearer '+lg.b.data.accessToken};
  const ESC={options:['Discordo','Neutro','Concordo'],option_points:[0,50,100]};
  // pesquisa com dimensões nas duas taxonomias; Q3 em DUAS dimensões de clima
  const cr=await J(await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Clima 2026',category:'Clima',targetGroup:'t',anonymous:true,questions:[
    {type:'scale',text:'Sinto orgulho da empresa.',...ESC,dimensoes:{clima:['Orgulho'],hse:['Clareza de papel']}},
    {type:'scale',text:'Meu gestor me apoia.',...ESC,dimensoes:{clima:['Liderança'],hse:['Apoio da chefia']}},
    {type:'scale',text:'Tenho autonomia.',...ESC,dimensoes:{clima:['Autonomia','Liderança'],hse:['Controle']}},
  ]})}));
  const id=cr.b.data.survey.id; await fetch(base+'/surveys/'+id+'/publish',{method:'POST',headers:H});
  const dl=await J(await fetch(base+'/dimensoes',{headers:H}));
  ck('dimensões criadas na importação', dl.b.data.clima.length===3 && dl.b.data.hse.length===3, `clima ${dl.b.data.clima.length}, hse ${dl.b.data.hse.length}`);
  const lid=dl.b.data.clima.find(d=>d.name==='Liderança');
  ck('pergunta em duas dimensões', lid && lid.perguntas===2, `Liderança tem ${lid?lid.perguntas:0} perguntas`);
  // respostas com modalidade e distrito
  const tok=(await J(await fetch(base+'/surveys/'+id,{headers:H}))).b.data.survey.public_token;
  const Q=(await J(await fetch(base+'/public/survey/'+tok))).b.data.questions;
  const send=(vals,cid,mod)=>fetch(base+'/public/survey/'+tok,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:Q.map((q,i)=>({questionId:q.id,value:vals[i]})),clientId:cid,modalidade:mod})});
  await send([3,3,3],'n1','Mensalista'); await send([3,2,3],'n2','Mensalista'); await send([1,1,2],'n3','Horista');
  const dr=await J(await fetch(base+'/results/dimensoes?surveyId='+id,{headers:H}));
  ck('resultado por dimensão (clima)', (dr.b.data.clima||[]).length===3);
  ck('resultado por dimensão (hse)', (dr.b.data.hse||[]).length===3);
  const org=(dr.b.data.clima||[]).find(d=>d.name==='Orgulho');
  ck('favorabilidade calculada', org && org.favPct!=null, `Orgulho ${org?org.scorePct:'-'}% atingido, ${org?org.favPct:'-'}% favorável`);
  const drm=await J(await fetch(base+'/results/dimensoes?surveyId='+id+'&modalidade=Horista',{headers:H}));
  const orgH=(drm.b.data.clima||[]).find(d=>d.name==='Orgulho');
  ck('recorte por modalidade', orgH && orgH.responses===1 && orgH.scorePct!==org.scorePct, `Horista: ${orgH?orgH.scorePct:'-'}% vs geral ${org.scorePct}%`);
  // cadastro HSE padrão
  const hs=await J(await fetch(base+'/dimensoes/hse-padrao',{method:'POST',headers:H}));
  const dl2=await J(await fetch(base+'/dimensoes',{headers:H}));
  ck('padrão HSE carregado (7 dimensões)', dl2.b.data.hse.length===7, `${dl2.b.data.hse.length} dimensões HSE`);
  const bs=await J(await fetch(base+'/dimensoes/survey/'+id,{headers:H}));
  ck('vínculo pergunta→dimensão exposto', Object.keys(bs.b.data.porPergunta).length===3);
 }catch(e){console.log('ERRO',e.message); fail++;}
 console.log(`\nTOTAL FASE 3: ${pass} passou · ${fail} falhou`);
 srv.close(()=>process.exit());
});
