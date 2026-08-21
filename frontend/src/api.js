// Cliente central da API — injeta o token JWT e aponta para o backend (Railway).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  try { return localStorage.getItem('rh_token') || ''; } catch { return ''; }
}

function clearSession() {
  try { localStorage.removeItem('rh_token'); localStorage.removeItem('rh_user'); localStorage.removeItem('rh_refresh'); } catch {}
}

/* Encerra a sessão e volta para a tela de login (evita ficar preso no painel sem token). */
function endSession() {
  clearSession();
  try {
    const p = window.location.pathname;
    // Não redireciona em rotas públicas (responder pesquisa / avaliação).
    if (!/^\/(r|eval)\//.test(p)) window.location.replace('/');
  } catch {}
}

/* Tenta renovar o access token usando o refresh token (válido por 7 dias). */
let refreshing = null;
async function tryRefresh() {
  let rt = '';
  try { rt = localStorage.getItem('rh_refresh') || ''; } catch {}
  if (!rt) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!r.ok) return false;
        const j = await r.json();
        const nt = j?.data?.accessToken;
        if (!nt) return false;
        try { localStorage.setItem('rh_token', nt); } catch {}
        return true;
      } catch { return false; }
      finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
  }
  return refreshing;
}

async function rawRequest(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function request(method, path, body) {
  let res;
  try {
    res = await rawRequest(method, path, body, getToken());
  } catch {
    const e = new Error('Erro de conexão com o servidor. Verifique sua internet.');
    e.status = 0;
    throw e;
  }

  // Access token expirado: renova uma vez e repete a chamada.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const okRefresh = await tryRefresh();
    if (okRefresh) {
      try { res = await rawRequest(method, path, body, getToken()); } catch {
        const e = new Error('Erro de conexão com o servidor. Verifique sua internet.');
        e.status = 0;
        throw e;
      }
    }
  }

  let json = null;
  try { json = await res.json(); } catch {}

  if (res.status === 401 && !path.startsWith('/auth/')) {
    // Sessão realmente encerrada — limpa e volta ao login.
    endSession();
  }
  if (!res.ok) {
    const e = new Error(json?.message || `Erro ${res.status}`);
    e.status = res.status;
    throw e;
  }
  // Backend envelopa em { success, message, data, timestamp } — devolvemos data.
  return json?.data ?? json;
}

export const api = {
  get:  (p)    => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put:  (p, b) => request('PUT', p, b),
  del:  (p)    => request('DELETE', p),

  users: {
    list:   ()         => request('GET', '/users'),
    create: (data)     => request('POST', '/users', data),
    update: (id, data) => request('PUT', `/users/${id}`, data),
    remove: (id)       => request('DELETE', `/users/${id}`),
    testEmail: ()      => request('POST', '/users/test-email'),
  },
  surveys: {
    list:       ()         => request('GET', '/surveys'),
    create:     (data)     => request('POST', '/surveys', data),
    generateAI: (context, count) => request('POST', '/surveys/generate-ai', { context, count }),
    translate:  (id)       => request('POST', `/surveys/${id}/translate`),
    setDeadline: (id, deadline) => request('PUT', `/surveys/${id}/deadline`, { deadline }),
    segmentLinks:     (id) => request('POST', `/surveys/${id}/segment-links`),
    listSegmentLinks: (id) => request('GET',  `/surveys/${id}/segment-links`),
    bulk:             (payload) => request('POST', '/surveys/bulk', payload),
  },
  respondents: {
    list:   ()     => request('GET', '/respondents'),
    create: (data) => request('POST', '/respondents', data),
    registerConsent: (id, channel) => request('POST', `/respondents/${id}/consent`, { channel: channel || 'platform' }),
    remove: (id)   => request('DELETE', `/respondents/${id}`),
    import: (respondents) => request('POST', '/respondents/import', { respondents }),
  },
  results: {
    dashboard: ()         => request('GET', '/results/dashboard'),
    insights:  (surveyId, lang) => request('POST', '/results/insights', { surveyId, lang }),
    segments:  (surveyId) => request('GET', `/results/segments?surveyId=${encodeURIComponent(surveyId)}`),
    segmentQuestions: (surveyId) => request('GET', `/results/segment-questions?surveyId=${encodeURIComponent(surveyId)}`),
    pdf: async (surveyId, lang) => {
      const q = lang ? `?lang=${encodeURIComponent(lang)}` : '';
      const path = `/results/${encodeURIComponent(surveyId)}/pdf${q}`;
      let resp = await rawRequest('GET', path, null, getToken());
      if (resp.status === 401 && await tryRefresh()) resp = await rawRequest('GET', path, null, getToken());
      if (resp.status === 401) { endSession(); throw new Error('Sessão expirada'); }
      if (!resp.ok) throw new Error('Falha ao gerar PDF');
      return resp.blob();
    },
    insightsPdf: async (surveyId, insights, lang) => {
      const path = '/results/insights-pdf';
      const body = { surveyId, insights, lang };
      let resp = await rawRequest('POST', path, body, getToken());
      if (resp.status === 401 && await tryRefresh()) resp = await rawRequest('POST', path, body, getToken());
      if (resp.status === 401) { endSession(); throw new Error('Sessão expirada'); }
      if (!resp.ok) throw new Error('Falha ao gerar PDF');
      return resp.blob();
    },
  },
  push: {
    vapidPublic: ()             => request('GET',  '/push/vapid-public'),
    subscribe:   (subscription) => request('POST', '/push/subscribe', { subscription }),
    unsubscribe: (endpoint)     => request('POST', '/push/unsubscribe', { endpoint }),
    test:        ()             => request('POST', '/push/test'),
  },
  org: {
    list:               ()        => request('GET',  '/org'),
    createRegional:     (name)    => request('POST', '/org/regionais', { name }),
    updateRegional:     (id, name)=> request('PUT',  `/org/regionais/${id}`, { name }),
    deleteRegional:     (id)      => request('DELETE', `/org/regionais/${id}`),
    createDistrito:     (d)       => request('POST', '/org/distritos', d),
    updateDistrito:     (id, d)   => request('PUT',  `/org/distritos/${id}`, d),
    deleteDistrito:     (id)      => request('DELETE', `/org/distritos/${id}`),
    createDepartamento: (d)       => request('POST', '/org/departamentos', d),
    updateDepartamento: (id, d)   => request('PUT',  `/org/departamentos/${id}`, d),
    deleteDepartamento: (id)      => request('DELETE', `/org/departamentos/${id}`),
    import:             (data)    => request('POST', '/org/import', data),
  },
  eval: {
    cycles:           ()               => request('GET', '/eval/cycles'),
    createCycle:      (name, surveyId) => request('POST', '/eval/cycles', { name, surveyId }),
    cycle:            (id)             => request('GET', `/eval/cycles/${id}`),
    addAssignment:    (cycleId, data)  => request('POST', `/eval/cycles/${cycleId}/assignments`, data),
    removeAssignment: (id)             => request('DELETE', `/eval/assignments/${id}`),
    results:          (cycleId)        => request('GET', `/eval/results/${cycleId}`),
  },
  audit: {
    list: () => request('GET', '/audit'),
  },
  auth: {
    changePassword: (currentPassword, newPassword) => request('POST', '/auth/change-password', { currentPassword, newPassword }),
  },
};

export default api;
