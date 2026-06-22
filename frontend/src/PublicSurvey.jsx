import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const RED = '#DC2626';
const RED_DARK = '#B91C1C';

async function pub(method, token, body) {
  const res = await fetch(`${API_URL}/api/v1/public/survey/${encodeURIComponent(token)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const e = new Error((json && json.message) || `Erro ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return (json && json.data) || json;
}

function Logo() {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ width:38, height:38, borderRadius:10, background:RED, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:800, fontSize:15 }}>RH</div>
      <div style={{ fontWeight:800, color:'#0F172A', fontSize:17, lineHeight:1 }}>RH<span style={{ color:RED }}>Survey</span><div style={{ fontSize:9, color:'#94A3B8', fontWeight:600, letterSpacing:1, marginTop:2 }}>RGIS BRASIL</div></div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight:'100vh', background:'#F1F5F9', fontFamily:'system-ui,-apple-system,sans-serif', padding:'24px 16px' }}>
      <div style={{ maxWidth:680, margin:'0 auto' }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background:'white', borderRadius:16, border:'1px solid #E2E8F0', boxShadow:'0 1px 3px rgba(0,0,0,.05)', padding:24, ...style }}>{children}</div>;
}

function NpsInput({ value, onChange }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
      {Array.from({ length:11 }).map((_, n) => (
        <button key={n} type="button" onClick={() => onChange(n)}
          style={{ width:42, height:42, borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:700,
            border: value===n ? `2px solid ${RED}` : '1px solid #E2E8F0',
            background: value===n ? RED : 'white', color: value===n ? 'white' : '#475569' }}>
          {n}
        </button>
      ))}
      <div style={{ width:'100%', display:'flex', justifyContent:'space-between', fontSize:11, color:'#94A3B8', marginTop:4 }}>
        <span>Nada provável</span><span>Muito provável</span>
      </div>
    </div>
  );
}

function ScaleInput({ options, value, onChange }) {
  // options is an array of labels; we submit the 1-based numeric position so results can average.
  const opts = (options && options.length) ? options : ['1','2','3','4','5'];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {opts.map((label, i) => {
        const num = i + 1;
        const sel = value === num;
        return (
          <button key={i} type="button" onClick={() => onChange(num)}
            style={{ textAlign:'left', padding:'12px 14px', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:600,
              border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
              background: sel ? '#FEF2F2' : 'white', color: sel ? RED_DARK : '#475569' }}>
            <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:22, height:22, borderRadius:'50%', marginRight:10, fontSize:12,
              background: sel ? RED : '#F1F5F9', color: sel ? 'white' : '#64748B' }}>{num}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function RatingInput({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:8 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:34, lineHeight:1, color: (value && n<=value) ? '#F59E0B' : '#E2E8F0', padding:0 }}>
          ★
        </button>
      ))}
    </div>
  );
}

function YesNoInput({ value, onChange }) {
  const opt = (val, label) => {
    const sel = value === val;
    return (
      <button type="button" onClick={() => onChange(val)}
        style={{ flex:1, padding:'14px', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:700,
          border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
          background: sel ? RED : 'white', color: sel ? 'white' : '#475569' }}>{label}</button>
    );
  };
  return <div style={{ display:'flex', gap:10 }}>{opt('sim','Sim')}{opt('nao','Não')}</div>;
}

function MultipleInput({ options, value, onToggle }) {
  const opts = options && options.length ? options : [];
  const arr = Array.isArray(value) ? value : [];
  if (opts.length === 0) return <p style={{ fontSize:13, color:'#94A3B8' }}>Sem opções configuradas.</p>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {opts.map((label, i) => {
        const sel = arr.includes(label);
        return (
          <button key={i} type="button" onClick={() => onToggle(label)}
            style={{ textAlign:'left', padding:'12px 14px', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:10,
              border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
              background: sel ? '#FEF2F2' : 'white', color: sel ? RED_DARK : '#475569' }}>
            <span style={{ width:18, height:18, borderRadius:5, border: sel ? `2px solid ${RED}` : '2px solid #CBD5E1', background: sel ? RED : 'white', color:'white', fontSize:12, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{sel ? '✓' : ''}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function PublicSurvey({ token }) {
  const [state, setState] = useState('loading'); // loading | ready | notfound | error | done
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await pub('GET', token);
        if (!alive) return;
        setSurvey(data.survey);
        setQuestions(data.questions || []);
        setState('ready');
      } catch (e) {
        if (!alive) return;
        setState(e.status === 404 ? 'notfound' : 'error');
        setErrMsg(e.message || '');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const setAns = (qid, value) => setAnswers(prev => ({ ...prev, [qid]: value }));
  const toggleMulti = (qid, opt) => setAnswers(prev => {
    const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
    return { ...prev, [qid]: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] };
  });

  const answeredCount = questions.filter(q => {
    const v = answers[q.id];
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;

  const submit = async () => {
    setErrMsg('');
    const payload = questions
      .map(q => ({ questionId: q.id, value: answers[q.id] }))
      .filter(a => a.value !== undefined && a.value !== '' && !(Array.isArray(a.value) && a.value.length === 0));
    if (payload.length === 0) { setErrMsg('Responda ao menos uma pergunta antes de enviar.'); return; }
    setSubmitting(true);
    try {
      await pub('POST', token, { answers: payload });
      setState('done');
    } catch (e) {
      setErrMsg(e.message || 'Erro ao enviar suas respostas. Tente novamente.');
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return <Shell><div style={{ textAlign:'center', color:'#64748B', paddingTop:80 }}>Carregando pesquisa...</div></Shell>;
  }
  if (state === 'notfound') {
    return <Shell><Card style={{ textAlign:'center' }}>
      <div style={{ fontSize:40 }}>🔒</div>
      <h2 style={{ color:'#0F172A', fontSize:18, margin:'12px 0 6px' }}>Pesquisa indisponível</h2>
      <p style={{ color:'#64748B', fontSize:14, margin:0 }}>Este link é inválido ou a pesquisa não está mais ativa. Verifique com quem o enviou.</p>
    </Card></Shell>;
  }
  if (state === 'error') {
    return <Shell><Card style={{ textAlign:'center' }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <h2 style={{ color:'#B91C1C', fontSize:18, margin:'12px 0 6px' }}>Não foi possível carregar</h2>
      <p style={{ color:'#64748B', fontSize:14, margin:'0 0 16px' }}>{errMsg || 'Tente novamente em instantes.'}</p>
      <button onClick={() => window.location.reload()} style={{ padding:'10px 18px', background:RED, color:'white', border:'none', borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:14 }}>Recarregar</button>
    </Card></Shell>;
  }
  if (state === 'done') {
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>✓</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>Resposta enviada!</h2>
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>Obrigado por participar. Sua contribuição foi registrada com segurança.</p>
        {survey && survey.anonymous ? <p style={{ color:'#16A34A', fontSize:12, marginTop:12, fontWeight:600 }}>🔒 Resposta anônima — não vinculada à sua identidade.</p> : null}
      </Card>
    </Shell>;
  }

  // ready
  return (
    <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ marginBottom:16, borderTop:`3px solid ${RED}` }}>
        <h1 style={{ color:'#0F172A', fontSize:22, margin:'0 0 6px' }}>{survey.name}</h1>
        {survey.description ? <p style={{ color:'#64748B', fontSize:14, margin:'0 0 10px' }}>{survey.description}</p> : null}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:12 }}>
          {survey.anonymous ? <span style={{ background:'#EFF6FF', color:'#2563EB', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>🔒 Anônima</span> : null}
          <span style={{ background:'#F0FDF4', color:'#16A34A', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>Protegida pela LGPD</span>
          <span style={{ background:'#F1F5F9', color:'#64748B', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{questions.length} pergunta{questions.length!==1?'s':''}</span>
        </div>
      </Card>

      {questions.map((q, idx) => (
        <Card key={q.id} style={{ marginBottom:14 }}>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <span style={{ flexShrink:0, width:24, height:24, borderRadius:'50%', background:RED, color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{idx+1}</span>
            <p style={{ margin:0, fontSize:15, fontWeight:600, color:'#1E293B', lineHeight:1.4 }}>{q.text}</p>
          </div>
          {q.type === 'nps'      && <NpsInput value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'scale'    && <ScaleInput options={q.options} value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'rating'   && <RatingInput value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'yesno'    && <YesNoInput value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'multiple' && <MultipleInput options={q.options} value={answers[q.id]} onToggle={opt => toggleMulti(q.id, opt)} />}
          {(q.type === 'text' || !['nps','scale','rating','yesno','multiple'].includes(q.type)) &&
            <textarea value={answers[q.id] || ''} onChange={e => setAns(q.id, e.target.value)} rows={4}
              placeholder="Digite sua resposta..."
              style={{ width:'100%', boxSizing:'border-box', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px', fontSize:14, fontFamily:'inherit', resize:'vertical' }} />}
        </Card>
      ))}

      {errMsg ? <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'12px 14px', fontSize:14, marginBottom:14 }}>⚠️ {errMsg}</div> : null}

      <Card style={{ position:'sticky', bottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        <span style={{ fontSize:13, color:'#64748B' }}>{answeredCount} de {questions.length} respondidas</span>
        <button onClick={submit} disabled={submitting}
          style={{ padding:'12px 24px', background: submitting ? '#FCA5A5' : RED, color:'white', border:'none', borderRadius:10, cursor: submitting ? 'default' : 'pointer', fontWeight:700, fontSize:14 }}>
          {submitting ? 'Enviando...' : 'Enviar respostas'}
        </button>
      </Card>

      <p style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:16 }}>
        Seus dados são tratados conforme a Lei nº 13.709/2018 (LGPD), exclusivamente para fins de avaliação organizacional interna.
      </p>
    </Shell>
  );
}
