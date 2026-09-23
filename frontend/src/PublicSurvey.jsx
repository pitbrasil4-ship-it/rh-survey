import React, { useState, useEffect } from 'react';
import { LANGS, t, storeLang } from './i18n.js';
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

/* Variáveis que vieram no link (distrito, regional, departamento, modalidade).
   São repassadas ao servidor, que as resolve de novo contra o cadastro. */
function linkVarsFromURL() {
  try {
    const q = new URLSearchParams(window.location.search);
    const out = {};
    ['distrito', 'regional', 'departamento', 'modalidade'].forEach(k => {
      const v = q.get(k); if (v) out[k] = v;
    });
    return out;
  } catch { return {}; }
}

async function pub(method, token, body, password) {
  const qs = new URLSearchParams(linkVarsFromURL());
  if (password) qs.set('password', password);
  // Na abertura o dispositivo vai junto: é por ele que o servidor reencontra uma
  // resposta anterior para corrigir, quando a pesquisa permite.
  if (method === 'GET') { const d = deviceId(); if (d) qs.set('device', d); }
  const suffix = method === 'GET' && qs.toString() ? `?${qs}` : '';
  const res = await fetch(`${API_URL}/api/v1/public/survey/${encodeURIComponent(token)}${suffix}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(password ? { 'X-Survey-Password': password } : {}) },
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

function NpsInput({ value, onChange, tr, enps }) {
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
        <span>{tr(enps ? 'enps_low' : 'nps_low')}</span><span>{tr(enps ? 'enps_high' : 'nps_high')}</span>
      </div>
    </div>
  );
}

/* Ordenação: o respondente move os itens até a ordem que quer. Botões em vez de
   arrastar — funciona no celular, no teclado e no leitor de tela, e é o que a maioria
   consegue usar sem explicação. A resposta é a lista na ordem final. */
function RankingInput({ options, labels, value, onChange, tr }) {
  const base = (options && options.length) ? options : [];
  // Sem resposta ainda, a ordem de partida é a cadastrada. Item que saiu da pergunta
  // depois de a pessoa responder é descartado; item novo entra no fim.
  const atual = Array.isArray(value) && value.length
    ? [...value.filter(v => base.includes(v)), ...base.filter(o => !value.includes(o))]
    : base;
  const rotulo = o => {
    const i = base.indexOf(o);
    return (labels && labels[i]) ? labels[i] : o;
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= atual.length) return;
    const lista = [...atual];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onChange(lista);
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <p style={{ margin:'0 0 2px', fontSize:12, color:'#94A3B8' }}>{tr('ranking_hint')}</p>
      {atual.map((o, i) => (
        <div key={o} style={{ display:'flex', alignItems:'center', gap:10, border:'1px solid #E2E8F0', borderRadius:10, padding:'10px 12px', background:'white' }}>
          <span style={{ flexShrink:0, width:24, height:24, borderRadius:'50%', background: i === 0 ? RED : '#F1F5F9',
            color: i === 0 ? 'white' : '#64748B', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{i+1}</span>
          <span style={{ flex:1, fontSize:14, color:'#334155' }}>{rotulo(o)}</span>
          <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={tr('ranking_up')}
            style={{ border:'1px solid #E2E8F0', background:'white', borderRadius:8, width:30, height:30, cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? .35 : 1, fontSize:13 }}>↑</button>
          <button type="button" onClick={() => mover(i, 1)} disabled={i === atual.length-1} aria-label={tr('ranking_down')}
            style={{ border:'1px solid #E2E8F0', background:'white', borderRadius:8, width:30, height:30, cursor: i === atual.length-1 ? 'default' : 'pointer', opacity: i === atual.length-1 ? .35 : 1, fontSize:13 }}>↓</button>
        </div>
      ))}
    </div>
  );
}

/* Anexo. O arquivo vai junto com o envio, em base64, e o teto vem da pergunta — acima
   dele a pessoa é avisada aqui, e não só depois de esperar o envio falhar. */
function FileInput({ config, value, onChange, tr }) {
  const [erro, setErro] = React.useState('');
  const maxMb = Number(config && config.maxSizeMb) > 0 ? Number(config.maxSizeMb) : 2;
  const accept = (config && Array.isArray(config.accept) && config.accept.length) ? config.accept.join(',') : undefined;

  const escolher = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setErro(tr('file_too_big', { mb: maxMb }));
      e.target.value = '';
      return;
    }
    setErro('');
    const r = new FileReader();
    r.onload = () => onChange({ filename: f.name, mime: f.type, size: f.size, data: String(r.result) });
    r.onerror = () => setErro(tr('file_read_error'));
    r.readAsDataURL(f);
  };

  const kb = value && value.size ? (value.size > 1024*1024 ? (value.size/1024/1024).toFixed(1) + ' MB' : Math.round(value.size/1024) + ' KB') : '';
  return (
    <div>
      {value ? (
        <div style={{ display:'flex', alignItems:'center', gap:10, border:'1px solid #E2E8F0', borderRadius:10, padding:'10px 12px' }}>
          <span style={{ fontSize:20 }}>📎</span>
          <span style={{ flex:1, fontSize:14, color:'#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{value.filename}</span>
          {kb ? <span style={{ fontSize:12, color:'#94A3B8' }}>{kb}</span> : null}
          <button type="button" onClick={() => onChange(null)}
            style={{ border:'1px solid #FECACA', background:'white', color:RED_DARK, borderRadius:8, padding:'5px 10px', fontSize:12, cursor:'pointer' }}>
            {tr('file_remove')}
          </button>
        </div>
      ) : (
        <label style={{ display:'block', border:'2px dashed #E2E8F0', borderRadius:10, padding:'18px', textAlign:'center', cursor:'pointer' }}>
          <div style={{ fontSize:26, marginBottom:4 }}>📎</div>
          <span style={{ fontSize:14, color:'#475569' }}>{tr('file_pick')}</span>
          <span style={{ display:'block', fontSize:12, color:'#94A3B8', marginTop:2 }}>{tr('file_max', { mb: maxMb })}</span>
          <input type="file" accept={accept} onChange={escolher} style={{ display:'none' }} />
        </label>
      )}
      {erro ? <p style={{ color:RED_DARK, fontSize:13, margin:'6px 0 0' }}>{erro}</p> : null}
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
            <span style={{ width:18, height:18, borderRadius: single ? '50%' : 5, border: sel ? `2px solid ${RED}` : '2px solid #CBD5E1', background: sel ? RED : 'white', color:'white', fontSize:12, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{sel ? '✓' : ''}</span>
            {lab[i]}
          </button>
        );
      })}
    </div>
  );
}

function DropdownInput({ options, labels, value, onChange, tr }) {
  const opts = options && options.length ? options : [];
  const lab = (labels && labels.length === opts.length) ? labels : opts;
  const sel = Array.isArray(value) ? (value[0] || '') : (value || '');
  if (!opts.length) return <p style={{ fontSize:13, color:'#94A3B8' }}>{tr('no_options')}</p>;
  return (
    <select value={sel} onChange={e => onChange(e.target.value ? [e.target.value] : [])}
      style={{ width:'100%', boxSizing:'border-box', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px', fontSize:14, fontFamily:'inherit', background:'white', color:'#475569' }}>
      <option value="">{tr('select_option')}</option>
      {opts.map((o, i) => <option key={i} value={o}>{lab[i]}</option>)}
    </select>
  );
}

/* Matriz: uma linha por item avaliado, uma coluna por alternativa.
   O valor enviado é { "linha": posição da coluna (1-based) }. */
function MatrixInput({ rows, rowLabels, options, labels, value, onChange }) {
  const cols = options && options.length ? options : [];
  const lab = (labels && labels.length === cols.length) ? labels : cols;
  const rl = (rowLabels && rowLabels.length === rows.length) ? rowLabels : rows;
  const cur = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const set = (row, pos) => onChange({ ...cur, [row]: pos });
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth: 120 + cols.length * 90 }}>
        <thead>
          <tr>
            <th style={{ textAlign:'left', padding:'6px 8px', color:'#64748B', fontWeight:600 }}></th>
            {cols.map((c, i) => <th key={i} style={{ padding:'6px 8px', color:'#64748B', fontWeight:600, fontSize:12, textAlign:'center' }}>{lab[i]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop:'1px solid #F1F5F9' }}>
              <td style={{ padding:'10px 8px', color:'#334155', fontWeight:600 }}>{rl[ri]}</td>
              {cols.map((_, ci) => {
                const sel = cur[row] === ci + 1;
                return (
                  <td key={ci} style={{ padding:'10px 8px', textAlign:'center' }}>
                    <button type="button" onClick={() => set(row, ci + 1)} aria-label={`${rl[ri]}: ${lab[ci]}`}
                      style={{ width:22, height:22, borderRadius:'50%', cursor:'pointer', padding:0,
                        border: sel ? `6px solid ${RED}` : '2px solid #CBD5E1', background:'white' }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FIELD_TYPE = { email:'email', phone:'tel', date:'date', number:'number', text:'text' };

/* Valida um campo do bloco de formulário. Devolve a mensagem de erro ou ''. */
function fieldError(field, raw, tr) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return field.required ? tr('field_required') : '';
  if (field.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return tr('field_email');
  if (field.kind === 'phone' && (v.replace(/\D/g, '').length < 8)) return tr('field_phone');
  if (field.kind === 'date' && isNaN(new Date(v).getTime())) return tr('field_date');
  return '';
}

/* Bloco de campos de formulário, com validação de e-mail, telefone e data. */
function FormInput({ fields, value, onChange, tr, showErrors, qid }) {
  const cur = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {fields.map((f, i) => {
        const errMsg = showErrors ? fieldError(f, cur[f.label], tr) : '';
        // O rótulo precisa apontar para o campo: sem isso, clicar nele não foca nada e
        // o leitor de tela não anuncia de que campo se trata.
        const campoId = `f-${qid || 'q'}-${i}`;
        const erroId  = `${campoId}-erro`;
        return (
          <div key={i}>
            <label htmlFor={campoId} style={{ display:'block', fontSize:12, fontWeight:600, color:'#64748B', marginBottom:4 }}>
              {f.label}{f.required ? <span style={{ color:RED }}> *</span> : null}
            </label>
            <input id={campoId} type={FIELD_TYPE[f.kind] || 'text'} value={cur[f.label] || ''}
              required={!!f.required}
              aria-invalid={errMsg ? 'true' : undefined}
              aria-describedby={errMsg ? erroId : undefined}
              onChange={e => onChange({ ...cur, [f.label]: e.target.value })}
              style={{ width:'100%', boxSizing:'border-box', border:`1px solid ${errMsg ? '#FCA5A5' : '#E2E8F0'}`, borderRadius:10, padding:'11px 14px', fontSize:14, fontFamily:'inherit' }} />
            {errMsg ? <p id={erroId} style={{ color:RED_DARK, fontSize:12, margin:'4px 0 0' }}>{errMsg}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/* Identificador do dispositivo — usado para barrar resposta repetida e, quando a
   pesquisa permite corrigir o envio, para reencontrar a resposta anterior de quem
   respondeu pelo link geral. Fica no próprio navegador e não identifica a pessoa. */
function deviceId() {
  try {
    let id = localStorage.getItem('rh_device');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '');
      localStorage.setItem('rh_device', id);
    }
    return id;
  } catch { return ''; }
}

/* Alternativas efetivamente marcadas numa pergunta — base da lógica condicional. */
function selectedLabels(q, value) {
  if (value === undefined || value === null || value === '') return [];
  if (q.type === 'scale' && typeof value === 'number') {
    const lb = (q.options || [])[value - 1];
    return lb ? [lb, String(value)] : [String(value)];
  }
  if (q.type === 'multiple' || q.type === 'dropdown') return Array.isArray(value) ? value.map(String) : [String(value)];
  // Na ordenação o que vale como "resposta" é o item posto em 1º: é a escolha que a
  // pessoa fez de fato, e é sobre ela que faz sentido ramificar.
  if (q.type === 'ranking') return Array.isArray(value) && value.length ? [String(value[0])] : [];
  // Anexo não tem alternativa: serve para "respondida"/"em branco", e é o nome que volta.
  if (q.type === 'file') return (value && value.filename) ? [String(value.filename)] : [];
  if (q.type === 'matrix' || q.type === 'form') return [];
  return [String(value)];
}

/* Uma condição isolada: a pergunta-gatilho satisfaz o operador?
   Gatilho que não existe no questionário nunca é satisfeito — melhor a pergunta não
   aparecer do que aparecer por engano com a condição ignorada. */
function testCondition(cond, byOrder, answers) {
  const src = byOrder[cond.order];
  if (!src) return false;
  const marked = selectedLabels(src, answers[src.id]);
  const has = (cond.options || []).some(o => marked.includes(String(o)));
  switch (cond.op) {
    case 'answered': return marked.length > 0;
    case 'blank':    return marked.length === 0;
    case 'not':      return marked.length > 0 && !has;
    default:         return has;   // 'is'
  }
}

/* Grupo de condições com o conectivo: `all` = E, `any` = OU. */
function testGroup(group, byOrder, answers) {
  if (!group || !Array.isArray(group.conditions) || !group.conditions.length) return true;
  const fn = c => testCondition(c, byOrder, answers);
  return group.match === 'all' ? group.conditions.every(fn) : group.conditions.some(fn);
}

/* Divide o questionário em páginas. A quebra fica na pergunta que abre a página
   seguinte; sem nenhuma quebra o questionário é uma página só. */
function paginate(questions) {
  const pages = [];
  questions.forEach(q => {
    if (!pages.length || (q.config && q.config.pageBreak)) pages.push([]);
    pages[pages.length - 1].push(q);
  });
  return pages.length ? pages : [[]];
}

/* Aplica a lógica condicional: esconde perguntas não liberadas e corta o
   questionário quando uma alternativa de encerramento é marcada. */
function applyLogic(questions, answers) {
  const byOrder = {};
  questions.forEach(q => { byOrder[q.order_num] = q; });
  const visible = [];
  let endedBy = null;

  for (const q of questions) {
    if (endedBy) break;
    if (q.logic && q.logic.showIf && !testGroup(q.logic.showIf, byOrder, answers)) continue;
    visible.push(q);
    const end = q.logic && q.logic.endIf;
    if (end) {
      const marked = selectedLabels(q, answers[q.id]);
      if (end.options.some(o => marked.includes(String(o)))) endedBy = q;
    }
  }
  return { visible, endedBy };
}

/* Para onde ir ao sair da página: o primeiro salto satisfeito manda, na ordem em que as
   perguntas aparecem. Devolve o índice da página de destino, 'end' para encerrar, ou
   null quando é para seguir para a próxima página. */
function jumpTarget(pageQuestions, pages, questions, answers) {
  const byOrder = {};
  questions.forEach(q => { byOrder[q.order_num] = q; });
  for (const q of pageQuestions) {
    for (const j of (q.logic && q.logic.jumpIf) || []) {
      if (!testGroup(j, byOrder, answers)) continue;
      if (j.to === 'end') return 'end';
      // O destino é gravado como número de página (1-based) do questionário montado.
      const idx = Number(j.to) - 1;
      if (idx >= 0 && idx < pages.length) return idx;
    }
  }
  return null;
}

export default function PublicSurvey({ token }) {
  const [state, setState] = useState('loading'); // loading | ready | notfound | error | done
  const [survey, setSurvey] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [otherText, setOtherText] = useState({});   // texto do campo "Outros" por pergunta
  const [showErrors, setShowErrors] = useState(false);
  const [onePerDevice, setOnePerDevice] = useState(false);
  const [invited, setInvited] = useState(null);
  const [limitReached, setLimitReached] = useState(false);
  const [quota, setQuota] = useState(null);          // cota do distrito atingida
  const [password, setPassword] = useState("");      // senha do coletor
  const [pwInput, setPwInput] = useState("");
  const [pwWrong, setPwWrong] = useState(false);
  const [thankYou, setThankYou] = useState("");      // página final personalizada
  const [allowEdit, setAllowEdit] = useState(false); // pesquisa aceita corrigir o envio
  const [trail, setTrail] = useState([0]);          // caminho percorrido entre as páginas
  const [jumpEnded, setJumpEnded] = useState(false);// um salto levou ao fim do questionário
  const [editing, setEditing] = useState(null);      // resposta anterior, para corrigir
  const [prefill, setPrefill] = useState(null);      // resposta vinda do link
  const [linkInfo, setLinkInfo] = useState(null);
  const [lang, setLang] = useState(initialLang);
  const tr = (k, v) => t(lang, k, v);
  const changeLang = (l) => { setLang(l); storeLang(l); };

  const load = async (pw) => {
    try {
      const data = await pub('GET', token, null, pw);
      if (data.passwordRequired) {
        setSurvey(data.survey); setPwWrong(!!data.wrongPassword); setState('password');
        return;
      }
      if (data.closed) {
        setSurvey(data.survey); setLimitReached(!!data.limitReached);
        setQuota(data.quotaReached || null); setState('closed');
        return;
      }
      if (data.alreadyAnswered) { setSurvey(data.survey); setState('answered'); return; }
      setSurvey(data.survey);
      setQuestions(data.questions || []);
      setOnePerDevice(!!data.onePerDevice);
      setAllowEdit(!!data.allowEdit);
      setTrail([0]); setJumpEnded(false);
      setInvited(data.invited || null);
      setThankYou(data.thankYou || "");
      setPrefill(data.prefill || null);
      setLinkInfo(data.linkVars || null);
      setEditing(data.editing || null);
      // Corrigir uma resposta já enviada: o formulário abre com o que foi respondido.
      if (data.editing && data.editing.answers) setAnswers(data.editing.answers);
      if (pw) setPassword(pw);
      setState('ready');
    } catch (e) {
      setState(e.status === 404 ? 'notfound' : 'error');
      setErrMsg(e.message || '');
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    return () => { alive = false; };
  /* eslint-disable-next-line */
  }, [token]);

  const setAns = (qid, value) => setAnswers(prev => ({ ...prev, [qid]: value }));
  const toggleMulti = (qid, opt, single) => setAnswers(prev => {
    const cur = Array.isArray(prev[qid]) ? prev[qid] : [];
    // Pergunta de segmentação define o recorte de todo o relatório: aceita uma só resposta.
    if (single) return { ...prev, [qid]: cur.includes(opt) ? [] : [opt] };
    return { ...prev, [qid]: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] };
  });
  const setOther = (qid, text) => setOtherText(prev => ({ ...prev, [qid]: text }));

  // Só as perguntas liberadas pela lógica condicional entram na contagem e no envio.
  const { visible, endedBy } = applyLogic(questions, answers);

  // Páginas: a estrutura vem do questionário inteiro, porque a quebra pode estar numa
  // pergunta que a lógica escondeu — e nesse caso a página continua existindo. O que
  // cada página mostra é só o que a lógica liberou.
  const visibleIds = new Set(visible.map(q => q.id));
  const pages = paginate(questions).map(pg => pg.filter(q => visibleIds.has(q.id)));
  const multi = pages.length > 1;
  const curPage = Math.min(trail[trail.length - 1] || 0, pages.length - 1);
  const onPage = multi ? (pages[curPage] || []) : visible;
  // No envio vai o que foi efetivamente percorrido: uma página que o salto pulou não
  // entra, nem como obrigatória em branco.
  const walked = multi ? [...new Set(trail)].sort((a, b) => a - b).flatMap(i => pages[i] || []) : visible;
  const numberOf = (q) => visible.indexOf(q) + 1;
  // Páginas com conteúdo — é sobre elas que o respondente vê o progresso.
  const filledPages = pages.filter(pg => pg.length).length;
  const pagePos = pages.slice(0, curPage + 1).filter(pg => pg.length).length;
  const nextPageIdx = () => {
    for (let i = curPage + 1; i < pages.length; i++) if (pages[i].length) return i;
    return null;
  };
  const finished = !!endedBy || jumpEnded;
  const isLast = finished || !multi || nextPageIdx() === null;

  const filled = (v) => v !== undefined && v !== null && v !== '' &&
    !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

  const answeredCount = walked.filter(q => filled(answers[q.id])).length;

  /* Valor final da pergunta: troca o rótulo "Outros" pelo texto digitado. */
  const finalValue = (q) => {
    const v = answers[q.id];
    // Não tocar na ordenação é aceitar a ordem apresentada: é essa que vai no envio.
    if (q.type === 'ranking') return (Array.isArray(v) && v.length) ? v : (q.options || []);
    const other = q.config && q.config.allowOther ? (q.config.otherLabel || 'Outros') : null;
    if (!other || !Array.isArray(v)) return v;
    const typed = String(otherText[q.id] || '').trim();
    return v.map(x => (x === other ? (typed || other) : x));
  };

  /* Pendências: obrigatórias em branco e campos de formulário inválidos. Recebe a lista
     a conferir — a página, ao avançar; o caminho inteiro, ao enviar. */
  const pending = (list) => {
    const missing = [];
    list.forEach(q => {
      const n = numberOf(q);
      const v = answers[q.id];
      // Ordenação nasce com a lista preenchida: exigir "resposta" aqui seria exigir que a
      // pessoa mexesse. Basta a lista estar completa, que é o estado inicial.
      const vazio = q.type === 'ranking' ? !(q.options || []).length : !filled(v);
      if (q.required && vazio) { missing.push(tr('missing_q', { n })); return; }
      if (q.type === 'form' && q.config && Array.isArray(q.config.fields)) {
        const cur = (v && typeof v === 'object') ? v : {};
        q.config.fields.forEach(f => {
          const e = fieldError(f, cur[f.label], tr);
          if (e) missing.push(`${n}. ${f.label}: ${e}`);
        });
      }
    });
    return missing;
  };

  const showMissing = (missing) => {
    setShowErrors(true);
    setErrMsg(tr('missing_required') + ' ' + missing.slice(0, 4).join('; ') + (missing.length > 4 ? '…' : ''));
  };
  const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { } };

  /* Avança de página: confere a página, consulta os saltos e empilha o destino no
     caminho. Página de destino sem nenhuma pergunta liberada é atravessada. */
  const goNext = () => {
    setErrMsg('');
    const missing = pending(onPage);
    if (missing.length) { showMissing(missing); return; }
    setShowErrors(false);
    const jump = jumpTarget(onPage, pages, questions, answers);
    if (jump === 'end') { setJumpEnded(true); toTop(); return; }
    let target = jump == null ? nextPageIdx() : jump;
    while (target != null && !(pages[target] || []).length) target = target + 1 < pages.length ? target + 1 : null;
    if (target == null) { setJumpEnded(true); toTop(); return; }
    setTrail(t => [...t, target]);
    toTop();
  };

  const goBack = () => {
    setJumpEnded(false); setShowErrors(false); setErrMsg('');
    setTrail(t => (t.length > 1 ? t.slice(0, -1) : t));
    toTop();
  };

  const submit = async () => {
    setErrMsg('');
    const missing = pending(walked);
    if (missing.length) { showMissing(missing); return; }
    const payload = walked
      .map(q => ({ questionId: q.id, value: finalValue(q) }))
      .filter(a => filled(a.value));
    // A resposta que veio no link (ex.: modalidade) vai junto, mesmo sem aparecer na tela.
    if (prefill) payload.unshift({ questionId: prefill.questionId, value: prefill.value });
    if (payload.length === 0) { setErrMsg(tr('at_least_one')); return; }
    setSubmitting(true);
    try {
      const r = await pub('POST', token, {
        answers: payload,
        deviceId: (onePerDevice || allowEdit) ? deviceId() : undefined,
        linkVars: linkVarsFromURL(),
        ...(password ? { password } : {}),
      });
      if (r && r.thankYou) setThankYou(r.thankYou);
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
  if (state === 'password') {
    const nm = (lang !== 'pt' && survey && survey['name_'+lang]) ? survey['name_'+lang] : (survey && survey.name);
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <LangPicker lang={lang} setLang={changeLang} />
      <Card>
        <div style={{ width:56, height:56, borderRadius:'50%', background:'#F1F5F9', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:26 }}>🔒</div>
        <h2 style={{ color:'#0F172A', fontSize:19, margin:'0 0 6px', textAlign:'center' }}>{tr('pw_title')}</h2>
        {nm ? <p style={{ color:'#334155', fontSize:14, fontWeight:600, margin:'0 0 14px', textAlign:'center' }}>{nm}</p> : null}
        <input type="password" value={pwInput} onChange={e => { setPwInput(e.target.value); setPwWrong(false); }}
          onKeyDown={e => { if (e.key === 'Enter' && pwInput) load(pwInput); }}
          placeholder={tr('pw_placeholder')} autoFocus
          style={{ width:'100%', boxSizing:'border-box', border:`1px solid ${pwWrong ? '#FCA5A5' : '#E2E8F0'}`, borderRadius:10, padding:'12px 14px', fontSize:15, fontFamily:'inherit' }} />
        {pwWrong ? <p style={{ color:RED_DARK, fontSize:13, margin:'8px 0 0' }}>{tr('pw_wrong')}</p> : null}
        <button onClick={() => load(pwInput)} disabled={!pwInput}
          style={{ width:'100%', marginTop:14, padding:'12px', background: pwInput ? RED : '#FCA5A5', color:'white', border:'none', borderRadius:10, cursor: pwInput ? 'pointer' : 'default', fontWeight:700, fontSize:14 }}>
          {tr('pw_submit')}
        </button>
      </Card>
    </Shell>;
  }

  if (state === 'done') {
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>✓</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>{editing ? tr('done_updated_title') : tr('done_title')}</h2>
        <p style={{ color:'#64748B', fontSize:14, margin:0, whiteSpace:'pre-line' }}>{thankYou || tr('done_body')}</p>
        {survey && survey.anonymous ? <p style={{ color:'#16A34A', fontSize:12, marginTop:12, fontWeight:600 }}>{tr('anon_note')}</p> : null}
      </Card>
    </Shell>;
  }

  if (state === 'answered') {
    const nm = (lang !== 'pt' && survey && survey['name_'+lang]) ? survey['name_'+lang] : (survey && survey.name);
    return <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <Card style={{ textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', fontSize:30 }}>✓</div>
        <h2 style={{ color:'#0F172A', fontSize:20, margin:'0 0 8px' }}>{tr('already_answered_title')}</h2>
        {nm ? <p style={{ color:'#334155', fontSize:14, fontWeight:600, margin:'0 0 6px' }}>{nm}</p> : null}
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>{tr('already_answered_body')}</p>
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
        <p style={{ color:'#64748B', fontSize:14, margin:0 }}>
          {quota ? tr('quota_reached_body', { distrito: quota.distrito, meta: quota.meta })
            : limitReached ? tr('limit_reached_body') : tr('survey_closed_body')}
        </p>
      </Card>
    </Shell>;
  }

  // ready
  return (
    <Shell>
      <div style={{ marginBottom:16 }}><Logo /></div>
      <LangPicker lang={lang} setLang={changeLang} />
      {editing ? (
        <Card style={{ marginBottom:14, background:'#EFF6FF', borderColor:'#BFDBFE' }}>
          <p style={{ margin:0, fontSize:13, color:'#1D4ED8' }}>✎ {tr('editing_notice')}</p>
        </Card>
      ) : null}
      <Card style={{ marginBottom:16, borderTop:`3px solid ${RED}` }}>
        <h1 style={{ color:'#0F172A', fontSize:22, margin:'0 0 6px' }}>{(lang !== 'pt' && survey['name_'+lang]) ? survey['name_'+lang] : survey.name}</h1>
        {survey.description ? <p style={{ color:'#64748B', fontSize:14, margin:'0 0 10px' }}>{(lang !== 'pt' && survey['description_'+lang]) ? survey['description_'+lang] : survey.description}</p> : null}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:12 }}>
          {survey.anonymous ? <span style={{ background:'#EFF6FF', color:'#2563EB', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('anon_badge')}</span> : null}
          <span style={{ background:'#F0FDF4', color:'#16A34A', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('lgpd_badge')}</span>
          <span style={{ background:'#F1F5F9', color:'#64748B', padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{visible.length} {visible.length!==1 ? tr('q_many') : tr('q_one')}</span>
          {multi ? <span style={{ background:'#FEF2F2', color:RED_DARK, padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('page_of', { a: pagePos, b: filledPages })}</span> : null}
          {invited && invited.name ? <span style={{ background:'#FEF2F2', color:RED_DARK, padding:'3px 10px', borderRadius:99, fontWeight:600 }}>{tr('invited_as', { name: invited.name })}</span> : null}
          {linkInfo ? <span style={{ background:'#F8FAFC', color:'#64748B', padding:'3px 10px', borderRadius:99, fontWeight:600 }}
            title={tr('linkvars_hint')}>{Object.values(linkInfo).join(' · ')}</span> : null}
        </div>
      </Card>

      {multi ? (
        <div style={{ height:5, borderRadius:99, background:'#F1F5F9', overflow:'hidden', margin:'0 0 14px' }}>
          <div style={{ height:'100%', borderRadius:99, background:RED, width:`${filledPages ? Math.round((pagePos / filledPages) * 100) : 0}%`, transition:'width .25s' }} />
        </div>
      ) : null}

      {onPage.map((q) => {
        const idx = numberOf(q) - 1;
        const otherLabel = (q.config && q.config.allowOther) ? (q.config.otherLabel || tr('other_option')) : null;
        // A opção "Outros" entra no fim da lista e abre um campo de texto quando marcada.
        const opts = otherLabel ? [...(q.options || []), otherLabel] : (q.options || []);
        const hasOpts = opts.length > 0;
        const trOpts = (lang !== 'pt' && Array.isArray(q['options_'+lang]) && q['options_'+lang].length === (q.options || []).length) ? q['options_'+lang] : q.options;
        const optsLabels = otherLabel ? [...(trOpts || []), otherLabel] : trOpts;
        const rows = (q.config && Array.isArray(q.config.rows)) ? q.config.rows : [];
        const rowLabels = (lang !== 'pt' && q.config && Array.isArray(q.config['rows_'+lang])) ? q.config['rows_'+lang] : rows;
        const fields = (q.config && Array.isArray(q.config.fields)) ? q.config.fields : [];
        const specialized = ['nps','enps','scale','rating','yesno','matrix','form','ranking','file'].includes(q.type) || ((q.type === 'multiple' || q.type === 'dropdown') && hasOpts);
        const otherPicked = otherLabel && Array.isArray(answers[q.id]) && answers[q.id].includes(otherLabel);
        // Segmentação (ex.: modalidade de contratação) é escolha única, mesmo vindo como múltipla.
        const isSingle = !!(q.config && q.config.segmentation);
        const unanswered = showErrors && q.required && !filled(answers[q.id]);
        return (
        <Card key={q.id} style={{ marginBottom:14, ...(unanswered ? { border:'1px solid #FCA5A5' } : {}) }}>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <span style={{ flexShrink:0, width:24, height:24, borderRadius:'50%', background:RED, color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{idx+1}</span>
            <p style={{ margin:0, fontSize:15, fontWeight:600, color:'#1E293B', lineHeight:1.4 }}>
              {(lang !== 'pt' && q['text_'+lang]) ? q['text_'+lang] : q.text}
              {q.required ? <span style={{ color:RED }} title={tr('required_q')}> *</span> : null}
            </p>
          </div>
          {(q.type === 'nps' || q.type === 'enps') && <NpsInput value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} enps={q.type === 'enps'} />}
          {q.type === 'ranking'  && (hasOpts
            ? <RankingInput options={q.options} labels={trOpts} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />
            : <p style={{ fontSize:13, color:'#94A3B8' }}>{tr('no_options')}</p>)}
          {q.type === 'file'     && <FileInput config={q.config} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'scale'    && <ScaleInput options={q.options} labels={trOpts} value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'rating'   && <RatingInput value={answers[q.id]} onChange={v => setAns(q.id, v)} />}
          {q.type === 'yesno'    && <YesNoInput value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'multiple' && hasOpts && <MultipleInput options={opts} labels={optsLabels} value={answers[q.id]}
            single={isSingle} onToggle={opt => toggleMulti(q.id, opt, isSingle)} tr={tr} />}
          {q.type === 'dropdown' && hasOpts && <DropdownInput options={opts} labels={optsLabels} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} />}
          {q.type === 'matrix'   && (rows.length && hasOpts
            ? <MatrixInput rows={rows} rowLabels={rowLabels} options={q.options} labels={trOpts} value={answers[q.id]} onChange={v => setAns(q.id, v)} />
            : <p style={{ fontSize:13, color:'#94A3B8' }}>{tr('no_options')}</p>)}
          {q.type === 'form'     && (fields.length
            ? <FormInput fields={fields} value={answers[q.id]} onChange={v => setAns(q.id, v)} tr={tr} showErrors={showErrors} qid={q.id} />
            : <p style={{ fontSize:13, color:'#94A3B8' }}>{tr('no_options')}</p>)}
          {otherPicked &&
            <input value={otherText[q.id] || ''} onChange={e => setOther(q.id, e.target.value)}
              placeholder={tr('other_placeholder')}
              style={{ width:'100%', boxSizing:'border-box', marginTop:8, border:'1px solid #E2E8F0', borderRadius:10, padding:'11px 14px', fontSize:14, fontFamily:'inherit' }} />}
          {!specialized &&
            <textarea value={answers[q.id] || ''} onChange={e => setAns(q.id, e.target.value)} rows={4}
              placeholder={tr('answer_placeholder')}
              style={{ width:'100%', boxSizing:'border-box', border:'1px solid #E2E8F0', borderRadius:10, padding:'12px 14px', fontSize:14, fontFamily:'inherit', resize:'vertical' }} />}
        </Card>
        );
      })}

      {finished ? (
        <Card style={{ marginBottom:14, background:'#F8FAFC', borderStyle:'dashed' }}>
          <p style={{ margin:0, fontSize:13, color:'#64748B' }}>{tr('logic_ended')}</p>
        </Card>
      ) : null}

      {errMsg ? <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C', borderRadius:10, padding:'12px 14px', fontSize:14, marginBottom:14 }}>⚠️ {errMsg}</div> : null}

      <Card style={{ position:'sticky', bottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <span style={{ fontSize:13, color:'#64748B' }}>{tr('answered_of', { a: answeredCount, b: walked.length })}</span>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {multi && trail.length > 1 ? (
            <button onClick={goBack} disabled={submitting}
              style={{ padding:'12px 18px', background:'white', color:'#475569', border:'1px solid #E2E8F0', borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:14 }}>
              {tr('page_back')}
            </button>
          ) : null}
          {isLast ? (
            <button onClick={submit} disabled={submitting}
              style={{ padding:'12px 24px', background: submitting ? '#FCA5A5' : RED, color:'white', border:'none', borderRadius:10, cursor: submitting ? 'default' : 'pointer', fontWeight:700, fontSize:14 }}>
              {submitting ? tr('sending') : (editing ? tr('submit_update') : tr('submit_answers'))}
            </button>
          ) : (
            <button onClick={goNext} disabled={submitting}
              style={{ padding:'12px 24px', background:RED, color:'white', border:'none', borderRadius:10, cursor:'pointer', fontWeight:700, fontSize:14 }}>
              {tr('page_next')}
            </button>
          )}
        </div>
      </Card>

      <p style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:16 }}>
        {tr('lgpd_footer')}
      </p>
    </Shell>
  );
}
