import React, { useState, Component } from 'react';
import ReactDOM from 'react-dom/client';
import Login  from './Login.jsx';
import App    from '../RHSurvey.jsx';
import './index.css';

const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(styleEl);

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#FEF2F2',padding:24,fontFamily:'system-ui,-apple-system,sans-serif' }}>
          <div style={{ background:'white',borderRadius:16,padding:32,maxWidth:480,width:'100%',boxShadow:'0 4px 24px rgba(0,0,0,.1)' }}>
            <div style={{ fontSize:40,textAlign:'center',marginBottom:12 }}>⚠️</div>
            <h2 style={{ color:'#B91C1C',textAlign:'center',marginBottom:8,fontSize:18,margin:'0 0 8px' }}>Erro de carregamento</h2>
            <p style={{ color:'#64748B',fontSize:13,textAlign:'center',margin:'0 0 16px' }}>Copie o texto abaixo e envie para suporte:</p>
            <pre style={{ background:'#FEE2E2',padding:12,borderRadius:8,fontSize:11,color:'#7F1D1D',overflow:'auto',whiteSpace:'pre-wrap',margin:'0 0 16px',maxHeight:200 }}>
              {String(this.state.err)}
              {this.state.err?.stack ? '\n\n' + this.state.err.stack : ''}
            </pre>
            <button onClick={() => window.location.reload()}
              style={{ width:'100%',padding:12,background:'linear-gradient(135deg,#5B21B6,#7C3AED)',color:'white',border:'none',borderRadius:10,cursor:'pointer',fontSize:14,fontWeight:700 }}>
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const [auth, setAuth] = useState(() => {
    try {
      const token = localStorage.getItem('rh_token');
      const user  = localStorage.getItem('rh_user');
      return token ? { token, user: JSON.parse(user) } : null;
    } catch { return null; }
  });

  if (!auth) return <Login onLogin={setAuth} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><Root /></ErrorBoundary>
);
