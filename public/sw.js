const CACHE_NAME = 'pideya-v6-admin-routes';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

const isHttpRequest = (url) => url.protocol === 'http:' || url.protocol === 'https:';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ─── Push Notifications (from server or Supabase Edge Function) ─── */
self.addEventListener('push', (event) => {
  let title = '🍕 Nuevo pedido — Pide Ya';
  let body = 'Tienes un pedido nuevo esperando tu confirmación.';
  let data = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      data = payload.data || {};
    } catch {
      body = event.data.text() || body;
    }
  }

  const options = {
    body,
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    vibrate: [300, 100, 300, 100, 300],
    tag: data.eventId || data.orderId || 'pideya-new-order',
    renotify: false,
    requireInteraction: true,
    data,
    actions: [
      { action: 'view', title: '📋 Ver pedido' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ─── Notification Click — navigate to restaurant orders panel ─── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const orderId = event.notification.data?.orderId;
  const targetUrl = '/restaurantes?mode=login' + (orderId ? '&orderId=' + encodeURIComponent(orderId) : '');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes('/restaurantes') && 'focus' in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

/* ─── Fetch — Network-first for navigations, cache-first for assets ─── */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (!isHttpRequest(requestUrl)) return;

  // Never cache non same-origin requests (Mapbox, extensions, etc.).
  if (requestUrl.origin !== self.location.origin) return;

  // Network-first for navigations to avoid stale index.html after deploys.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)).catch(() => undefined));
          }
          return response;
        })
        .catch(async () => {
          try {
            const shell = await caches.match('/index.html');
            if (shell) return shell;
          } catch { /* Storage can be unavailable in private browsing. */ }
          return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PideYa · Sin conexión</title><body style="margin:40px 24px;font:16px/1.6 system-ui;color:#1e293b"><h1>No pudimos conectar</h1><p>Revisa tu conexión y vuelve a abrir PideYa.</p><a href="/administrador">Reintentar administración</a></body></html>', {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
        })
    );
    return;
  }

  // Cache only static assets, never same-origin API/auth responses.
  if (!['script','style','image','font','manifest','worker'].includes(event.request.destination) && !APP_SHELL.includes(requestUrl.pathname)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        return response;
      });
    }).catch(() => new Response('', {status:503,headers:{'Cache-Control':'no-store'}}))
  );
});
