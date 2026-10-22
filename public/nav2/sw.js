/* Nav 2.0: kvällsnotisen i mobilen (E5.8, migration 0121).
 *
 * Pushen kommer tom. Texten hämtas här, från /nav2/hem?kvall=1, med personens
 * egen inloggning: notisen räknas med samma behörighet och samma data som
 * startsidan, och ingenting om personalen passerar pushtjänsten.
 * Går inloggningen inte att använda (utloggad, nätet borta) visas en kort
 * notis som öppnar navet, så att pushen aldrig blir tyst.
 *
 * Utbildning (0098): samma push bär påminnelsen om dagens repetition. Den
 * frågas först, /nav2/utbildning?push=1 svarar med texten om personens senaste
 * push i dag var repetitionens, annars null, och då är det kvällsnotisen.
 *
 * Kalendern (Kalendern som Outlook, del 10): allt i kalendern pushas, och det
 * frågas före allt annat. /nav2/kalender?push=<enhetens endpoint> svarar med
 * den äldsta kalendernotisen som den här enheten inte visat, en per push, eller
 * null. Varje notis har en egen tagg, så att två inbjudningar blir två notiser,
 * och trycket öppnar posten i Nav 2.0. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let titel = 'Nav', text = 'Morgondagen i Nav. Tryck för att öppna.';
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub){
        const r = await fetch('/nav2/kalender?push=' + encodeURIComponent(sub.endpoint), {credentials:'include', cache:'no-store'});
        const s = r.ok ? await r.json() : null;
        if (s && s.notis){
          await self.registration.showNotification(s.notis.titel, {body:s.notis.text, icon:'/clicknet-symbol.png', badge:'/clicknet-symbol.png', tag:'nav-kal-' + s.notis.id, data:{url:s.notis.url, kal:true}});
          return;
        }
      }
    } catch (_) {}
    try {
      const r = await fetch('/nav2/utbildning?push=1', {credentials:'include', cache:'no-store'});
      const s = r.ok ? await r.json() : null;
      if (s && s.rep){
        await self.registration.showNotification(s.rep.titel, {body:s.rep.text, icon:'/clicknet-symbol.png', badge:'/clicknet-symbol.png', tag:'nav-rep', renotify:true, data:{url:'/nav2?till=/utbildning'}});
        return;
      }
    } catch (_) {}
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
    const url = (e.notification.data && e.notification.data.url) || '/nav2';
    // En kalendernotis öppnar sin post också i en flik som redan är öppen.
    if (nav && e.notification.data && e.notification.data.kal && nav.navigate) { try { const w = await nav.navigate(url); if (w) return w.focus(); } catch (_) {} }
    if (nav) return nav.focus();
    return self.clients.openWindow(url);
  })());
});
