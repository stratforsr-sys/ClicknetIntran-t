/* Nav 2.0: appens service worker (appen, uppgift 4).
 *
 * Sidan /nav2 (utan snedstreck) ligger utanför pushens räckvidd /nav2/, så
 * ingen worker kontrollerar den, och utan nät får man webbläsarens felsida.
 * Pushen flyttas inte (byts registreringen tappas alla enheters prenumerationer),
 * så sajten har en andra worker, med räckvidd /, som bara gör en sak:
 * när en NAVIGERING misslyckas på nätet svarar den med en egen offline-sida.
 *
 * Den kontrollerar hela sajten, också nuvarande Nav, och rör därför inget annat:
 * inte fetch, POST, skript eller bilder, och inte ett svar från nätet, vilket
 * som helst (en 500 är nätets svar). Vyernas egna felbesked gäller som förut.
 * Ingen push-hanterare här: pushen bor i /nav2/sw.js.
 *
 * Cachen innehåller bara typsnitten, så att offline-sidan får sitt utseende.
 * Offline-sidan byggs här i filen och har ingen data om någon. */
const CACHE = 'nav-app-1';
const TYPSNITT = ['/nav2/fonts/geist.woff2', '/nav2/fonts/bricolage.woff2'];

/* Bricolage och Geist hämtas ur cachen av sidans eget skript: en @font-face mot
 * /nav2/fonts/ går via nätet förbi workern (den rör bara navigeringar) och
 * fallerar utan nät. Systemtypsnitten i CSS:en är reserven. "Försök igen"
 * har href="" och laddar alltså om sidans egen adress, utan att den skrivs in. */
const OFFLINE = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nav behöver nätet</title>
<style>
html,body{margin:0;height:100%}
body{background:#EEF1EC;color:#13201C;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.g{font-family:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:360px}
h1{margin:0 0 12px;font:600 28px/1.15 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em}
.b h1{font-family:"Bricolage Grotesque",system-ui,-apple-system,"Segoe UI",sans-serif}
p{margin:0 0 20px}
a{color:inherit;font-weight:600;text-underline-offset:3px}
</style>
</head>
<body>
<main>
<h1>Nav behöver nätet</h1>
<p>Det du har sparat finns kvar. Nav laddar om sig själv när telefonen är uppkopplad igen.</p>
<a href="">Försök igen</a>
</main>
<script>
addEventListener('online', function () { location.reload(); });
(async function () {
  try {
    var c = await caches.open('nav-app-1');
    var kallor = [['Bricolage Grotesque', '/nav2/fonts/bricolage.woff2', 'b'], ['Geist', '/nav2/fonts/geist.woff2', 'g']];
    for (var i = 0; i < kallor.length; i++) {
      var r = await c.match(kallor[i][1]);
      if (!r) continue;
      var f = new FontFace(kallor[i][0], await r.arrayBuffer());
      await f.load();
      document.fonts.add(f);
      document.body.classList.add(kallor[i][2]);
    }
  } catch (e) { /* systemtypsnittet står kvar */ }
})();
</script>
</body>
</html>`;

function offline() {
  return new Response(OFFLINE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* Förladdar typsnitten. Ett svar som inte är typsnittet cachas aldrig: en
 * inloggad med väntande steg två får 307 till /logga-in/verifiera även här,
 * därför redirect:'error' och ok-kontrollen. Ett typsnitt som misslyckas
 * fäller aldrig installationen, offline-sidan klarar sig med systemtypsnitt. */
async function forladda() {
  try {
    const cache = await caches.open(CACHE);
    for (const url of TYPSNITT) {
      try {
        const res = await fetch(url, { redirect: 'error' });
        if (res.ok && !res.redirected) await cache.put(url, res);
      } catch (e) { /* nästa typsnitt */ }
    }
  } catch (e) { /* ingen cache, ingen förladdning */ }
}

self.addEventListener('install', e => {
  e.waitUntil(forladda().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try {
      const namn = await caches.keys();
      await Promise.all(namn.filter(n => n.startsWith('nav-app-') && n !== CACHE).map(n => caches.delete(n)));
    } catch (e) { /* gamla cacher får ligga kvar */ }
    /* Navigation preload: nätet frågas medan workern startar, i stället för efter. */
    try {
      if (self.registration && self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    } catch (e) { /* utan förhämtning hämtas sidan som förut */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      return (await e.preloadResponse) || (await fetch(e.request));
    } catch (err) {
      return offline();
    }
  })());
});
