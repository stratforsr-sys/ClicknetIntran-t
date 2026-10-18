/* Nav 2.0: kvällsnotisen i mobilen (E5.8, migration 0121).
 *
 * Pushen kommer tom. Texten hämtas här, från /nav2/hem?kvall=1, med personens
 * egen inloggning: notisen räknas med samma behörighet och samma data som
 * startsidan, och ingenting om personalen passerar pushtjänsten.
 * Går inloggningen inte att använda (utloggad, nätet borta) visas en kort
 * notis som öppnar navet, så att pushen aldrig blir tyst. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let titel = 'Nav', text = 'Morgondagen i Nav. Tryck för att öppna.';
    try {
      const r = await fetch('/nav2/hem?kvall=1', {credentials:'include', cache:'no-store'});
      const s = r.ok ? await r.json() : null;
      if (s && s.kvall){ titel = s.kvall.titel; text = s.kvall.text; }
    } catch (_) {}
    await self.registration.showNotification(titel, {body:text, icon:'/clicknet-symbol.png', badge:'/clicknet-symbol.png', tag:'nav-kvall', renotify:true, data:{url:'/nav2'}});
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const fonster = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const nav = fonster.find(f => new URL(f.url).pathname.startsWith('/nav2'));
    if (nav) return nav.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/nav2');
  })());
});
