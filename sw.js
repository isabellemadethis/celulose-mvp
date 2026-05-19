// ============================================================
// Celulose Digital — Service Worker (N-B PWA setup)
// ============================================================
// Versao: bump quando shell muda — força clientes a refazer cache.
// CACHE_NAME inclui versao pra invalidar antigos automaticamente.
const CACHE_VERSION = 'v3-2026-05-19-sinapse';
const CACHE_NAME = 'celulose-mvp-' + CACHE_VERSION;

// Shell minimo cacheado no install. Firebase + Google Fonts ficam fora
// (network-first via fetch handler) pra nao servir dados estale.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// ============================================================
// INSTALL — pre-cacheia shell
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache opcional: se algum arquivo falhar (404 transient), nao bloqueia install.
      return Promise.allSettled(SHELL.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — limpa caches antigos + assume control imediato
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k.startsWith('celulose-mvp-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — NETWORK-FIRST pro shell (sempre busca rede primeiro,
// cache so como fallback offline). Mudanca C5.2: estrategia anterior
// (cache-first) servia index.html antigo por dias mesmo apos deploy novo.
// ============================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET only — POST/PUT/DELETE passam direto pra rede
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firebase, Google Fonts, qualquer thing externo: network-first sem cache
  // (dados precisam ser frescos; fontes carregam rapido em network OK).
  if (url.origin !== self.location.origin) {
    return; // browser default: network
  }

  // Same-origin: NETWORK-FIRST com fallback pro cache.
  // Sempre tenta rede; se sucesso, atualiza cache pra uso offline futuro;
  // se falhar (offline), cai pro cache; se nem cache, retorna shell pra navegacoes.
  event.respondWith(
    fetch(req).then((response) => {
      if (response && response.status === 200) {
        const respClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
      }
      return response;
    }).catch(() => {
      return caches.match(req).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ============================================================
// PUSH — stub pra N-B L3 (sera ativado quando FCM entrar)
// ============================================================
// Formato esperado do payload do push (acordo com Cloud Function futura):
//   { title: string, body: string, icon?: string, url?: string, tag?: string }
self.addEventListener('push', (event) => {
  let payload = { title: 'Celulose', body: 'Nova notificacao' };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: payload.icon || './icon.svg',
    badge: './icon.svg',
    tag: payload.tag || 'celulose-default',
    data: { url: payload.url || './' },
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ============================================================
// NOTIFICATIONCLICK — foca tab existente ou abre nova
// ============================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      // Reusa tab existente se ja tiver uma aberta
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      // Senao, abre nova
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
