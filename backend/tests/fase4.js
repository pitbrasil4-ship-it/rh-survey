process.env.PORT='4230'; process.env.SQLITE_PATH='./test.db';
const app=require(process.cwd()+'/src/app'); const base='http://127.0.0.1:4230/api/v1';
const J=async r=>({s:r.status,b:await r.json()});
const srv=app.listen(4230,'127.0.0.1',async()=>{
 let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++; console.log((ok?' ok   ':' FALHA')+' '+n+(x?'  '+x:''));};
 try{
  const lg=await J(await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@empresa.com',password:'Admin@2025!'})}));
  const H={'Content-Type':'application/json','Authorization':'Bearer '+lg.b.data.accessToken};
  const ESC={options:['Discordo','Neutro','Concordo'],option_points:[0,50,100]};
  const cr=await J(await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Clima V1',category:'Clima',targetGroup:'t',anonymous:true,questions:[
    {type:'scale',text:'Sinto orgulho da empresa.',...ESC,dimensoes:{clima:['Orgulho']}},
    {type:'scale',text:'Meu gestor me apoia.',...ESC},
    {type:'text',text:'Deixe um comentário.'},
  ]})}));
  const id=cr.b.data.survey.id; await fetch(base+'/surveys/'+id+'/publish',{method:'POST',headers:H});
  const one=async()=>(await J(await fetch(base+'/surveys/'+id,{headers:H}))).b.data;
  let d=await one(); const qs=d.questions;
  ck('pesquisa começa na versão 1', (d.survey.version||1)===1);

  // ── edição SEM respostas: entra direto
  const e1=await J(await fetch(base+`/surveys/${id}/questions`,{method:'PUT',headers:H,body:JSON.stringify({questions:[
    {id:qs[0].id,type:'scale',text:'Sinto orgulho de trabalhar aqui.',...ESC},
    {id:qs[1].id,type:'scale',text:'Meu gestor me apoia.',...ESC},
    {id:qs[2].id,type:'text',text:'Deixe um comentário.'},
  ]})}));
  ck('edita sem respostas sem pedir confirmação', e1.s===200 && !e1.b.data.precisaConfirmar, `versão ${e1.b.data.versao}`);

  // ── responde
  const tok=(await one()).survey.public_token;
  const PQ=(await J(await fetch(base+'/public/survey/'+tok))).b.data.questions;
  const send=(vals,cid)=>fetch(base+'/public/survey/'+tok,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:PQ.map((q,i)=>({questionId:q.id,value:vals[i]})),clientId:cid})});
  await send([3,3,'Tudo certo'],'nav1'); await send([2,3,'Pode melhorar'],'nav2');

  // ── correção de digitação COM respostas: segura, entra direto
  d=await one();
  const e2=await J(await fetch(base+`/surveys/${id}/questions`,{method:'PUT',headers:H,body:JSON.stringify({questions:d.questions.map(q=>
    q.id===d.questions[1].id ? {id:q.id,type:q.type,text:'Meu gestor me dá apoio.',options:q.options,option_points:q.option_points} : {id:q.id,type:q.type,text:q.text,options:q.options,option_points:q.option_points})})}));
  ck('corrigir texto com respostas é seguro', e2.s===200 && !e2.b.data.precisaConfirmar && e2.b.data.versao===1, `versão ${e2.b.data.versao}`);

  // ── alterar ALTERNATIVAS com respostas: exige confirmação
  d=await one();
  const quebra = d.questions.map(q => q.id===d.questions[0].id
    ? {id:q.id,type:'scale',text:q.text,options:['Nunca','Às vezes','Sempre','Não se Aplica'],option_points:[0,50,100,0]}
    : {id:q.id,type:q.type,text:q.text,options:q.options,option_points:q.option_points});
  const e3=await J(await fetch(base+`/surveys/${id}/questions`,{method:'PUT',headers:H,body:JSON.stringify({questions:quebra})}));
  ck('alterar alternativas pede confirmação', e3.b.data.precisaConfirmar===true, `${e3.b.data.quebras.length} quebra(s), ${e3.b.data.respostas} respostas`);
  ck('aponta o motivo da quebra', e3.b.data.quebras.some(q=>q.tipo==='alternativas_alteradas'));
  const antes=(await one()).questions[0].options;
  const e4=await J(await fetch(base+`/surveys/${id}/questions`,{method:'PUT',headers:H,body:JSON.stringify({questions:quebra,confirm:true})}));
  ck('com confirmação sobe a versão', e4.s===200 && e4.b.data.versao===2, `versão ${e4.b.data.versao}`);
  d=await one();
  ck('alternativas realmente mudaram', JSON.stringify(d.questions[0].options)!==JSON.stringify(antes), JSON.stringify(d.questions[0].options));

  // ── histórico e versão guardada
  const h=await J(await fetch(base+`/surveys/${id}/history`,{headers:H}));
  ck('histórico registra as edições', h.b.data.changes.length>=3, `${h.b.data.changes.length} registros`);
  ck('questionário anterior guardado', h.b.data.versions.length===1, `${h.b.data.versions.length} versão(ões) arquivada(s)`);

  // ── respostas antigas carimbadas com a versão
  const r=await J(await fetch(base+'/results/'+id,{headers:H}));
  ck('respostas antigas preservadas', r.b.data.questions[0].responseCount===2, `${r.b.data.questions[0].responseCount} respostas`);

  // ── duplicar
  const dup=await J(await fetch(base+`/surveys/${id}/duplicate`,{method:'POST',headers:H,body:JSON.stringify({})}));
  ck('duplicar cria rascunho', dup.s===201 && dup.b.data.survey.status==='rascunho', dup.b.data.survey.name);
  const dupQ=(await J(await fetch(base+'/surveys/'+dup.b.data.survey.id,{headers:H}))).b.data.questions;
  ck('cópia leva as perguntas', dupQ.length===3);
  const dupDim=await J(await fetch(base+'/dimensoes/survey/'+dup.b.data.survey.id,{headers:H}));
  ck('cópia leva as dimensões', Object.keys(dupDim.b.data.porPergunta).length>=1);
 }catch(e){console.log('ERRO',e.message); fail++;}
 console.log(`\nTOTAL FASE 4: ${pass} passou · ${fail} falhou`);
 srv.close(()=>process.exit());
});
