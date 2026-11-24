// Alenjo service worker: notifications, plus a picture cache.
// App code (HTML, JS, CSS) is never cached here, so it never serves an old version of the app.
// Pictures (bank and store logos, card art, your photo) are kept on the phone so they show
// instantly instead of popping in every time iOS reopens the app. The saved copy shows first
// and a fresh copy is fetched in the background for next time.
var IMG_CACHE = 'alenjo-img-v1';
var IMG_MAX = 600;

// Supabase gives a new signed link every few days for the same file: key by the file itself
function imgKey(url) {
  var m = url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public|authenticated)\/(.+)$/);
  if (m) return url.origin + '/storage/v1/object/any/' + m[1];
  return url.href;
}
function trim(cache) {
  if (Math.random() > 0.05) return;
  cache.keys().then(function(keys) {
    for (var i = 0; i < keys.length - IMG_MAX; i++) cache.delete(keys[i]);
  });
}
self.addEventListener('fetch', function(e) {
  var req = e.request;
  // Only plain picture loads from other sites (<img> and CSS backgrounds). Pictures the app
  // reads pixel by pixel (CORS) and everything else go straight to the network as before.
  if (req.method !== 'GET' || req.destination !== 'image' || req.mode !== 'no-cors') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) return;
  var key = imgKey(url);
  e.respondWith(caches.open(IMG_CACHE).then(function(cache) {
    return cache.match(key).then(function(hit) {
      var net = fetch(req).then(function(res) {
        if (res && (res.ok || res.type === 'opaque')) { cache.put(key, res.clone()); trim(cache); }
        return res;
      });
      if (hit) { e.waitUntil(net.catch(function() {})); return hit; }
      return net;
    });
  }).catch(function() { return fetch(req); }));
});

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
