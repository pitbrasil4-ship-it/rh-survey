// Cliente central da API — injeta o token JWT e aponta para o backend (Railway).
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  try { return localStorage.getItem('rh_token') || ''; } catch { return ''; }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;

  let res;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Erro de conexão com o servidor. Verifique sua internet.');
    e.status = 0;
    throw e;
  }

  let json = null;
  try { json = await res.json(); } catch {}

  if (res.status === 401) {
    // Sessão expirada — limpa o token para forçar novo login.
    try { localStorage.removeItem('rh_token'); localStorage.removeItem('rh_user'); } catch {}
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
  },
  surveys: {
    list:       ()         => request('GET', '/surveys'),
    create:     (data)     => request('POST', '/surveys', data),
    generateAI: (context, count) => request('POST', '/surveys/generate-ai', { context, count }),
    translate:  (id)       => request('POST', `/surveys/${id}/translate`),
    setDeadline: (id, deadline) => request('PUT', `/surveys/${id}/deadline`, { deadline }),
    segmentLinks:     (id) => request('POST', `/surveys/${id}/segment-links`),
    listSegmentLinks: (id) => request('GET',  `/surveys/${id}/segment-links`),
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
    pdf: async (surveyId) => {
      let token = ''; try { token = localStorage.getItem('rh_token') || ''; } catch {}
      const resp = await fetch(`${API_URL}/api/v1/results/${encodeURIComponent(surveyId)}/pdf`, { headers: { Authorization: 'Bearer ' + token } });
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
