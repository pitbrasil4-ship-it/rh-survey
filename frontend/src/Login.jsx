import { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, Shield, Mail, Lock, User, Building2, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const GRAD    = 'linear-gradient(135deg,#5B21B6,#7C3AED)';
const OVERLAY = 'linear-gradient(170deg,rgba(59,7,100,.72) 0%,rgba(91,33,182,.82) 50%,rgba(109,40,217,.92) 100%)';
const IMG_URL = 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80&fit=crop';

export default function Login({ onLogin }) {
  const [mode,     setMode]     = useState('login');   // 'login' | 'register'
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [company,  setCompany]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const reset = () => { setError(''); setEmail(''); setPassword(''); setName(''); setCompany(''); };

  const handleLogin = async (e) => {
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
        setError(data.message || 'Credenciais inválidas');
      }
    } catch { setError('Erro de conexão. Verifique sua internet.'); }
    setLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !company || !email || !password) { setError('Preencha todos os campos'); return; }
    if (password.length < 8) { setError('Senha deve ter no mínimo 8 caracteres'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/register`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, companyName: company, email, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('rh_token', data.data.accessToken);
        localStorage.setItem('rh_user',  JSON.stringify(data.data.user));
        onLogin(data.data);
      } else {
        setError(data.message || 'Erro ao criar conta');
      }
    } catch { setError('Erro de conexão. Verifique sua internet.'); }
    setLoading(false);
  };

  const inp = {
    width:'100%', padding:'13px 14px 13px 42px', border:'2px solid #E2E8F0',
    borderRadius:12, fontSize:14, color:'#1E293B', outline:'none',
    background:'#FAFAFA', fontFamily:'inherit', transition:'border-color .2s',
  };
  const lbl = { display:'block', fontSize:11, fontWeight:700, color:'#475569',
    marginBottom:6, textTransform:'uppercase', letterSpacing:.6 };
  const iconWrap = { position:'relative', marginBottom:16 };
  const icon = { position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'#94A3B8' };

  const LeftPanel = () => (
    <div style={{ flex:1, position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:48 }}>
      <img src={IMG_URL} alt="Equipe" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
      <div style={{ position:'absolute', inset:0, background:OVERLAY }} />
      <div style={{ position:'absolute', top:0, left:0, padding:48, display:'flex', alignItems:'center', gap:14, zIndex:2 }}>
        <div style={{ width:48, height:48, background:'rgba(255,255,255,.15)', borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:18, color:'white', border:'1.5px solid rgba(255,255,255,.25)' }}>RH</div>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:'white' }}>RH Survey</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.75)' }}>Plataforma de Avaliação</div>
        </div>
      </div>
      <div style={{ position:'relative', zIndex:2, color:'white' }}>
        <div style={{ background:'rgba(255,255,255,.1)', backdropFilter:'blur(16px)', border:'1px solid rgba(255,255,255,.2)', borderRadius:20, padding:28, marginBottom:28 }}>
          <p style={{ fontSize:15, lineHeight:1.7, fontStyle:'italic', opacity:.95, marginBottom:16 }}>"Com o RH Survey reduzimos o tempo de avaliações em 70% e aumentamos a adesão de 40% para 92%."</p>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:40, height:40, borderRadius:'50%', background:'linear-gradient(135deg,#F59E0B,#EF4444)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'white', fontSize:13 }}>CA</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>Carla Andrade</div>
              <div style={{ fontSize:11, opacity:.7 }}>Diretora de RH · Grupo Empresarial</div>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:32 }}>
          {[['2.500+','Avaliações'],['98%','LGPD OK'],['4.9★','Satisfação']].map(([n,l]) => (
            <div key={l}><div style={{ fontSize:28, fontWeight:800 }}>{n}</div><div style={{ fontSize:12, opacity:.7 }}>{l}</div></div>
          ))}
        </div>
      </div>
    </div>
  );

  const MobileBanner = () => (
    <div style={{ position:'relative', height:220, flexShrink:0, overflow:'hidden' }}>
      <img src={IMG_URL} alt="Equipe" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
      <div style={{ position:'absolute', inset:0, background:OVERLAY }} />
      <div style={{ position:'relative', zIndex:2, color:'white', padding:'52px 20px 20px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div style={{ width:38, height:38, background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.25)', borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:14, color:'white' }}>RH</div>
          <div><div style={{ fontSize:16, fontWeight:800 }}>RH Survey</div><div style={{ fontSize:10, opacity:.75 }}>Plataforma de Avaliação</div></div>
        </div>
        <div style={{ fontSize:18, fontWeight:800, lineHeight:1.2 }}>Avaliações que transformam equipes</div>
      </div>
    </div>
  );

  const FormArea = ({ children }) => (
    <div style={{ background:'white', borderRadius: isMobile ? '24px 24px 0 0' : 0, padding: isMobile ? '24px 20px' : 0, marginTop: isMobile ? -20 : 0, flex: isMobile ? 1 : 'none', zIndex:3, position:'relative' }}>
      {isMobile && <div style={{ width:40, height:4, background:'#E2E8F0', borderRadius:2, margin:'0 auto 20px' }} />}
      {children}
    </div>
  );

  const RightPanel = ({ children }) => (
    <div style={{ width: isMobile ? '100%' : 460, display:'flex', alignItems:'center', justifyContent:'center', padding: isMobile ? '0 20px 32px' : '40px 32px', background:'white' }}>
      <div style={{ width:'100%', maxWidth:380 }}>{children}</div>
    </div>
  );

  const LoginForm = () => (
    <form onSubmit={handleLogin}>
      <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#F0FDF4', color:'#166534', border:'1px solid #BBF7D0', fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, marginBottom:14 }}>
        <Shield size={11} />LGPD Compliant
      </div>
      <h2 style={{ fontSize: isMobile ? 22 : 26, fontWeight:800, color:'#0F172A', margin:'0 0 6px' }}>Bem-vindo de volta 👋</h2>
      <p style={{ fontSize:14, color:'#64748B', margin:'0 0 24px', lineHeight:1.5 }}>Entre com sua conta corporativa para acessar a plataforma.</p>

      {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>⚠️ {error}</div>}

      <div style={iconWrap}>
        <label style={lbl}>E-mail corporativo</label>
        <span style={icon}><Mail size={16} /></span>
        <input style={inp} type="email" placeholder="voce@empresa.com.br" value={email} onChange={e => setEmail(e.target.value)}
          onFocus={e => e.target.style.borderColor='#7C3AED'} onBlur={e => e.target.style.borderColor='#E2E8F0'} />
      </div>
      <div>
        <label style={lbl}>Senha</label>
        <div style={{ position:'relative' }}>
          <span style={icon}><Lock size={16} /></span>
          <input style={inp} type={showPass?'text':'password'} placeholder="••••••••••••" value={password} onChange={e => setPassword(e.target.value)}
            onFocus={e => e.target.style.borderColor='#7C3AED'} onBlur={e => e.target.style.borderColor='#E2E8F0'} />
          <button type="button" onClick={() => setShowPass(!showPass)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}>
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', margin:'8px 0 18px' }}>
        <button type="button" style={{ fontSize:12, color:'#7C3AED', fontWeight:700, background:'none', border:'none', cursor:'pointer' }}>Esqueceu a senha?</button>
      </div>

      <button type="submit" disabled={loading} style={{ width:'100%', padding:14, background:GRAD, color:'white', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity:loading?.75:1 }}>
        {loading ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} />Entrando...</> : 'Entrar na plataforma →'}
      </button>

      <div style={{ textAlign:'center', fontSize:13, color:'#64748B', margin:'16px 0' }}>
        Não tem conta?{' '}
        <button type="button" onClick={() => { reset(); setMode('register'); }} style={{ color:'#7C3AED', fontWeight:700, background:'none', border:'none', cursor:'pointer', fontSize:13 }}>Criar conta grátis</button>
      </div>
      <div style={{ background:'#F8FAFF', border:'1px solid #DBEAFE', borderRadius:10, padding:'10px 12px', display:'flex', alignItems:'flex-start', gap:8 }}>
        <Shield size={13} style={{ color:'#1E40AF', flexShrink:0, marginTop:1 }} />
        <p style={{ fontSize:11, color:'#1E40AF', lineHeight:1.5, margin:0 }}>Dados protegidos pela <strong>LGPD (Lei nº 13.709/2018)</strong>. Criptografia AES-256 em todas as operações.</p>
      </div>
    </form>
  );

  const RegisterForm = () => (
    <form onSubmit={handleRegister}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
        <button type="button" onClick={() => { reset(); setMode('login'); }} style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', display:'flex', alignItems:'center', gap:4, fontSize:13 }}>← Voltar</button>
      </div>
      <h2 style={{ fontSize: isMobile ? 22 : 24, fontWeight:800, color:'#0F172A', margin:'0 0 6px' }}>Criar conta grátis 🚀</h2>
      <p style={{ fontSize:13, color:'#64748B', margin:'0 0 20px', lineHeight:1.5 }}>Configure sua plataforma de avaliações em menos de 2 minutos.</p>

      {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#B91C1C', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>⚠️ {error}</div>}

      {[
        { label:'Seu nome', icon:<User size={16} />, placeholder:'João Silva', value:name, set:setName, type:'text' },
        { label:'Nome da empresa', icon:<Building2 size={16} />, placeholder:'Empresa Ltda.', value:company, set:setCompany, type:'text' },
        { label:'E-mail corporativo', icon:<Mail size={16} />, placeholder:'voce@empresa.com.br', value:email, set:setEmail, type:'email' },
        { label:'Senha (mín. 8 caracteres)', icon:<Lock size={16} />, placeholder:'••••••••••••', value:password, set:setPassword, type:'password' },
      ].map(({ label, icon: ic, placeholder, value, set, type }, i) => (
        <div key={i} style={{ marginBottom:14 }}>
          <label style={lbl}>{label}</label>
          <div style={{ position:'relative' }}>
            <span style={icon}>{ic}</span>
            <input style={inp} type={type} placeholder={placeholder} value={value} onChange={e => set(e.target.value)}
              onFocus={e => e.target.style.borderColor='#7C3AED'} onBlur={e => e.target.style.borderColor='#E2E8F0'} />
          </div>
        </div>
      ))}

      <button type="submit" disabled={loading} style={{ width:'100%', padding:14, background:GRAD, color:'white', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:4, opacity:loading?.75:1 }}>
        {loading ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} />Criando conta...</> : 'Criar minha conta →'}
      </button>

      <p style={{ textAlign:'center', fontSize:11, color:'#94A3B8', marginTop:14, lineHeight:1.5 }}>
        Ao criar uma conta você concorda com nossos Termos de Uso e confirma estar em conformidade com a <strong>LGPD</strong>.
      </p>
    </form>
  );

  if (isMobile) {
    return (
      <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:'white', fontFamily:'system-ui,-apple-system,sans-serif' }}>
        <MobileBanner />
        <FormArea>
          {mode === 'login' ? <LoginForm /> : <RegisterForm />}
        </FormArea>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', fontFamily:'system-ui,-apple-system,sans-serif' }}>
      <LeftPanel />
      <RightPanel>
        {mode === 'login' ? <LoginForm /> : <RegisterForm />}
      </RightPanel>
    </div>
  );
}
