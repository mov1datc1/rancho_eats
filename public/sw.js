const CACHE_NAME = 'pideya-v3';
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
    tag: 'pideya-new-order',
    renotify: true,
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

  const targetUrl = '/restaurantes?mode=login';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes('/restaurantes') && 'focus' in client) {
          return client.focus();
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
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(event.request).then((match) => match || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for same-origin static assets.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        return response;
      });
    })
  );
});
