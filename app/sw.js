// Service worker: shows push notifications and opens the right screen when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'SAFA FARRAJ', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'SAFA FARRAJ', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/' },
    dir: 'rtl',
    lang: 'he'
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/#' + ((event.notification.data && event.notification.data.url) || '/');
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
