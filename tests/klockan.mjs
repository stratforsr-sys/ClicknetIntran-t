#!/usr/bin/env node
/**
 * Klockan i Nav 2.0 visar bara det du inte sett (beställaren 2026-11-13).
 *
 *   node --experimental-strip-types tests/klockan.mjs
 *
 * Tre delar:
 *   1. Reglerna (notiser.ts): urvalet är bara det olästa, id:na som får
 *      avfärdas, och gränsen "Rensa alla" sätter.
 *   2. Servern: rutten avfärdar det som öppnas (klocka, push, mejl), rensar och
 *      ångrar; datan ger sidan `klockan` och en del att hämta om.
 *   3. Sidan: raden försvinner när den öppnas, Rensa alla, ×, svep, Ångra och
 *      telefonens notislista. Källan läses, som i tests/notislankar.mjs.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MAX_NOTISER, arKlockId, klockansUrval, notisId, rensningsgrans } from "../src/lib/notiser.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const las = (p) => fs.readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const UUID = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const post = (id, tidpunkt, olast) => ({ id, typ: "order", rubrik: id, detalj: "", href: "/order", tidpunkt, olast });

console.log("\n\x1b[1mUrvalet: bara det du inte sett\x1b[0m");
{
  const alla = [
    post("order-godkand-3", "2026-11-13T10:00:00Z", true),
    post("order-godkand-2", "2026-11-12T10:00:00Z", true),
    post("order-godkand-1", "2026-11-01T10:00:00Z", false),
  ];
  const { notiser, totalt } = klockansUrval(alla);
  ok("en läst rad står inte kvar", !notiser.some((n) => n.id === "order-godkand-1"));
  ok("de olästa står kvar i samma ordning", notiser.map((n) => n.id).join() === "order-godkand-3,order-godkand-2");
  ok("totalt räknar de olästa", totalt === 2);

  const manga = Array.from({ length: 80 }, (_, i) => post(`order-godkand-${i}`, new Date(Date.UTC(2026, 10, 13, 0, 80 - i)).toISOString(), true));
  const k = klockansUrval(manga);
  ok(`högst ${MAX_NOTISER} rader`, k.notiser.length === MAX_NOTISER);
  ok("men totalt säger att 80 väntar", k.totalt === 80, "siffran på klockan ljuger inte om det som inte får plats");
  ok("tom klocka", klockansUrval([]).totalt === 0 && klockansUrval([]).notiser.length === 0);
}

console.log("\n\x1b[1mId:t som får avfärdas\x1b[0m");
{
  ok("en notis i navet", arKlockId(notisId("order-godkand", 123)));
  ok("en härledd post", arKlockId(notisId("rutin", UUID, 3)));
  ok("nyheternas kvittens i sidan", arKlockId(`nav2-nhl-kv-${UUID}`));
  ok("chefens rad om kvittenserna", arKlockId(`nav2-nhl-ch-${UUID}`));
  ok("rekryteringens läge", arKlockId(`nav2-rxl-svar-${UUID}`));
  ok("ett påhittat läge avvisas", !arKlockId(`nav2-xyz-${UUID}`));
  ok("prefixet ensamt avvisas", !arKlockId("nav2-nhl-"));
  ok("skräp avvisas", !arKlockId("<script>") && !arKlockId("") && !arKlockId(42) && !arKlockId(null));
  ok("en okänd källa avvisas", !arKlockId("hittepa-123"));
  ok("för långt avvisas", !arKlockId(`nav2-nhl-${"a".repeat(200)}`));
}

console.log("\n\x1b[1mGränsen för Rensa alla\x1b[0m");
{
  const nu = new Date("2026-11-13T12:00:00Z");
  ok("första gången: gränsen blir den nyaste raden", rensningsgrans("2026-11-13T11:00:00Z", null, nu) === "2026-11-13T11:00:00.000Z");
  ok("framåt", rensningsgrans("2026-11-13T11:00:00Z", "2026-11-01T00:00:00Z", nu) === "2026-11-13T11:00:00.000Z");
  ok("aldrig bakåt", rensningsgrans("2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z", nu) === null,
    "en enhet med gammal data får inte väcka det en annan rensat");
  ok("samma gräns igen ändrar inget", rensningsgrans("2026-11-10T00:00:00.000Z", "2026-11-10T00:00:00Z", nu) === null);
  ok("aldrig förbi nu", rensningsgrans("2027-01-01T00:00:00Z", null, nu) === nu.toISOString(),
    "en klocka som går fel får inte dölja det som inte hänt");
  ok("ingen rad med tid: gränsen står kvar", rensningsgrans(null, "2026-11-10T00:00:00Z", nu) === null);
  ok("skräp: gränsen står kvar", rensningsgrans("i går", null, nu) === null && rensningsgrans(123, null, nu) === null);
}

console.log("\n\x1b[1mServern\x1b[0m");
{
  const rutt = las("src/app/nav2/notis/route.ts");
  const server = las("src/lib/notiser-server.ts");
  const data = las("src/lib/nav2/data.ts");
  ok("öppnad är sedd: GET och POST avfärdar notisraden", /avfardaNotis\(mig, notisId\(data\.kalla as Notiskalla, String\(data\.id\)\)\)/.test(rutt) && /select\("id, href, opened_at, kalla"\)/.test(rutt));
  ok("POST avfärdar en rad som inte är en händelse", /arKlockId\(b\.notis\) \? avfardaNotis\(mig, b\.notis\)/.test(rutt));
  ok("Rensa alla och Ångra", /rensaKlockan\(mig, klockIds\(b\.rensa\.ids\), b\.rensa\.till\)/.test(rutt) && /angraRensning\(mig, klockIds\(b\.angra\.ids\)/.test(rutt));
  ok("id:na provas och kapas", /v\.filter\(arKlockId\)/.test(rutt) && /slice\(0, MAX_RENSA\)/.test(rutt));
  ok("bara samma ursprung skriver", /if \(!sammaUrsprung\(request\)\) return new NextResponse\(null, \{ status: 403 \}\)/.test(rutt));
  ok("gränsen flyttas bara framåt (rensningsgrans)", /const satt = rensningsgrans\(till, forra\)/.test(server));
  ok("Ångra rör bara gränsen den själv satte", /\.eq\("seen_at", satt\)/.test(server));
  ok("gamla navets klocka får samma lista som förut", /return \(await allaNotiser\(user\)\)\.kvar\.slice\(0, MAX_NOTISER\)/.test(server));
  ok("Nav2Data har klockan", /^\s{2}klockan: Klockan\["klockan"\];/m.test(data));
  ok("delen klockan ger notiser och klockan i en körning", /klockan: \(_s: Supabase, u: CurrentUser\) => hamtaKlockan\(u\)/.test(data) && /d === "grund" \|\| d === "klockan"/.test(data));
}

console.log("\n\x1b[1mSidan\x1b[0m");
{
  const html = las("src/nav2/utkast.html");
  ok("raden rensas när den öppnas", /function klOppnad\(id\)/.test(html) && /klOppnad\(g\.dataset\.bellgo\)/.test(html));
  ok("rensningen läggs efter utkastets klick, som letar upp raden", /setTimeout\(\(\) => \{ KL\.bort\.add\(id\); klSiffror\(\);/.test(html));
  ok("det rensade syns inte", /return p\.filter\(x => !KL\.bort\.has\(x\.id\)\)/.test(html));
  ok("Rensa alla ersätter Markera alla som lästa", /data-bellrensa>Rensa alla</.test(html) && /function klRensaAlla\(\)/.test(html));
  ok("Rensa alla har Ångra och lägger tillbaka gränsen", /angra:\{ids:server, forra:s\.forra, satt:s\.satt\}/.test(html));
  ok("ett nej från servern lägger tillbaka raderna", /if \(!\(await svar\)\)\{ tillbaka\(\); if \(kvitto\) kvitto\.remove\(\); toast\('Klockan gick inte att rensa/.test(html));
  ok("× och Delete rensar en rad, med Ångra", /data-bellx=/.test(html) && /e\.key !== 'Delete' && e\.key !== 'Backspace'/.test(html) && /toast\('Notisen rensad\.'/.test(html));
  ok("svep i sidled på pekskärm", /touch-action:pan-y/.test(html) && /function klSlapp\(e\)/.test(html));
  ok("klicket efter ett svep öppnar inget", /KL\.svepKlick = false; e\.stopPropagation\(\); e\.preventDefault\(\);/.test(html));
  ok("telefonens notislista följer med", /getRegistration\('\/nav2\/'\)/.test(html) && /\^nav-kal-\(\\d\+\)\$/.test(html));
  ok("siffran räknar det som väntar under de 25", /return ND && ND\.klockan \? n \+ klOver\(\) : n;/.test(html));
  ok("klockan hålls färsk", /fetch\('\/nav2\/data\?delar=klockan'/.test(html) && /visibilitychange/.test(html));
  ok("rörelse respekterar prefers-reduced-motion", /prefers-reduced-motion:reduce\)\{\.kl-r/.test(html) && /function klLugn\(\)|const klLugn = /.test(html));
  ok("Ångra i kvittot stänger inte klockan", /e\.composedPath\(\)\.some\(n => n\.id === 'toasts'\)/.test(html));
  ok("rutan stannar på en telefons skärm", /innerWidth - el\.offsetWidth - 8/.test(html));
  ok("raderna krymper inte i en lång lista", /\.kl-r\{position:relative;flex:none;/.test(html));
  ok("demot är orört", /if \(ND && ND\.klockan\) return klHtml\(poster\);/.test(html) && /data-bellalla>Markera alla som lästa/.test(html));
  const sw = las("public/nav2/sw.js");
  ok("pushens tagg är den sidan stänger", /tag:'nav-kal-' \+ s\.notis\.id/.test(sw));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
