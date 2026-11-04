#!/usr/bin/env node
/**
 * Pushens service worker (/nav2/sw.js): varje notis bär navets märke.
 *
 *   node --experimental-strip-types tests/notis-sw.mjs
 *
 * Notisen ska se ut som notisen på startsidan (hubMark), inte som Clicknets
 * markör. Workern körs här i node:vm med falska self och fetch, och varje väg
 * till en notis provas: kalendern, repetitionen, kvällsnotisen och reserven när
 * nätet är borta. Bilderna läses som PNG: notisens bild är en rundad ruta med
 * genomskinliga hörn, och statusradens märke är vitt på genomskinligt, eftersom
 * Android bara läser alfakanalen (en färgad bild blir en vit fläck).
 */
import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const las = (p) => fs.readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)));
const kalla = las("public/nav2/sw.js").toString("utf8");
const BILD = "/nav2/ikon/notis-192.png", MARKE = "/nav2/ikon/notis-badge-96.png";

/** En ny worker. `svar` är adressens början -> JSON (eller "faller" för nätfel). */
function ny(svar = {}) {
  const lyssnare = new Map();
  const visade = [];
  const self = {
    addEventListener: (typ, fn) => lyssnare.set(typ, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => [], openWindow: async () => null },
    registration: {
      pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x" }) },
      showNotification: async (titel, o) => { visade.push({ titel, ...o }); },
    },
  };
  const fetchFalsk = async (url) => {
    const nyckel = Object.keys(svar).find((k) => String(url).startsWith(k));
    if (!nyckel || svar[nyckel] === "faller") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(svar[nyckel]), { status: 200, headers: { "content-type": "application/json" } });
  };
  vm.runInNewContext(kalla, { self, fetch: fetchFalsk, Response, URL, Promise, encodeURIComponent, console }, { filename: "sw.js" });
  return { lyssnare, visade };
}

async function push(w) {
  const vantar = [];
  w.lyssnare.get("push")({ waitUntil: (p) => vantar.push(p) });
  await Promise.all(vantar);
  return w.visade;
}

const navets = (n) => n && n.icon === BILD && n.badge === MARKE && n.lang === "sv";

console.log("\nVarje notis bär navets märke");
{
  const v = await push(ny({ "/nav2/kalender?push=": { notis: { id: 7, titel: "Simon bjöd in dig till “Veckomöte”", text: "mån 9 nov 10:00", url: "/nav2/notis?id=7&via=push" } } }));
  ok("kalendernotisen visas en gång", v.length === 1 && v[0].titel === "Simon bjöd in dig till “Veckomöte”" && v[0].body === "mån 9 nov 10:00");
  ok("kalendernotisen har navets bild och märke", navets(v[0]), JSON.stringify({ icon: v[0]?.icon, badge: v[0]?.badge }));
  ok("kalendernotisen behåller tagg och länk", v[0]?.tag === "nav-kal-7" && v[0]?.data?.url === "/nav2/notis?id=7&via=push" && v[0]?.data?.kal === true);
}
{
  const v = await push(ny({ "/nav2/kalender?push=": { notis: null }, "/nav2/utbildning?push=1": { rep: { titel: "Dags att repetera", text: "Tre frågor" } } }));
  ok("repetitionen har navets bild och märke", v.length === 1 && navets(v[0]) && v[0].tag === "nav-rep" && v[0].renotify === true);
}
{
  const v = await push(ny({ "/nav2/kalender?push=": { notis: null }, "/nav2/utbildning?push=1": { rep: null }, "/nav2/hem?kvall=1": { kvall: { titel: "Måndag: 4 möten", text: "1 borta" } } }));
  ok("kvällsnotisen har navets bild och märke", v.length === 1 && navets(v[0]) && v[0].titel === "Måndag: 4 möten" && v[0].tag === "nav-kvall");
}
{
  const v = await push(ny({ "/nav2/kalender?push=": "faller", "/nav2/utbildning?push=1": "faller", "/nav2/hem?kvall=1": "faller" }));
  ok("utan nät: reserven visas ändå, med navets bild och märke", v.length === 1 && v[0].titel === "Nav" && navets(v[0]));
}
ok("Clicknets markör används inte längre", !kalla.includes("clicknet-symbol"));
ok("ingen notis går förbi visa()", (kalla.match(/showNotification\(/g) || []).length === 1);

/* ---------- Bilderna ---------- */

/** Avkodar en 8-bitars RGBA-PNG utan radsprång till {b, h, px(x, y) -> [r, g, b, a]}. */
function png(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let o = 8, b = 0, h = 0, djup = 0, typ = 0, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), slag = buf.toString("ascii", o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (slag === "IHDR") { b = d.readUInt32BE(0); h = d.readUInt32BE(4); djup = d[8]; typ = d[9]; if (d[12]) return null; }
    if (slag === "IDAT") idat.push(d);
    o += 12 + len;
  }
  if (djup !== 8 || typ !== 6) return { b, h, rgba: false };
  const ra = zlib.inflateSync(Buffer.concat(idat)), rad = b * 4, ut = Buffer.alloc(rad * h);
  for (let y = 0; y < h; y++) {
    const f = ra[y * (rad + 1)];
    for (let x = 0; x < rad; x++) {
      const v = ra[y * (rad + 1) + 1 + x], a = x >= 4 ? ut[y * rad + x - 4] : 0, u = y ? ut[(y - 1) * rad + x] : 0, c = x >= 4 && y ? ut[(y - 1) * rad + x - 4] : 0;
      const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
      ut[y * rad + x] = (v + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 255;
    }
  }
  return { b, h, rgba: true, px: (x, y) => [...ut.subarray(y * rad + x * 4, y * rad + x * 4 + 4)] };
}

console.log("\nNotisens bild (hubMark)");
{
  const p = png(las(`public${BILD}`));
  ok("192 x 192, RGBA", p && p.b === 192 && p.h === 192 && p.rgba);
  if (p?.rgba) {
    ok("hörnen är genomskinliga (rundad ruta som på startsidan)", [[0, 0], [191, 0], [0, 191], [191, 191]].every(([x, y]) => p.px(x, y)[3] === 0));
    const [r, g, b, a] = p.px(96, 96);
    ok("mitten är navets punkt (--hub-signal)", a === 255 && Math.abs(r - 0xf2) < 6 && Math.abs(g - 0xb2) < 6 && Math.abs(b - 0x4c) < 6, `${r},${g},${b},${a}`);
    const [r2, g2, b2, a2] = p.px(96, 6);
    ok("kanten är navets botten (--hub)", a2 === 255 && Math.abs(r2 - 0x0f) < 6 && Math.abs(g2 - 0x2a) < 6 && Math.abs(b2 - 0x22) < 6, `${r2},${g2},${b2},${a2}`);
    const [r3, g3, b3] = p.px(96, 96 - 72);
    ok("ringen är --hub-brand", Math.abs(r3 - 0x4f) < 10 && Math.abs(g3 - 0xd1) < 10 && Math.abs(b3 - 0xa5) < 10, `${r3},${g3},${b3}`);
  }
}

console.log("\nStatusradens märke");
{
  const p = png(las(`public${MARKE}`));
  ok("96 x 96, RGBA", p && p.b === 96 && p.h === 96 && p.rgba);
  if (p?.rgba) {
    let farg = 0, synliga = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) { const [r, g, b, a] = p.px(x, y); if (a > 0) { synliga++; if (r < 250 || g < 250 || b < 250) farg++; } }
    ok("bara vitt där det syns (Android läser alfakanalen)", synliga > 0 && farg === 0, `${farg} färgade av ${synliga}`);
    ok("hörnen är genomskinliga", p.px(0, 0)[3] === 0 && p.px(95, 95)[3] === 0);
    ok("punkten i mitten är hel", p.px(48, 48)[3] === 255);
    ok("ringen är hel (radie 10 dp = 40 px)", [[48, 8], [88, 48], [48, 88], [8, 48]].every(([x, y]) => p.px(x, y)[3] === 255));
    ok("luft mellan ekrarna och ringen", p.px(48, 48 - 32)[3] === 0 && p.px(48, 48 + 32)[3] === 0);
  }
}

console.log("\nTelefonen får den nya workern när Nav öppnas");
{
  const html = las("src/nav2/utkast.html").toString("utf8");
  ok("utkastet uppdaterar /nav2/-registreringen vid start", html.includes("navigator.serviceWorker.getRegistration('/nav2/').then(r => { if (r && new URL(r.scope).pathname === '/nav2/') return r.update(); })"));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
