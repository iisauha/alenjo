// Alenjo service worker: notifications only.
// No fetch handler and no caching, so it never serves an old version of the app.

self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Alenjo', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/icon-192.png?v=3',
    badge: '/icon-192.png?v=3',
    data: { url: d.url || '/' }
  }));
});

// Tap: bring Alenjo forward on the right tab, or open it
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        c.postMessage({ type: 'alenjo-open', url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
