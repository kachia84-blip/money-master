'use strict';
const CACHE = 'money-master-v4';
const SHELL = ['./', './index.html', './app.js', './style.css', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './data/sample.json'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('money-master-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) {
        let cacheable = true;
        if (url.pathname.endsWith('/data/insights.json')) {
          try { const data = await response.clone().json(); cacheable = data && typeof data.updated === 'string' && Array.isArray(data.items); }
          catch { cacheable = false; }
        }
        if (cacheable) await cache.put(request, response.clone());
        return response;
      }
      if (response.status >= 500) {
        const cached = await cache.match(request); if (cached) return cached;
      }
      return response;
    } catch {
      const cached = await cache.match(request); if (cached) return cached;
      if (request.mode === 'navigate') return (await cache.match(new URL('./index.html', scope).href)) || Response.error();
      return Response.error();
    }
  })());
});
