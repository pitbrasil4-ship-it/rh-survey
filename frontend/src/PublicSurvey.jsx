import React, { useState, useEffect } from 'react';
import { LANGS, t, storeLang } from './i18n.js';
import { perguntaVisivel, montarPaginas, proximaPagina, paginaTemConteudo } from './logic.js';
import LogoMark from './LogoMark.jsx';

function initialLang() {
  try { const s = localStorage.getItem('rh_lang'); if (LANGS.some(l => l.code === s)) return s; } catch {}
  const n = (typeof navigator !== 'undefined' ? navigator.language : '' || '').toLowerCase();
  if (n.startsWith('en')) return 'en';
  if (n.startsWith('es')) return 'es';
  return 'pt';
}

function LangPicker({ lang, setLang }) {
  return (
    <div style={{ display:'flex', justifyContent:'flex-end', gap:6, marginBottom:12 }}>
      {LANGS.map(l => (
        <button key={l.code} type="button" onClick={() => setLang(l.code)}
          style={{ padding:'5px 11px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer',
            border: lang===l.code ? `2px solid ${RED}` : '1px solid #E2E8F0',
            background: lang===l.code ? '#FEF2F2' : 'white', color: lang===l.code ? RED_DARK : '#64748B' }}>
          {l.short}
        </button>
      ))}
    </div>
  );
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const RED = '#DC2626';
const RED_DARK = '#B91C1C';

/* Identificador deste navegador — base da trava de uma resposta por dispositivo.
   Não identifica a pessoa: é um número aleatório guardado só neste aparelho. */
function clientId() {
  try {
    let id = localStorage.getItem('rh_client_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem('rh_client_id', id);
    }
    return id;
  } catch { return null; }
}
const answeredKey = (token) => 'rh_answered_' + token;
function alreadyAnswered(token) {
  try { return !!localStorage.getItem(answeredKey(token)); } catch { return false; }
}
function markAnswered(token) {
  try { localStorage.setItem(answeredKey(token), new Date().toISOString()); } catch {}
}

/* Segmento vindo no endereço: ?distrito=Manaus&departamento=Opera%C3%A7%C3%B5es */
function segmentFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    const get = (...keys) => { for (const k of keys) { const v = q.get(k); if (v && v.trim()) return v.trim(); } return null; };
    return { distrito: get('distrito', 'd'), departamento: get('departamento', 'dep'), modalidade: get('modalidade', 'mod') };
  } catch { return { distrito: null, departamento: null, modalidade: null }; }
}

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
      <LogoMark size={38} />
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

function NpsInput({ value, onChange, tr }) {
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
        <span>{tr('nps_low')}</span><span>{tr('nps_high')}</span>
      </div>
    </div>
  );
}

function ScaleInput({ options, labels, value, onChange }) {
  // options is an array of labels; we submit the 1-based numeric position so results can average.
  const opts = (options && options.length) ? options : ['1','2','3','4','5'];
  const lab = (labels && labels.length === opts.length) ? labels : opts;
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
            {lab[i]}
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

function YesNoInput({ value, onChange, tr }) {
  const opt = (val, label) => {
    const sel = value === val;
    return (
      <button type="button" onClick={() => onChange(val)}
        style={{ flex:1, padding:'14px', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:700,
          border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
          background: sel ? RED : 'white', color: sel ? 'white' : '#475569' }}>{label}</button>
    );
  };
  return <div style={{ display:'flex', gap:10 }}>{opt('sim', tr('yes'))}{opt('nao', tr('no'))}</div>;
}


/* Matriz: várias afirmações na mesma escala. Cada linha guarda a posição marcada. */
function MatrixInput({ rows, options, value, onChange }) {
  const marcado = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const linhas = Array.isArray(rows) ? rows : [];
  const opts = Array.isArray(options) ? options : [];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {linhas.map((linha, li) => {
        const nome = typeof linha === 'string' ? linha : (linha && linha.text) || '';
        return (
          <div key={li}>
            <div style={{ fontSize:14, color:'#334155', marginBottom:6, fontWeight:600 }}>{nome}</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {opts.map((label, oi) => {
                const sel = marcado[nome] === oi + 1;
                return (
                  <button key={oi} type="button" onClick={() => onChange({ ...marcado, [nome]: oi + 1 })}
                    style={{ flex:'1 1 90px', minWidth:90, padding:'9px 10px', borderRadius:9, cursor:'pointer', fontSize:13, fontWeight:600,
                      border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
                      background: sel ? '#FEF2F2' : 'white', color: sel ? RED_DARK : '#475569' }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Lista suspensa: uma escolha só, em formato compacto. */
function DropdownInput({ options, value, onChange, tr }) {
  const opts = Array.isArray(options) ? options : [];
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      style={{ width:'100%', boxSizing:'border-box', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px', fontSize:14, background:'white', color:'#334155' }}>
      <option value="">{tr('select_placeholder')}</option>
      {opts.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  );
}

/* Ordenação: a pessoa sobe e desce as alternativas até a ordem desejada. */
function RankingInput({ options, value, onChange, tr }) {
  const base = Array.isArray(options) ? options : [];
  const ordem = (Array.isArray(value) && value.length === base.length) ? value : base;
  const mover = (i, d) => {
    const alvo = i + d; if (alvo < 0 || alvo >= ordem.length) return;
    const nova = [...ordem]; const tmp = nova[i]; nova[i] = nova[alvo]; nova[alvo] = tmp;
    onChange(nova);
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ fontSize:12, color:'#94A3B8', marginBottom:2 }}>{tr('ranking_hint')}</div>
      {ordem.map((o, i) => (
        <div key={o} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid #E2E8F0', borderRadius:10, background:'white' }}>
          <span style={{ width:22, height:22, borderRadius:'50%', background:RED, color:'white', fontSize:12, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i + 1}</span>
          <span style={{ flex:1, fontSize:14, color:'#334155' }}>{o}</span>
          <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
            style={{ padding:'4px 9px', border:'1px solid #E2E8F0', borderRadius:7, background:'white', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1, fontSize:13 }}>↑</button>
          <button type="button" onClick={() => mover(i, 1)} disabled={i === ordem.length - 1}
            style={{ padding:'4px 9px', border:'1px solid #E2E8F0', borderRadius:7, background:'white', cursor: i === ordem.length - 1 ? 'default' : 'pointer', opacity: i === ordem.length - 1 ? 0.35 : 1, fontSize:13 }}>↓</button>
        </div>
      ))}
    </div>
  );
}

function MultipleInput({ options, labels, value, onToggle, tr, single }) {
  const opts = options && options.length ? options : [];
  const lab = (labels && labels.length === opts.length) ? labels : opts;
  const arr = Array.isArray(value) ? value : [];
  if (opts.length === 0) return <p style={{ fontSize:13, color:'#94A3B8' }}>{tr('no_options')}</p>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {opts.map((label, i) => {
        const sel = arr.includes(label);
        return (
          <button key={i} type="button" onClick={() => onToggle(label)}
            style={{ textAlign:'left', padding:'12px 14px', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:600, display:'flex', alignItems:'center', gap:10,
              border: sel ? `2px solid ${RED}` : '1px solid #E2E8F0',
              background: sel ? '#FEF2F2' : 'white', color: sel ? RED_DARK : '#475569' }}>
            <span style={{ width:18, height:18, borderRadius: single ? '50%' : 5, border: sel ? `2px solid ${RED}` : '2px solid #CBD5E1', background: sel ? RED : 'white', color:'white', fontSize:12, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{sel ? (single ? '●' : '✓') : ''}</span>
            {lab[i]}
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
  const [pageIdx, setPageIdx] = useState(0);
  const [trilha, setTrilha]   = useState([]);   // páginas já percorridas, para o Voltar respeitar os saltos
  const [errMsg, setErrMsg] = useState('');
  const [lang, setLang] = useState(initialLang);
  const tr = (k, v) => t(lang, k, v);
  const changeLang = (l) => { setLang(l); storeLang(l); };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await pub('GET', token);
        if (!alive) return;
        if (data.closed) { setSurvey(data.survey); setState('closed'); return; }
        setSurvey(data.survey);
        setQuestions(data.questions || []);
        // Uma resposta por navegador: se este aparelho já respondeu, não abre o formulário de novo.
        if (alreadyAnswered(token)) { setState('answered'); return; }
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
  const toggleMulti = (qid, opt, single) => setAnswers(prev => {
    const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
    if (single) return { ...prev, [qid]: cur.includes(opt) ? [] : [opt] };   // resposta única
    return { ...prev, [qid]: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] };
  });

  const answeredCount = questions.filter(q => {
    const v = answers[q.id];
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;

  const porId   = Object.fromEntries((questions || []).map(q => [q.id, q]));
  const paginas = montarPaginas(questions || []);
  const pagina  = paginas[Math.min(pageIdx, paginas.length - 1)] || [];
  const visiveisDaPagina = pagina.filter(q => perguntaVisivel(q, answers, porId));
  const ultimaPagina = (() => {
    // É a última se não houver página seguinte com conteúdo visível.
    for (let i = pageIdx + 1; i < paginas.length; i++) if (paginaTemConteudo(paginas[i], answers, porId)) return false;
    return true;
  })();

  const avancar = () => {
    const salto = proximaPagina(pagina, answers, porId);
    let alvo = salto != null ? salto : pageIdx + 1;
    // Pula páginas que ficaram sem nenhuma pergunta visível.
    while (alvo < paginas.length && !paginaTemConteudo(paginas[alvo], answers, porId)) alvo++;
    if (alvo >= paginas.length) return;
    setTrilha(t2 => [...t2, pageIdx]);
    setPageIdx(alvo);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  };
  const voltar = () => {
    setTrilha(t2 => {
      const copia = [...t2];
      const anterior = copia.pop();
      setPageIdx(anterior != null ? anterior : Math.max(0, pageIdx - 1));
      return copia;
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  };

  const submit = async () => {
    setErrMsg('');
    const payload = questions
      .filter(q => perguntaVisivel(q, answers, porId))
      .map(q => ({ questionId: q.id, value: answers[q.id] }))
      .filter(a => a.value !== undefined && a.value !== '' && !(Array.isArray(a.value) && a.value.length === 0) && !(a.value !== null && typeof a.value === 'object' && !Array.isArray(a.value) && Object.keys(a.value).length === 0));
    if (payload.length === 0) { setErrMsg(tr('at_least_one')); return; }
    setSubmitting(true);
    try {
      const seg = segmentFromUrl();
      await pub('POST', token, { answers: payload, clientId: clientId(), distrito: seg.distrito, departamento: seg.departamento, modalidade: seg.modalidade });
      markAnswered(token);
      setState('done');
    } catch (e) {
      setErrMsg(e.message || tr('submit_error'));
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return <Shell><div style={{ textAlign:'center', color:'#64748B', paddingTop:80 }}>{tr('loading_survey')}</div></Shell>;
  }
  if (state === 'notfound') {
    return <Shell><LangPicker lang={lang} setLang={changeLang} /><Card style={{ textAlign:'center' }}>
      <div style={{ fontSize:40 }}>🔒</div>
      <h2 style={{ color:'#0F172A', fontSize:18, margin:'12px 0 6px' }}>{tr('unavailable_title')}</h2>
      <p style={{ color:'#64748B', fontSize:14, margin:0 }}>{tr('unavailable_body')}</p>
    </Card></Shell>;
  }
  if (state === 'error') {
    return <Shell><LangPicker lang={lang} setLang={changeLang} /><Card style={{ textAlign:'center' }}>
      <div style={{ fontSize:40 }}>⚠️</div>
      <h2 style={{ color:'#B91C1C', fontSize:18, margin:'12px 0 6px' }}>{tr('load_error_title')}</h2>
      <p style={{ color:'#64748B', fontSize:14, margin:'0 0 16px' }}>{errMsg || tr('try_again_short')}</p>
      <button onClick={() => window.location.reload()} style={{ padding:'10px 18px', background:RED, color:'white', border:'none', borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:14 }}>{tr('reload')}</button>
    </Card></Shell>;
  }
  if (state === 'done') {
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>✓</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>{tr('done_title')}</h2>
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>{tr('done_body')}</p>
        {survey && survey.anonymous ? <p style={{ color:'#16A34A', fontSize:12, marginTop:12, fontWeight:600 }}>{tr('anon_note')}</p> : null}
      </Card>
    </Shell>;
  }

  if (state === 'answered') {
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>✓</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>{tr('already_title')}</h2>
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>{tr('already_body')}</p>
      </Card>
    </Shell>;
  }

  if (state === 'closed') {
    const nm = (lang !== 'pt' && survey && survey['name_'+lang]) ? survey['name_'+lang] : (survey && survey.name);
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#FEE2E2', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>🔒</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>{tr('survey_closed_title')}</h2>
        {nm ? <p style={{ color:'#334155', fontSize:14, fontWeight:600, margin:'0 0 6px' }}>{nm}</p> : null}
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>{tr('survey_closed_body')}</p>
      </Card>
    </Shell>;
  }

  // ready
  return (
    <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <LangPicker lang={lang} setLang={changeLang} />
      <Card style={{ marginBottom:16, borderTop:`3px solid ${RED}` }}>
        <h1 style={{ color:'#0F172A', fontSize:22, margin:'0 0 6px' }}>{(lang !== 'pt' && survey['name_'+lang]) ? survey['name_'+lang] : survey.name}</h1>
        {survey.description ? <p style={{ color:'#64748B', fontSize:14, margin:'0 0 10px' }}>{(lang !== 'pt' && survey['description_'+lang]) ? survey['description_'+lang] : survey.description}</p> : null}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:12 }}>
          {survey.anonymous ? <span style={{ background:'#EFF6FF', color:'#2563EB', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('anon_badge')}</span> : null}
          <span style={{ background:'#F0FDF4', color:'#16A34A', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('lgpd_badge')}</span>
          <span style={{ background:'#F1F5F9', color:'#64748B', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{questions.length} {questions.length!==1 ? tr('q_many') : tr('q_one')}</span>
        </div>
      </Card>

      {paginas.length > 1 && (
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#64748B', marginBottom:6 }}>
            <span>{tr('page_of', { a: pageIdx + 1, b: paginas.length })}</span>
            <span>{tr('answered_of', { a: answeredCount, b: questions.length })}</span>
          </div>
          <div style={{ height:6, background:'#E2E8F0', borderRadius:99, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${Math.round(((pageIdx + 1) / paginas.length) * 100)}%`, background:RED, borderRadius:99, transition:'width .25s ease' }} />
          </div>
        </div>
      )}

      {visiveisDaPagina.map((q, idx) => {
        const hasOpts = Array.isArray(q.options) && q.options.length > 0;
        const optsLabels = (lang !== 'pt' && Array.isArray(q['options_'+lang]) && q['options_'+lang].length === (q.options || []).length) ? q['options_'+lang] : q.options;
        const specialized = q.type === 'nps' || q.type === 'enps' || q.type === 'scale' || q.type === 'rating' || q.type === 'yesno' || q.type === 'matrix' || q.type === 'dropdown' || q.type === 'ranking' || (q.type === 'multiple' && hasOpts);
        return (
        <Card key={q.id} style={{ marginBottom:14 }}>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <span style={{ flexShrink:0, width:24, height:24, borderRadius:'50%', background:RED, color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{idx+1}</span>
            <p style={{ margin:0, fontSize:15, fontWeight:600, color:'#1E293B', lineHeight:1.4 }}>{(lang !== 'pt' && q['text_'+lang]) ? q['text_'+lang] : q.text}</p>
          </div>
          {(q.type === 'nps' || q.type === 'enps') && <NpsInput value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'matrix'   && <MatrixInput rows={q.rows} options={q.options} value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'dropdown' && <DropdownInput options={q.options} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'ranking'  && <RankingInput options={q.options} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'scale'    && <ScaleInput options={q.options} labels={optsLabels} value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'rating'   && <RatingInput value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'yesno'    && <YesNoInput value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'multiple' && hasOpts && <MultipleInput options={q.options} labels={optsLabels} value={answers[q.id]} single={!!q.singleChoice} onToggle={opt => toggleMulti(q.id, opt, !!q.singleChoice)} tr={tr} />}
          {!specialized &&
            <textarea value={answers[q.id] || ''} onChange={e => setAns(q.id, e.target.value)} rows={4}
              placeholder={tr('answer_placeholder')}
              style={{ width:'100%', boxSizing:'border-box', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px', fontSize:14, fontFamily:'inherit', resize:'vertical' }} />}
        </Card>
        );
      })}

      {errMsg ? <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'12px 14px', fontSize:14, marginBottom:14 }}>⚠️ {errMsg}</div> : null}

      <Card style={{ position:'sticky', bottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
        {(pageIdx > 0 || trilha.length > 0) ? (
          <button onClick={voltar} disabled={submitting}
            style={{ padding:'12px 20px', background:'white', color:'#475569', border:'1px solid #E2E8F0', borderRadius:10, cursor:'pointer', fontWeight:600, fontSize:14 }}>
            ← {tr('back')}
          </button>
        ) : (
          <span style={{ fontSize:13, color:'#64748B' }}>{paginas.length > 1 ? '' : tr('answered_of', { a: answeredCount, b: questions.length })}</span>
        )}
        {ultimaPagina ? (
          <button onClick={submit} disabled={submitting}
            style={{ padding:'12px 24px', background: submitting ? '#FCA5A5' : RED, color:'white', border:'none', borderRadius:10, cursor: submitting ? 'default' : 'pointer', fontWeight:700, fontSize:14 }}>
            {submitting ? tr('sending') : tr('submit_answers')}
          </button>
        ) : (
          <button onClick={avancar}
            style={{ padding:'12px 24px', background:RED, color:'white', border:'none', borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:14 }}>
            {tr('continue')} →
          </button>
        )}
      </Card>

      <p style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:16 }}>
        {tr('lgpd_footer')}
      </p>
    </Shell>
  );
}
