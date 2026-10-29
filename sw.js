// Service worker minimal : sert seulement aux notifications de l'appli installée (aucun cache hors ligne).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(c => (c.length ? c[0].focus() : self.clients.openWindow('/#carte'))));
});
