import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ── Logo SVG — Pulso Humano (Opção C) ────────────────────────────────────────
function LogoRHSurvey({ dark = false }) {
  const textColor = dark ? 'white'   : '#1E1B4B';
  const subColor  = dark ? 'rgba(255,255,255,.45)' : '#94A3B8';
  const bgFill    = dark ? 'rgba(255,255,255,.08)' : 'url(#bggrad)';
  return (
    <svg width="200" height="56" viewBox="0 0 220 68" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bggrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1E1B4B"/>
          <stop offset="100%" stopColor="#312E81"/>
        </linearGradient>
        <linearGradient id="redgrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#DC2626"/>
          <stop offset="100%" stopColor="#EF4444"/>
        </linearGradient>
      </defs>
      {/* Ícone — pill background */}
      <rect x="0" y="6" width="68" height="56" rx="13" fill={bgFill}/>
      {/* Linha EKG esquerda */}
      <path d="M5 36 L14 36 L18 27 L22 46 L26 18"
        stroke="url(#redgrad)" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"/>
      {/* Cabeça da pessoa (pico do pulso) */}
      <circle cx="26" cy="12" r="5.5" fill="#EF4444"/>
      {/* Corpo */}
      <line x1="26" y1="18" x2="26" y2="30" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Braços levantados (vitória) */}
      <path d="M20 23 L26 20 L32 23" stroke="#EF4444" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Pernas */}
      <line x1="26" y1="30" x2="22" y2="40" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="26" y1="30" x2="30" y2="40" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Linha EKG direita (fade) */}
      <path d="M26 18 L30 46 L34 33 L44 33 L63 33"
        stroke="url(#redgrad)" strokeWidth="2.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>

      {/* Wordmark */}
      <text x="78" y="30" fontFamily="'Segoe UI',system-ui,sans-serif"
        fontWeight="900" fontSize="22" fill={textColor}>RH</text>
      <text x="111" y="30" fontFamily="'Segoe UI',system-ui,sans-serif"
        fontWeight="900" fontSize="22" fill="#DC2626">Survey</text>
      <text x="78" y="47" fontFamily="'Segoe UI',system-ui,sans-serif"
        fontWeight="600" fontSize="10" fill={subColor} letterSpacing="2.5">
        PLATAFORMA DE AVALIAÇÃO
      </text>
    </svg>
  );
}

// ── Imagens de pessoas em avaliação (Unsplash — uso livre) ───────────────────
const IMG = 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=1400&q=85&fit=crop&crop=top';

// ── Estilos base ─────────────────────────────────────────────────────────────
const DARK_GRAD   = 'linear-gradient(160deg,rgba(13,12,34,.5) 0%,rgba(13,12,34,.75) 45%,rgba(13,12,34,.96) 100%)';
const RED_BTN     = 'linear-gradient(135deg,#B91C1C,#DC2626)';

export default function Login({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Preencha e-mail e senha'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/login`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('rh_token', data.data.accessToken);
        localStorage.setItem('rh_user',  JSON.stringify(data.data.user));
        onLogin(data.data);
      } else {
        setError(data.message || 'Credenciais inválidas. Verifique e tente novamente.');
      }
    } catch {
      setError('Erro de conexão com o servidor. Contate o suporte de TI.');
    }
    setLoading(false);
  };

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <form onSubmit={handleSubmit} style={{
        display:'flex', flexDirection:'column', minHeight:'100vh',
        background:'#0D0C22', fontFamily:"'Segoe UI',system-ui,sans-serif"
      }}>
        {/* Banner topo */}
        <div style={{ position:'relative', height:280, flexShrink:0, overflow:'hidden' }}>
          <img src={IMG} alt="Avaliação de desempenho"
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'top center' }}/>
          <div style={{ position:'absolute', inset:0, background:DARK_GRAD }}/>
          {/* Logo no topo */}
          <div style={{ position:'absolute', top:0, left:0, padding:'48px 20px 0', zIndex:2 }}>
            <LogoRHSurvey dark />
          </div>
          {/* Texto sobre a imagem */}
          <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'0 20px 24px', zIndex:2, color:'white' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:7, background:'rgba(220,38,38,.18)', border:'1px solid rgba(220,38,38,.4)', color:'#FCA5A5', fontSize:10, fontWeight:800, padding:'4px 10px', borderRadius:20, marginBottom:10, textTransform:'uppercase', letterSpacing:.8 }}>
              <span style={{ width:5, height:5, borderRadius:'50%', background:'#EF4444', display:'inline-block' }}/>
              Sistema Interno · RGIS Brasil
            </div>
            <div style={{ fontSize:20, fontWeight:800, lineHeight:1.2 }}>
              Avalie. Desenvolva.<br/>Evolua junto.
            </div>
          </div>
        </div>

        {/* Card formulário */}
        <div style={{
          background:'white', borderRadius:'24px 24px 0 0',
          padding:'24px 20px 40px', flex:1, marginTop:-20, zIndex:3, position:'relative'
        }}>
          <div style={{ width:40, height:4, background:'#E2E8F0', borderRadius:2, margin:'0 auto 20px' }}/>

          <div style={{ marginBottom:20 }}>
            <p style={{ fontSize:12, color:'#64748B', lineHeight:1.6, margin:0,
              background:'#F8FAFC', border:'1px solid #E2E8F0', borderRadius:10, padding:'10px 12px' }}>
              🔒 <strong>Acesso restrito</strong> · Entre com as credenciais fornecidas pelo RH. 
              Para primeiro acesso ou dúvidas, contate o administrador do sistema.
            </p>
          </div>

          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
              padding:'10px 12px', fontSize:13, color:'#B91C1C', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:800, color:'#475569',
              marginBottom:6, textTransform:'uppercase', letterSpacing:.6 }}>E-mail corporativo</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)',
                fontSize:15, opacity:.4 }}>✉️</span>
              <input type="email" placeholder="nome.sobrenome@rgis.com.br" value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width:'100%', padding:'13px 12px 13px 38px', border:'2px solid #E2E8F0',
                  borderRadius:10, fontSize:14, color:'#0D0C22', outline:'none',
                  background:'#FAFAFA', fontFamily:'inherit' }}
                onFocus={e => e.target.style.borderColor='#DC2626'}
                onBlur={e  => e.target.style.borderColor='#E2E8F0'}/>
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:800, color:'#475569',
              marginBottom:6, textTransform:'uppercase', letterSpacing:.6 }}>Senha</label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)',
                fontSize:15, opacity:.4 }}>🔑</span>
              <input type={showPass?'text':'password'} placeholder="••••••••••••" value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width:'100%', padding:'13px 40px 13px 38px', border:'2px solid #E2E8F0',
                  borderRadius:10, fontSize:14, color:'#0D0C22', outline:'none',
                  background:'#FAFAFA', fontFamily:'inherit' }}
                onFocus={e => e.target.style.borderColor='#DC2626'}
                onBlur={e  => e.target.style.borderColor='#E2E8F0'}/>
              <button type="button" onClick={() => setShowPass(!showPass)}
                style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}>
                {showPass ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>

          <div style={{ textAlign:'right', marginBottom:20 }}>
            <button type="button"
              style={{ fontSize:12, color:'#DC2626', fontWeight:700, background:'none', border:'none', cursor:'pointer' }}>
              Esqueceu sua senha?
            </button>
          </div>

          <button type="submit" disabled={loading}
            style={{ width:'100%', padding:14, background:RED_BTN, color:'white', border:'none',
              borderRadius:10, fontSize:15, fontWeight:800, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              opacity:loading?.75:1, letterSpacing:.3 }}>
            {loading
              ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }}/>Verificando...</>
              : 'Entrar no sistema →'}
          </button>

          <p style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:20, lineHeight:1.6 }}>
            Dados protegidos pela <strong style={{ color:'#64748B' }}>LGPD (Lei nº 13.709/2018)</strong><br/>
            Uso interno exclusivo · RGIS Brasil
          </p>
        </div>
      </form>
    );
  }

  // ── DESKTOP ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} style={{
      display:'flex', minHeight:'100vh',
      fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif"
    }}>
      {/* LEFT — Imagem de pessoas + branding */}
      <div style={{ flex:1, position:'relative', overflow:'hidden',
        display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:48 }}>

        <img src={IMG} alt="Avaliação de desempenho RH"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%',
            objectFit:'cover', objectPosition:'top center' }}/>
        <div style={{ position:'absolute', inset:0, background:DARK_GRAD }}/>

        {/* Logo */}
        <div style={{ position:'absolute', top:0, left:0, padding:'40px 48px', zIndex:2 }}>
          <LogoRHSurvey dark />
        </div>

        {/* Conteúdo */}
        <div style={{ position:'relative', zIndex:2, color:'white' }}>
          {/* Badge sistema interno */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:8,
            background:'rgba(220,38,38,.15)', border:'1px solid rgba(220,38,38,.35)',
            color:'#FCA5A5', fontSize:11, fontWeight:800, padding:'6px 14px',
            borderRadius:20, marginBottom:24, textTransform:'uppercase', letterSpacing:.8 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#EF4444',
              display:'inline-block', animation:'pulse 2s infinite' }}/>
            Sistema Interno · RGIS Brasil
          </div>

          <h2 style={{ fontSize:44, fontWeight:900, lineHeight:1.1, marginBottom:18,
            textShadow:'0 2px 20px rgba(0,0,0,.3)' }}>
            Avalie.<br/><span style={{ color:'#EF4444' }}>Desenvolva.</span><br/>Evolua junto.
          </h2>
          <p style={{ fontSize:15, color:'rgba(255,255,255,.7)', lineHeight:1.75,
            maxWidth:420, marginBottom:40 }}>
            Plataforma centralizada para avaliações de desempenho, 
            pesquisas de clima e feedbacks estruturados da equipe RGIS Brasil.
          </p>

          {/* Cards informativos */}
          <div style={{ display:'flex', gap:14, marginBottom:40 }}>
            {[
              { icon:'📊', label:'Avaliação', value:'360° e NPS' },
              { icon:'🎯', label:'Performance', value:'Indicadores' },
              { icon:'💬', label:'Feedback', value:'Estruturado' },
              { icon:'🛡️', label:'Privacidade', value:'LGPD Ativa' },
            ].map(({ icon, label, value }) => (
              <div key={label} style={{
                background:'rgba(255,255,255,.07)', backdropFilter:'blur(12px)',
                border:'1px solid rgba(255,255,255,.1)', borderRadius:14, padding:'14px 16px' }}>
                <div style={{ fontSize:20, marginBottom:6 }}>{icon}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,.5)',
                  textTransform:'uppercase', letterSpacing:.6, marginBottom:2 }}>{label}</div>
                <div style={{ fontSize:13, fontWeight:700 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:10,
            fontSize:12, color:'rgba(255,255,255,.35)' }}>
            <div style={{ height:1, width:24, background:'rgba(255,255,255,.2)' }}/>
            Acesso restrito a colaboradores RGIS Brasil cadastrados
          </div>
        </div>
      </div>

      {/* RIGHT — Formulário */}
      <div style={{ width:460, display:'flex', alignItems:'center', justifyContent:'center',
        padding:'40px 40px', background:'#F8FAFC' }}>
        <div style={{ width:'100%', maxWidth:360 }}>

          {/* Header */}
          <div style={{ marginBottom:28 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6,
              background:'#FEF2F2', border:'1px solid #FECACA',
              color:'#991B1B', fontSize:10, fontWeight:800, padding:'4px 10px',
              borderRadius:6, marginBottom:16, textTransform:'uppercase', letterSpacing:.5 }}>
              🔒 Acesso Corporativo
            </div>
            <h2 style={{ fontSize:24, fontWeight:800, color:'#0D0C22', margin:'0 0 8px' }}>
              Acessar o Sistema
            </h2>
            <p style={{ fontSize:13, color:'#64748B', lineHeight:1.6, margin:0 }}>
              Entre com as credenciais fornecidas pelo RH. 
              Primeiro acesso? Contate o administrador do sistema.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
              padding:'10px 14px', fontSize:13, color:'#B91C1C',
              marginBottom:20, display:'flex', alignItems:'center', gap:8 }}>
              ⚠️ {error}
            </div>
          )}

          {/* E-mail */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:800, color:'#475569',
              marginBottom:6, textTransform:'uppercase', letterSpacing:.6 }}>
              E-mail corporativo
            </label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:13, top:'50%',
                transform:'translateY(-50%)', fontSize:15, opacity:.4 }}>✉️</span>
              <input type="email" placeholder="nome.sobrenome@rgis.com.br" value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width:'100%', padding:'13px 12px 13px 40px', border:'2px solid #E2E8F0',
                  borderRadius:12, fontSize:14, color:'#0D0C22', outline:'none',
                  background:'white', fontFamily:'inherit', transition:'border-color .2s' }}
                onFocus={e => e.target.style.borderColor='#DC2626'}
                onBlur={e  => e.target.style.borderColor='#E2E8F0'}/>
            </div>
          </div>

          {/* Senha */}
          <div style={{ marginBottom:8 }}>
            <label style={{ display:'block', fontSize:10, fontWeight:800, color:'#475569',
              marginBottom:6, textTransform:'uppercase', letterSpacing:.6 }}>
              Senha
            </label>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:13, top:'50%',
                transform:'translateY(-50%)', fontSize:15, opacity:.4 }}>🔑</span>
              <input type={showPass?'text':'password'} placeholder="••••••••••••" value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width:'100%', padding:'13px 40px 13px 40px', border:'2px solid #E2E8F0',
                  borderRadius:12, fontSize:14, color:'#0D0C22', outline:'none',
                  background:'white', fontFamily:'inherit', transition:'border-color .2s' }}
                onFocus={e => e.target.style.borderColor='#DC2626'}
                onBlur={e  => e.target.style.borderColor='#E2E8F0'}/>
              <button type="button" onClick={() => setShowPass(!showPass)}
                style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}>
                {showPass ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>

          {/* Esqueceu */}
          <div style={{ textAlign:'right', marginBottom:22 }}>
            <button type="button"
              style={{ fontSize:12, color:'#DC2626', fontWeight:700,
                background:'none', border:'none', cursor:'pointer' }}>
              Esqueceu sua senha?
            </button>
          </div>

          {/* Botão */}
          <button type="submit" disabled={loading}
            style={{ width:'100%', padding:14, background:RED_BTN, color:'white',
              border:'none', borderRadius:12, fontSize:15, fontWeight:800,
              cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', gap:8, opacity:loading?.75:1,
              letterSpacing:.3, marginBottom:24, transition:'opacity .2s' }}>
            {loading
              ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }}/>Verificando...</>
              : 'Entrar no sistema →'}
          </button>

          {/* Separador */}
          <div style={{ display:'flex', alignItems:'center', gap:10,
            margin:'0 0 20px', color:'#CBD5E1', fontSize:11 }}>
            <div style={{ flex:1, height:1, background:'#E2E8F0' }}/>
            Informações de acesso
            <div style={{ flex:1, height:1, background:'#E2E8F0' }}/>
          </div>

          {/* Perfis info */}
          <div style={{ background:'#F8FAFC', border:'1px solid #E2E8F0',
            borderRadius:12, padding:'14px 16px', marginBottom:20 }}>
            <p style={{ fontSize:11, fontWeight:700, color:'#475569',
              marginBottom:10, textTransform:'uppercase', letterSpacing:.5 }}>
              Perfis de acesso
            </p>
            {[
              { role:'Administrador', icon:'⚙️', desc:'Cria pesquisas, gerencia usuários e resultados' },
              { role:'Gestor',        icon:'👔', desc:'Aplica avaliações e vê resultados da equipe'  },
              { role:'Colaborador',   icon:'👤', desc:'Responde avaliações e pesquisas designadas'   },
            ].map(({ role, icon, desc }) => (
              <div key={role} style={{ display:'flex', alignItems:'flex-start', gap:10,
                padding:'6px 0', borderBottom:'1px solid #F1F5F9' }}>
                <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{icon}</span>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:'#0F172A' }}>{role}</div>
                  <div style={{ fontSize:11, color:'#94A3B8', lineHeight:1.4 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* LGPD */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:8,
            padding:'10px 12px', background:'#F0FDF4',
            border:'1px solid #BBF7D0', borderRadius:10 }}>
            <span style={{ fontSize:13, flexShrink:0 }}>🛡️</span>
            <p style={{ fontSize:11, color:'#166534', lineHeight:1.5, margin:0 }}>
              Dados protegidos pela <strong>LGPD (Lei nº 13.709/2018)</strong>. 
              Sistema de uso interno exclusivo da RGIS Brasil.
            </p>
          </div>

        </div>
      </div>
    </form>
  );
}
