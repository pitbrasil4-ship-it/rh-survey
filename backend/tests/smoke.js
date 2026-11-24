process.env.PORT='4202'; process.env.SQLITE_PATH='./test.db';
const app=require(process.cwd()+'/src/app'); const base='http://127.0.0.1:4202/api/v1';
const srv=app.listen(4202,'127.0.0.1',async()=>{
 let pass=0, fail=0;
 const check=async(nome,fn)=>{ try{ const r=await fn(); if(r) {pass++; console.log(' ok  ',nome);} else {fail++; console.log(' FALHOU',nome);} }catch(e){ fail++; console.log(' ERRO ',nome,'-',e.message); } };
 try{
  const lg=await (await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@empresa.com',password:'Admin@2025!'})})).json();
  const H={'Content-Type':'application/json','Authorization':'Bearer '+lg.data.accessToken};
  const sv=await (await fetch(base+'/surveys',{headers:H})).json();
  const id=sv.data.surveys[0].id;
  await check('login', async()=>!!lg.data.accessToken);
  await check('listar pesquisas', async()=>sv.data.surveys.length>0);
  await check('resultados', async()=>{const r=await (await fetch(base+'/results/'+id,{headers:H})).json(); return r.success && Array.isArray(r.data.questions);});
  await check('dashboard', async()=>{const r=await fetch(base+'/results/dashboard',{headers:H}); return r.status===200;});
  await check('segmentos', async()=>{const r=await fetch(base+'/results/segments?surveyId='+id,{headers:H}); return r.status===200;});
  await check('cruzamento pergunta x segmento', async()=>{const r=await fetch(base+'/results/segment-questions?surveyId='+id,{headers:H}); return r.status===200;});
  await check('PDF', async()=>{const r=await fetch(base+'/results/'+id+'/pdf',{headers:H}); const b=Buffer.from(await r.arrayBuffer()); return r.status===200 && b.slice(0,5).toString()==='%PDF-';});
  await check('insights (fallback sem IA)', async()=>{const r=await fetch(base+'/results/insights',{method:'POST',headers:H,body:JSON.stringify({surveyId:id,lang:'pt'})}); return r.status===200;});
  await check('ciclos 360', async()=>{const r=await fetch(base+'/eval/cycles',{headers:H}); return r.status===200;});
  await check('respondentes', async()=>{const r=await fetch(base+'/respondents',{headers:H}); return r.status===200;});
  await check('estrutura org', async()=>{const r=await fetch(base+'/org',{headers:H}); return r.status===200;});
  await check('usuarios', async()=>{const r=await fetch(base+'/users',{headers:H}); return r.status===200;});
  await check('lgpd', async()=>{const r=await fetch(base+'/lgpd/overview',{headers:H}); return r.status===200 || r.status===404;});
  await check('criar+publicar pesquisa', async()=>{
    const c=await (await fetch(base+'/surveys',{method:'POST',headers:H,body:JSON.stringify({name:'Smoke',category:'NPS',targetGroup:'t',anonymous:true,questions:[{type:'nps',text:'Recomenda?'}]})})).json();
    const p=await fetch(base+'/surveys/'+c.data.survey.id+'/publish',{method:'POST',headers:H}); return p.status===200;});
  await check('gerar em lote', async()=>{const r=await fetch(base+'/surveys/bulk',{method:'POST',headers:H,body:JSON.stringify({baseName:'Smoke lote',names:['A','B'],questions:[{type:'nps',text:'Recomenda?'}]})}); return r.status===201;});
 }catch(e){ console.log('ERRO GERAL', e.message); fail++; }
 console.log(`\nTOTAL: ${pass} passou · ${fail} falhou`);
 srv.close(()=>process.exit(fail?1:0));
});
