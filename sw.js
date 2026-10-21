'use strict';
const CACHE = 'money-master-v9';
const SHELL = ['./', './index.html', './app.js', './style.css', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];
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
    const isData = url.pathname === new URL('./data/insights.json', scope).pathname;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('Network response');
      if (isData) {
        const data = await response.clone().json();
        if (!Array.isArray(data) && !Array.isArray(data?.items)) throw new Error('Invalid feed');
      }
      try { await cache.put(request, response.clone()); } catch { /* Storage is optional. */ }
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) {
        if (!isData) return cached;
        const headers = new Headers(cached.headers); headers.set('X-Money-Master-Cache', '1');
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
      }
      if (request.mode === 'navigate') return (await cache.match(new URL('./index.html', scope).href)) || Response.error();
      return Response.error();
    } finally { clearTimeout(timer); }
  })());
});
