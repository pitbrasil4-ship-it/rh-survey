import React, { useState, Component } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// Captura qualquer erro de renderizacao e mostra na tela
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#FEF2F2', padding:24, fontFamily:'system-ui' }}>
          <div style={{ background:'white', borderRadius:16, padding:32, maxWidth:480, width:'100%', boxShadow:'0 4px 24px rgba(0,0,0,.1)' }}>
            <div style={{ fontSize:40, textAlign:'center', marginBottom:12 }}>⚠️</div>
            <h2 style={{ color:'#B91C1C', textAlign:'center', marginBottom:8, fontSize:18 }}>Erro ao carregar</h2>
            <p style={{ color:'#64748B', fontSize:13, textAlign:'center', marginBottom:16 }}>
              Detalhes do erro (envie para suporte):
            </p>
            <pre style={{ background:'#FEE2E2', padding:12, borderRadius:8, fontSize:11, color:'#7F1D1D', overflow:'auto', whiteSpace:'pre-wrap', marginBottom:16 }}>
              {String(this.state.err)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{ width:'100%', padding:12, background:'linear-gradient(135deg,#5B21B6,#7C3AED)', color:'white', border:'none', borderRadius:10, cursor:'pointer', fontSize:14, fontWeight:700 }}>
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Adiciona animacao de spin para o loading do botao de login
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);

// Importacoes lazy para capturar erros de modulo
let Login, App;
try {
  Login = (await import('./Login.jsx')).default;
  App   = (await import('../RHSurvey.jsx')).default;
} catch (e) {
  document.getElementById('root').innerHTML =
    '<div style="padding:32px;font-family:system-ui;background:#FEF2F2;min-height:100vh">' +
    '<h2 style="color:#B91C1C">Erro de importacao</h2>' +
    '<pre style="font-size:12px;color:#7F1D1D;white-space:pre-wrap">' + String(e) + '</pre>' +
    '</div>';
  throw e;
}

function Root() {
  const [auth, setAuth] = useState(() => {
    try {
      const token = localStorage.getItem('rh_token');
      const user  = localStorage.getItem('rh_user');
      return token ? { token, user: JSON.parse(user) } : null;
    } catch { return null; }
  });

  const handleLogout = () => {
    localStorage.removeItem('rh_token');
    localStorage.removeItem('rh_user');
    setAuth(null);
  };

  if (!auth) return <Login onLogin={(data) => setAuth(data)} />;
  return <App onLogout={handleLogout} user={auth.user} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
