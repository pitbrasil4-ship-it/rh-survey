// Service worker do RH Survey (PWA).
// Não interfere nas chamadas à API (outro domínio). Suporta atualização sob demanda.
const CACHE = 'rh-survey-v4';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/favicon.svg?v=3', '/site.webmanifest', '/icon-192.png?v=3', '/icon-512.png?v=3', '/apple-touch-icon.png?v=3'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // ativa a nova versão imediatamente para limpar ícones antigos do cache
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Permite que a página peça para ativar a nova versão imediatamente.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // chamadas à API (Railway) passam direto

  // Assets versionados do Vite são imutáveis: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Navegações e demais GETs: network-first; offline cai no cache e, por fim, na página offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/offline.html') : caches.match('/index.html'))))
  );
});

// ─── Notificações Web Push ─────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'RH Survey', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'RH Survey';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };
  e.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      if (self.navigator && self.navigator.setAppBadge) { self.navigator.setAppBadge().catch(() => {}); }
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { try { c.navigate(url); } catch (err) {} return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
