process.env.PORT='4200'; process.env.SQLITE_PATH='./test.db';
const app=require(process.cwd()+'/src/app'); const base='http://127.0.0.1:4200/api/v1';
const J=async r=>({s:r.status,b:await r.json()});
const srv=app.listen(4200,'127.0.0.1',async()=>{
 try{
  const lg=await J(await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@empresa.com',password:'Admin@2025!'})}));
  const H={'Content-Type':'application/json','Authorization':'Bearer '+lg.b.data.accessToken};
  // pergunta igual à Q26 da Carina: escala com "Não se Aplica" na última posição
  const cr=await J(await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Clima TESTE',category:'Clima',targetGroup:'todos',anonymous:true,questions:[
    {type:'scale',text:'Recebo apoio quando preciso.',options:['Discordo totalmente','Discordo','Neutro','Concordo','Não se Aplica'],option_points:[0,25,50,75,0]}
  ]})}));
  const id=cr.b.data.survey.id; await fetch(base+'/surveys/'+id+'/publish',{method:'POST',headers:H});
  const token=(await J(await fetch(base+'/surveys/'+id,{headers:H}))).b.data.survey.public_token;
  const Q=(await J(await fetch(base+'/public/survey/'+token))).b.data.questions;
  const qid=Q[0].id;
  const send=(v,cid,extra={})=>fetch(base+'/public/survey/'+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answers:[{questionId:qid,value:v}],clientId:cid,...extra})});
  // F1: respostas 1, 4 e "Não se Aplica"(5) — o caso do relatório
  await send(1,'nav-A'); await send(4,'nav-B'); await send(5,'nav-C');
  const rr=await J(await fetch(base+'/results/'+id,{headers:H}));
  const q=rr.b.data.questions[0];
  console.log('F1 média  :', q.average, '(ANTES 3.33 · esperado 2.5)');
  console.log('F1 base   :', q.scoredCount, 'de', q.responseCount, 'respostas entram na média');
  console.log('F1 favor. :', JSON.stringify(q.favorability));
  console.log('F5 rótulos:', (q.choices||[]).map(c=>`${c.label}=${c.count}(${c.pct}%)${c.neutral?' [neutra]':''}`).join(' · '));
  // D6: mesmo navegador tentando de novo
  const dup=await J(await send(2,'nav-A'));
  console.log('D6 repetir no mesmo navegador -> status', dup.s, '|', dup.b.message);
  const outro=await J(await send(2,'nav-D'));
  console.log('D6 outro navegador            -> status', outro.s, '(deve passar: 201)');
  const rr2=await J(await fetch(base+'/results/'+id,{headers:H}));
  console.log('D6 total de respostas:', rr2.b.data.questions[0].responseCount, '(3 + 1 novo = 4, a repetida foi recusada)');
 }catch(e){console.log('ERRO',e.message,e.stack);}
 srv.close(()=>process.exit());
});
