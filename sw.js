// sw.js — Service Worker für StyleSync
// Zweck: Benachrichtigungen (iPhone braucht dafür einen Service Worker).
// Bewusst KEIN Caching / kein fetch-Handler: Updates sollen wie bisher sofort ankommen.

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

// Push vom Server. Der tägliche Push kommt OHNE Inhalt → dann "Outfit des Tages".
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || '☀️ Dein Outfit des Tages', {
    body: data.body || 'Tippe, und StyleSync stellt dir ein Outfit für heute zusammen – passend zum Wetter.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'daily-outfit',
    data: { action: data.action || 'daily-outfit' }
  }));
});

// Tipp auf eine Benachrichtigung: App öffnen/nach vorne holen und sagen, was zu tun ist
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var action = (event.notification.data && event.notification.data.action) || null;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      var client = list[i];
      if ('focus' in client) {
        if (action) client.postMessage({ type: 'notification-action', action: action });
        return client.focus();
      }
    }
    return self.clients.openWindow('/' + (action ? '?action=' + encodeURIComponent(action) : ''));
  }));
});
