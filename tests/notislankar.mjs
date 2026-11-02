#!/usr/bin/env node
/**
 * Varje notis går exakt dit den kommer ifrån (beställaren 2026-11-01: "inte
 * bara ordernotis utan alla notiser ska gå exakt dit notisen kommer ifrån").
 *
 *   node tests/notislankar.mjs
 *
 * Provet läser varje anrop till `notifiera`, `notifieraFlera` och
 * `notifieraFranUtkorgen` i src/ och faller när länken bara är en vy
 * ("/order", "/tid", "/", "/nav2") utan att sorten står i UNDANTAG med ett
 * skäl. En ny notis som länkar till listan i stället för posten fälls alltså
 * här, inte av den som letar efter ordern.
 *
 * Det provar också kalenderns mallar (`notistext` i leveranskalender.ts), och
 * att Nav 2.0:s länkväxel (`ndGa` i utkast.html) har en väg för varje sorts
 * adress som notiserna skriver.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/**
 * Sorter som med flit länkar till en vy, och varför. Nyckeln är källa + länk:
 * samma källa kan ha en exakt länk på ett ställe och en vy på ett annat.
 */
const UNDANTAG = {
  'order-makulerad "/order"': "ordern är raderad (radera_order) och finns inte att öppna",
  'avtal-tillbakadraget "/avtal"': "avtalet går inte att läsa för den anställda när det dragits tillbaka (contract_read)",
  'franvaro-saldo "/franvaro"': "saldot står överst i ens egen Frånvaro",
  'sjuk-installd "/franvaro"': "anmälan räknas inte längre; dagarna registreras på nytt i Frånvaro",
  'konto-aktiverad "/"': "hela navet öppnas för den som fått kontot aktiverat",
  'coachning-ovning "/coachning"': "säljarens egen coachningssida, där dagens övning står",
  'coachning-rad "/coachning"': "säljarens egen coachningssida, där raden från chefen står",
  'rekrytering-tips-be "/rekrytering"': "tipsformuläret är säljarens sida i Rekrytering",
  'rutin-arkiverad "/rutiner"': "rutinen är arkiverad och visas inte längre för någon",
  'tid-ostamplad "/tid"': "chefens fråga gäller i dag, och Tid öppnar dagen",
  'tid-fraga "/tid"': "chefens fråga gäller i dag, och Tid öppnar dagen",
  'utkorg-fel "/fel"': "utkorgens fel har ingen egen rapport att öppna",
  'inkio-bevakning "/fel"': "bevakningen som står still har ingen egen rapport att öppna; larmet säger hur länge",
  'personal-uppdrag "/"': "faddern har ingen egen plats i navet; Anställda är chefens vy",
  'personal-paminn "/utbildning"': "påminnelsen gäller alla kurser och rutiner som är kvar, och Utbildning visar dem först",
};

// --- Alla anrop -------------------------------------------------------------

function filer(d, ut = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) filer(p, ut);
    else if (/\.(ts|tsx)$/.test(f)) ut.push(p);
  }
  return ut;
}

const anrop = [];
for (const p of filer(join(rot, "src"))) {
  if (p.endsWith("notishandelse-server.ts")) continue;
  const t = readFileSync(p, "utf8");
  const re = /\b(notifiera|notifieraFlera|notifieraFranUtkorgen|notifieraSenare)\(/g;
  let m;
  while ((m = re.exec(t))) {
    // Argumentet med balanserade parenteser.
    let i = m.index + m[0].length, djup = 1;
    while (i < t.length && djup) { if (t[i] === "(") djup++; else if (t[i] === ")") djup--; i++; }
    const arg = t.slice(m.index + m[0].length, i - 1);
    const kalla = /kalla:\s*"([a-z0-9-]+)"/.exec(arg)?.[1] ?? null;
    const href = /href:\s*((?:`[^`]*`)|(?:"[^"]*")|(?:[^,}\n]+))/.exec(arg)?.[1]?.trim() ?? null;
    if (!kalla && !href) continue; // en kommentar eller en signatur
    anrop.push({ fil: p.slice(rot.length + 1), rad: t.slice(0, m.index).split("\n").length, kalla, href });
  }
}

rubrik(`Varje notis länkar till sin post (${anrop.length} anrop)`);
ok("provet hittar anropen", anrop.length > 100, String(anrop.length));
// En länk som bara är en vy: "/", "/nav2" eller ett enda led utan fråga.
// "/profil" är ens egen profil och räknas som posten.
const barVy = (h) => (/^"\/([a-z0-9-]+)?"$/.test(h) && h !== '"/profil"') || h === '"/nav2"';
const traffar = [];
for (const a of anrop) {
  if (!a.href) continue;
  if (!barVy(a.href)) continue;
  const nyckel = `${a.kalla} ${a.href}`;
  if (UNDANTAG[nyckel]) continue;
  traffar.push(`${a.fil}:${a.rad} ${nyckel}`);
}
ok("ingen notis länkar bara till en vy utan skäl", traffar.length === 0, traffar.join("\n      "));
ok('ingen notis länkar till "/nav2" (sidan laddas om i stället för att öppna något)', !anrop.some((a) => a.href === '"/nav2"'));
const anvanda = new Set(anrop.filter((a) => a.href && barVy(a.href)).map((a) => `${a.kalla} ${a.href}`));
const gamla = Object.keys(UNDANTAG).filter((k) => !anvanda.has(k));
ok("varje undantag används fortfarande", gamla.length === 0, gamla.join(", "));

rubrik("Sorterna som pekade på listan länkar nu till posten");
const lank = (kalla) => anrop.filter((a) => a.kalla === kalla).map((a) => a.href ?? "");
const alla = (kalla, monster) => { const l = lank(kalla); return l.length > 0 && l.every((h) => monster.test(h)); };
for (const k of ["order-inskickad", "order-godkand", "order-rattad", "order-returnerad", "order-betald", "order-grattis", "order-overtack"])
  ok(`${k} → /order/<id>`, alla(k, /^`\/order\/\$\{/), lank(k).join(" "));
ok("order-makulerad → /order/<id> när ordern finns kvar", lank("order-makulerad").some((h) => /^`\/order\/\$\{/.test(h)));
ok("kampanjsidan → kundens kort", alla("kampanjsida-uppe", /^`\/order\/kund\//) && alla("kampanjsida-nere", /^`\/order\/kund\//));
ok("Inkio och kundanteckningen → kundens kort (Aktivitet)", alla("order-anteckning", /^`\/order\/kund\//) && lank(null).some((h) => /^`\/order\/kund\/\$\{encodeURIComponent\(org\)\}`$/.test(h)));
ok("provision-bonus och provision-mal → månaden", alla("provision-bonus", /^`\/provision\/manad\//) && alla("provision-mal", /^`\/provision\/manad\//));
ok("franvaro-havd → månaden där trappan räknas om", alla("franvaro-havd", /^`\/provision\/manad\//));
ok("tid-rattelse → chefens Att göra med raden", alla("tid-rattelse", /^`\/tid\/gora\/\$\{/));
ok("tid-rattelse-beslut, tid-be-ratta och tid-avvikelse-avslutad → dagen", ["tid-rattelse-beslut", "tid-be-ratta", "tid-avvikelse-avslutad"].every((k) => alla(k, /^`\/tid\?dag=/)));
ok("tid-chef-morgon och tid-chef-kvar → Att göra", alla("tid-chef-morgon", /^"\/tid\/gora"$/) && alla("tid-chef-kvar", /^"\/tid\/gora"$/));
ok("sjukanmälan (bekräftad, avslutad, anteckning) → anmälan", ["sjuk-bekraftad", "sjuk-avslutad", "sjuk-anteckning"].every((k) => alla(k, /^`\/franvaro\/sjuk\/\$\{/)));
ok("frånvaro (tillbakadragen, registrerad, annan period) → ansökan", ["franvaro-tillbakadragen", "franvaro-registrerad", "franvaro-annan-period"].every((k) => alla(k, /^`\/franvaro\/\$\{/)));
ok("fel-lagad och fel-meddelande → rapporten", alla("fel-lagad", /^`\/fel\/\$\{/) && alla("fel-meddelande", /^`\/fel\/\$\{/));
ok("mote-bokat → mötet", alla("mote-bokat", /^`\/moten\/\$\{/));
ok("konto-roll, konto-organisation och konto-behorighet → profilen", ["konto-roll", "konto-organisation", "konto-behorighet"].every((k) => alla(k, /^"\/profil"$/)));
ok("utbildning-fraga → föreläsningen", alla("utbildning-fraga", /^`\/utbildning\/forelasning\/\$\{/));
ok("utbildning-repetition → repetitionen", alla("utbildning-repetition", /^"\/utbildning\/repetition"$/));
ok("prov-rattat → kursen", alla("prov-rattat", /^kurs\?\.slug \? `\/utbildning\/\$\{kurs\.slug/));
ok("kalender-delad och kalender-aterkallad → kollegans kalender", alla("kalender-delad", /^`\/kalender\?vem=/) && alla("kalender-aterkallad", /^`\/kalender\?vem=/));

rubrik("Kalenderns mallar (notistext)");
const lev = readFileSync(join(rot, "src/lib/leveranskalender.ts"), "utf8");
const mallar = lev.slice(lev.indexOf("export function notistext("));
const kropp = mallar.slice(0, mallar.indexOf("\n}\n"));
ok("ingen mall länkar till bara /kalender", !/href:\s*"\/kalender"/.test(kropp), (kropp.match(/href:\s*"\/kalender"[^\n]*/g) ?? []).join(" | "));
ok("inställt möte → dagen", /ställde in \$\{t\}`, detalj: nar, href: `\/kalender\?dag=\$\{nyDag\}`/.test(kropp));
ok("leveranskön → kön med kundens order", /const kon = `\/kalender\?ko=1/.test(kropp) && (kropp.match(/href: kon/g) ?? []).length === 2);

rubrik("Nav 2.0 har en väg för varje sorts adress");
const html = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");
const vaxel = html.slice(html.indexOf("const _skalNdGa = ndGa;"), html.indexOf("// Vyer som inte är kopplade ritas aldrig"));
const vagar = [
  ["/order/<id>", /case 'order':[^\n]*String\(x\.id\) === sub/],
  ["/order/kund/<org>", /sub === 'kund' && d\[2\] && !d\[3\]\)\{ ndOrdGaKund/],
  ["/provision/manad/<YYYY-MM>", /sub === 'manad'[^\n]*ndPvGaManad\(d\[2\]\)/],
  ["/tid/gora[/<id>]", /sub === 'gora' && !d\[3\]\)\{ ndTidGaGora/],
  ["/tid?dag= och ?vecka=", /ndTidGaDag\(q\.get\('dag'\), q\.get\('vecka'\)\)/],
  ["/tid/avvikelser?vem=", /sub === 'avvikelser' && !d\[2\] && q\.get\('vem'\)/],
  ["/franvaro/sjuk/<id>", /sub === 'sjuk' && NDUUID\.test\(d\[2\]/],
  ["/franvaro/ny/<typ>", /sub === 'ny' && \/\^\[a-z_\]\+\$\/\.test\(d\[2\]/],
  ["/fel/<id>", /NDUUID\.test\(sub \|\| ''\) && !d\[2\]\)\{ ndFelGaRapport/],
  ["/moten/<id>", /case 'moten': if \(sub && !d\[2\]\)\{ ndMoGaMote/],
  ["/avtal/<id>", /case 'avtal': \{ if \(NDUUID\.test\(sub/],
  ["/utbildning/repetition, /forelasning/<id>, /rollspel/<id>", /ndUtbGaNotis\(d\) \|\| ndUtbGa\(d\)/],
  ["/kalender?vem=", /q\.get\('vem'\), p = vem && kPers\(\)/],
  ["/kalender?ko=1&order=", /if \(q\.get\('ko'\)\)/],
];
for (const [namn, r] of vagar) ok(namn, r.test(vaxel));
ok("klockan bokför öppningen (/nav2/notis)", /n && n\.handelseId\) ndNotisOppnad\(n\.handelseId\)/.test(html) && /fetch\('\/nav2\/notis'/.test(html));

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
