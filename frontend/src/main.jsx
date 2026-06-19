import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App    from '../RHSurvey.jsx';
import Login  from './Login.jsx';
import './index.css';

// Spin animation for loader
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);

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

  if (!auth) {
    return <Login onLogin={(data) => setAuth(data)} />;
  }
  return <App onLogout={handleLogout} user={auth.user} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
