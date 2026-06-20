import React, { useState, Component } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

// Adiciona animacao de spin
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(styleEl);

// Error Boundary
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{padding:24,fontFamily:'system-ui',background:'#FEF2F2',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'white',borderRadius:16,padding:32,maxWidth:500,width:'100%',boxShadow:'0 4px 24px rgba(0,0,0,.1)'}}>
            <div style={{fontSize:40,textAlign:'center',marginBottom:12}}>⚠️</div>
            <h2 style={{color:'#B91C1C',textAlign:'center',margin:'0 0 8px',fontSize:18}}>Erro detectado</h2>
            <pre style={{background:'#FEE2E2',padding:12,borderRadius:8,fontSize:11,color:'#7F1D1D',overflow:'auto',whiteSpace:'pre-wrap',margin:'0 0 16px',maxHeight:250}}>
              {String(this.state.err)}\n{this.state.err?.stack}
            </pre>
            <button onClick={()=>window.location.reload()}
              style={{width:'100%',padding:12,background:'linear-gradient(135deg,#5B21B6,#7C3AED)',color:'white',border:'none',borderRadius:10,cursor:'pointer',fontSize:14,fontWeight:700}}>
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy load para capturar erros de cada módulo separadamente
const Login    = React.lazy(() => import('./Login.jsx'));
const MainApp  = React.lazy(() => import('./MainApp.jsx'));

function Root() {
  const [auth, setAuth] = useState(() => {
    try {
      const t = localStorage.getItem('rh_token');
      const u = localStorage.getItem('rh_user');
      return t ? { token:t, user:JSON.parse(u) } : null;
    } catch { return null; }
  });

  const Fallback = () => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16,fontFamily:'system-ui',background:'#F1F5F9'}}>
      <div style={{width:48,height:48,background:'linear-gradient(135deg,#5B21B6,#7C3AED)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,color:'white',fontSize:18}}>RH</div>
      <p style={{color:'#64748B',fontSize:14,margin:0}}>Carregando...</p>
    </div>
  );

  return (
    <ErrorBoundary>
      <React.Suspense fallback={<Fallback />}>
        {!auth
          ? <Login onLogin={(data) => {
              localStorage.setItem('rh_token', data.accessToken || data.token || '');
              localStorage.setItem('rh_user', JSON.stringify(data.user || data));
              setAuth(data);
            }} />
          : <MainApp />
        }
      </React.Suspense>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
