import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, Shield, Mail, Lock, Star } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const GRAD    = 'linear-gradient(135deg,#5B21B6,#7C3AED)';
const OVERLAY = 'linear-gradient(170deg,rgba(59,7,100,.72) 0%,rgba(91,33,182,.82) 50%,rgba(109,40,217,.92) 100%)';
const IMG_URL = 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80&fit=crop';

const s = {
  /* layout */
  root:     { display:'flex', minHeight:'100vh', fontFamily:'system-ui,-apple-system,sans-serif', background:'white' },
  left:     { flex:1, position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:48 },
  bgImg:    { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' },
  overlay:  { position:'absolute', inset:0, background:OVERLAY },
  logoWrap: { position:'absolute', top:0, left:0, padding:48, display:'flex', alignItems:'center', gap:14, zIndex:2 },
  logoBox:  { width:48, height:48, background:'rgba(255,255,255,.15)', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:18, color:'white', border:'1.5px solid rgba(255,255,255,.25)' },
  lc:       { position:'relative', zIndex:2, color:'white' },
  card:     { background:'rgba(255,255,255,.1)', backdropFilter:'blur(16px)', border:'1px solid rgba(255,255,255,.2)', borderRadius:20, padding:28, marginBottom:28 },
  quote:    { fontSize:15, lineHeight:1.7, fontStyle:'italic', opacity:.95, marginBottom:16 },
  author:   { display:'flex', alignItems:'center', gap:12 },
  avatar:   { width:40, height:40, borderRadius:'50%', background:'linear-gradient(135deg,#F59E0B,#EF4444)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'white', fontSize:13, flexShrink:0 },
  stats:    { display:'flex', gap:32 },
  statNum:  { fontSize:28, fontWeight:800, display:'block' },
  statLbl:  { fontSize:12, opacity:.7 },
  /* right */
  right:    { width:'100%', maxWidth:460, display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 32px', background:'white' },
  box:      { width:'100%', maxWidth:360 },
  badge:    { display:'inline-flex', alignItems:'center', gap:6, background:'#F0FDF4', color:'#166534', border:'1px solid #BBF7D0', fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, marginBottom:14 },
  h2:       { fontSize:26, fontWeight:800, color:'#0F172A', marginBottom:6 },
  sub:      { fontSize:14, color:'#64748B', marginBottom:28, lineHeight:1.5 },
  label:    { display:'block', fontSize:11, fontWeight:700, color:'#475569', marginBottom:6, textTransform:'uppercase', letterSpacing:.6 },
  inpWrap:  { position:'relative' },
  inpIcon:  { position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'#94A3B8' },
  inp:      { width:'100%', padding:'13px 42px', border:'2px solid #E2E8F0', borderRadius:12, fontSize:14, color:'#1E293B', outline:'none', background:'#FAFAFA', transition:'all .2s', fontFamily:'inherit' },
  eyeBtn:   { position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex', alignItems:'center' },
  row:      { display:'flex', alignItems:'center', justifyContent:'space-between', margin:'8px 0 18px' },
  chkLabel: { display:'flex', alignItems:'center', gap:7, fontSize:13, color:'#64748B', cursor:'pointer' },
  forgotA:  { fontSize:12, color:'#7C3AED', fontWeight:700, textDecoration:'none', background:'none', border:'none', cursor:'pointer' },
  btn:      { width:'100%', padding:14, background:GRAD, color:'white', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'opacity .2s' },
  err:      { background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:14, display:'flex', alignItems:'center', gap:8 },
  divider:  { display:'flex', alignItems:'center', gap:10, margin:'18px 0', color:'#CBD5E1', fontSize:12 },
  divLine:  { flex:1, height:1, background:'#E2E8F0' },
  regTxt:   { textAlign:'center', fontSize:13, color:'#64748B', marginBottom:16 },
  regA:     { color:'#7C3AED', fontWeight:700, textDecoration:'none' },
  lgpdBox:  { background:'#F8FAFF', border:'1px solid #DBEAFE', borderRadius:10, padding:'10px 12px', display:'flex', alignItems:'flex-start', gap:8 },
  lgpdTxt:  { fontSize:11, color:'#1E40AF', lineHeight:1.5 },
  /* mobile banner */
  mobileBanner: { display:'none' },
  mobileLogo:   { display:'flex', alignItems:'center', gap:10, marginBottom:16 },
  mobileLogoBox:{ width:38, height:38, borderRadius:11, background:'rgba(255,255,255,.2)', border:'1px solid rgba(255,255,255,.25)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:14, color:'white' },
  mobileImg:    { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' },
  mobileOver:   { position:'absolute', inset:0, background:OVERLAY },
  mobileCnt:    { position:'relative', zIndex:2, color:'white', padding:'56px 20px 24px' },
  mobileH:      { fontSize:20, fontWeight:800, lineHeight:1.2, marginBottom:4 },
  mobileP:      { fontSize:12, opacity:.8 },
  mobileStats:  { display:'flex', justifyContent:'space-around', padding:'12px 0', borderTop:'1px solid rgba(255,255,255,.2)', marginTop:16 },
  mStat:        { textAlign:'center' },
  mStatNum:     { display:'block', fontSize:15, fontWeight:800 },
  mStatLbl:     { fontSize:9, opacity:.75 },
  formCard:     { background:'white', borderRadius:'24px 24px 0 0', padding:'24px 20px', marginTop:-20, position:'relative', zIndex:3, flex:1 },
  handle:       { width:40, height:4, background:'#E2E8F0', borderRadius:2, margin:'0 auto 20px' },
};

export default function Login({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Preencha e-mail e senha para continuar'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('rh_token', data.data.accessToken);
        localStorage.setItem('rh_user',  JSON.stringify(data.data.user));
        onLogin(data.data);
      } else {
        setError(data.message || 'Credenciais inválidas. Tente novamente.');
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet e tente novamente.');
    }
    setLoading(false);
  };

  const FormContent = () => (
    <>
      {error && (
        <div style={s.err}>
          <span>⚠️</span>{error}
        </div>
      )}
      <div style={{ marginBottom:16 }}>
        <label style={s.label}>E-mail corporativo</label>
        <div style={s.inpWrap}>
          <span style={s.inpIcon}><Mail size={16} /></span>
          <input style={s.inp} type="email" placeholder="voce@empresa.com.br"
            value={email} onChange={e => setEmail(e.target.value)}
            onFocus={e => { e.target.style.borderColor='#7C3AED'; e.target.style.background='white'; }}
            onBlur={e =>  { e.target.style.borderColor='#E2E8F0'; e.target.style.background='#FAFAFA'; }}
          />
        </div>
      </div>
      <div style={{ marginBottom:4 }}>
        <label style={s.label}>Senha</label>
        <div style={s.inpWrap}>
          <span style={s.inpIcon}><Lock size={16} /></span>
          <input style={s.inp} type={showPass ? 'text' : 'password'} placeholder="••••••••••••"
            value={password} onChange={e => setPassword(e.target.value)}
            onFocus={e => { e.target.style.borderColor='#7C3AED'; e.target.style.background='white'; }}
            onBlur={e =>  { e.target.style.borderColor='#E2E8F0'; e.target.style.background='#FAFAFA'; }}
          />
          <button style={s.eyeBtn} type="button" onClick={() => setShowPass(!showPass)}>
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div style={s.row}>
        <label style={s.chkLabel}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
            style={{ accentColor:'#7C3AED', width:14, height:14, cursor:'pointer' }}
          /> Lembrar acesso
        </label>
        <button type="button" style={s.forgotA}>Esqueceu a senha?</button>
      </div>
      <button type="submit" style={{ ...s.btn, opacity: loading ? .75 : 1 }} disabled={loading}>
        {loading ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} />Entrando...</> : 'Entrar na plataforma →'}
      </button>
      <div style={s.divider}><div style={s.divLine} />ou<div style={s.divLine} /></div>
      <div style={s.regTxt}>Não tem conta? <a href="#" style={s.regA}>Criar conta grátis</a></div>
      <div style={s.lgpdBox}>
        <Shield size={13} style={{ color:'#1E40AF', flexShrink:0, marginTop:1 }} />
        <p style={s.lgpdTxt}>Dados protegidos pela <strong>LGPD (Lei nº 13.709/2018)</strong>. Criptografia AES-256 em todas as operações.</p>
      </div>
    </>
  );

  /* ── MOBILE ── */
  if (isMobile) {
    return (
      <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:'white' }}>
        {/* Banner */}
        <div style={{ position:'relative', height:240, flexShrink:0, overflow:'hidden' }}>
          <img src={IMG_URL} alt="Equipe" style={s.mobileImg} />
          <div style={s.mobileOver} />
          <div style={s.mobileCnt}>
            <div style={s.mobileLogo}>
              <div style={s.mobileLogoBox}>RH</div>
              <div>
                <div style={{ fontSize:16, fontWeight:800 }}>RH Survey</div>
                <div style={{ fontSize:10, opacity:.75 }}>Plataforma de Avaliação</div>
              </div>
            </div>
            <div style={s.mobileH}>Avaliações que transformam equipes</div>
            <div style={s.mobileP}>360° · NPS · Clima · LGPD Compliant</div>
            <div style={s.mobileStats}>
              {[['2.500+','Avaliações'],['98%','LGPD OK'],['4.9★','Satisfação']].map(([n,l]) => (
                <div key={l} style={s.mStat}>
                  <span style={s.mStatNum}>{n}</span>
                  <span style={s.mStatLbl}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Form card */}
        <div style={s.formCard}>
          <div style={s.handle} />
          <div style={{ ...s.badge, marginBottom:12 }}><Shield size={10} />LGPD Compliant</div>
          <div style={{ ...s.h2, fontSize:22 }}>Bem-vindo de volta 👋</div>
          <div style={{ ...s.sub, fontSize:13 }}>Entre com sua conta para acessar a plataforma</div>
          <FormContent />
        </div>
      </form>
    );
  }

  /* ── DESKTOP ── */
  return (
    <form onSubmit={handleLogin} style={s.root}>
      {/* LEFT */}
      <div style={s.left}>
        <img src={IMG_URL} alt="Equipe de RH" style={s.bgImg} />
        <div style={s.overlay} />
        <div style={s.logoWrap}>
          <div style={s.logoBox}>RH</div>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:'white' }}>RH Survey</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.75)' }}>Plataforma de Avaliação</div>
          </div>
        </div>
        <div style={s.lc}>
          <div style={s.card}>
            <p style={s.quote}>"Com o RH Survey reduzimos o tempo de avaliações em 70% e aumentamos a adesão de 40% para 92%."</p>
            <div style={s.author}>
              <div style={s.avatar}>CA</div>
              <div>
                <div style={{ fontSize:13, fontWeight:700 }}>Carla Andrade</div>
                <div style={{ fontSize:11, opacity:.7 }}>Diretora de RH · Grupo Empresarial</div>
              </div>
            </div>
          </div>
          <div style={s.stats}>
            {[['2.500+','Avaliações realizadas'],['98%','LGPD Compliant'],['4.9★','Satisfação dos clientes']].map(([n,l]) => (
              <div key={l}>
                <span style={s.statNum}>{n}</span>
                <span style={s.statLbl}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* RIGHT */}
      <div style={s.right}>
        <div style={s.box}>
          <div style={s.badge}><Shield size={11} />LGPD Compliant</div>
          <h2 style={s.h2}>Bem-vindo de volta 👋</h2>
          <p style={s.sub}>Entre com sua conta corporativa para acessar a plataforma de avaliações.</p>
          <FormContent />
        </div>
      </div>
    </form>
  );
}
