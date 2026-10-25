/**
 * Säljtavlans vy som ren logik: format, flödets tider, målkortets rader, strecken,
 * grafens geometri, kompositionernas tider och kurvor, och omladdningens regler.
 * Kör: TZ=UTC node --experimental-strip-types tests/salesboard-tavla.mjs
 */
import { readFileSync } from "node:fs";
import {
  RULL,
  byggomladdning,
  flodeTid,
  grafPlan,
  jakten,
  kronor,
  matarRader,
  matarText,
  nattomladdning,
  ordtal,
  pixelskift,
  snitt,
  streck,
  taggText,
  tkr,
} from "../src/app/salesboard/vy.ts";
import { CHING, KRYMP, MALET_VANTA, STOR_D, STOR_VILA, VANLIG_VILA, landar, maletLjud, orderLjud, orderTider, serieLjud, serieTider, siffror, vanligL } from "../src/app/salesboard/motion/tider.ts";
import { STD, UT, farg, fjader, ip, skalaMix } from "../src/app/salesboard/motion/kurvor.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const nara = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const H = " ";

console.log("\nFormat och texter");
{
  ok("kronor med hårt mellanrum", kronor(17940) === `17${H}940${H}kr`);
  ok("tusental", tkr(562_400) === `562${H}tkr`);
  ok("ordningstal", ["1:a", "2:a", "3:e", "11:e", "12:e", "21:a", "22:a", "101:a"].join() === [1, 2, 3, 11, 12, 21, 22, 101].map(ordtal).join());
  ok("snittet avrundas till hundratal, och noll utan order", snitt(434_400, 24) === 18_100 && snitt(5, 0) === 0);
  ok("flödet: i dag klockslaget", flodeTid("2026-10-23T11:58:00Z", "2026-10-23") === "13:58");
  ok("i går", flodeTid("2026-10-22T10:00:00Z", "2026-10-23") === "i går");
  ok("inom en vecka veckodagen", flodeTid("2026-10-20T10:00:00Z", "2026-10-23") === "tis");
  ok("äldre datumet", flodeTid("2026-10-09T10:00:00Z", "2026-10-23") === `9${H}okt`);
  ok("taggarna", taggText({ typ: "dagsrekord", nu: 6, forra: 5 }).text === "6 order i dag (förra 5)" && taggText({ typ: "personbasta", antal: 3 }).fet === "Personbästa");
}

console.log("\nMålkortet");
{
  const bas = { varde: 434_400, mal: 550_000, forvantat: 425_000, prognos: 562_000, natt: null, dagarKvar: 0, snitt: 0 };
  const fore = matarRader(bas);
  ok("före takten i mint", fore.status === `9${H}400${H}kr före takten` && fore.bra && !fore.natt, fore.status);
  ok("kvar och prognos", JSON.stringify(fore.fakta) === JSON.stringify([{ fet: `115${H}600${H}kr`, text: "kvar" }, { fet: `562${H}tkr`, text: "Prognos", fetSist: true }]));
  const efter = matarRader({ ...bas, forvantat: 450_000 });
  ok("efter takten utan röd färg, med text", efter.status === `15${H}600${H}kr efter takten` && !efter.bra);
  ok("inom hundra kronor är i takt", matarRader({ ...bas, forvantat: 434_360 }).status === "I takt");
  const natt = matarRader({ ...bas, varde: 560_000, natt: "2026-10-23T12:31:00Z" });
  ok("målet nått: datum och över", natt.status === "Målet nått" && natt.natt && JSON.stringify(natt.fakta).includes(`+10${H}000${H}kr`) && natt.fakta[0].fet === `23${H}okt`);
  const utan = matarRader({ ...bas, mal: null });
  ok("utan mål ingen status, och en rad som säger det", utan.status === null && utan.fakta[0].fet === "Inget mål");
  ok("utan prognos (före arbetsdag tre) står bara kvar", matarRader({ ...bas, prognos: null }).fakta.length === 1);
  const takt = matarRader({ ...bas, dagarKvar: 6, snitt: 18_100 });
  ok("kvar räknas i order på lagets snitt, uppåt", takt.fakta[0].text === `kvar · ≈${H}7 order`, takt.fakta[0].text);
  ok("och per arbetsdag, uppåt till hundratal", takt.fakta[1].fet === `19${H}300${H}kr` && takt.fakta[1].text === "per arbetsdag", takt.fakta[1].fet);
  ok("sista arbetsdagen visar inget per dag", !matarRader({ ...bas, dagarKvar: 1, snitt: 18_100 }).fakta.some((d) => d.text === "per arbetsdag"));
  ok("raden byter först när talet landat (R31)", matarText(bas, { ...bas, varde: 560_000 }, RULL - 1).status === fore.status && matarText(bas, { ...bas, varde: 560_000 }, RULL).status === "Målet nått");
}

console.log("\nTopplistans jakt");
{
  const rader = [
    { person: "a", antal: 9, varde: 160_000 },
    { person: "b", antal: 8, varde: 120_000 },
    { person: "c", antal: 7, varde: 117_400 },
    { person: "d", antal: 0, varde: 0 },
  ];
  const j = jakten(rader, "varde", 18_100);
  ok("närmast platsen ovanför, i kronor", j?.person === "c" && j.text === `2${H}600${H}kr till 2:a`, j?.text);
  ok("ingen jakt när avståndet är större än en snittorder", jakten(rader.slice(0, 2), "varde", 18_100) === null);
  ok("efter antal: en order bort, högst upp först", jakten(rader, "antal", 18_100)?.text === "1 order till 1:a");
  ok("den som inte sålt jagar inte", jakten([{ person: "a", antal: 1, varde: 100 }, { person: "b", antal: 0, varde: 0 }], "antal", 100) === null);
}

console.log("\nStrecken");
{
  ok("noll streck har ingen bredd", streck(0).linjer.length === 0 && streck(0).bredd === 0);
  ok("fyra lodräta", streck(4).linjer.every((l) => l.x1 === l.x2) && streck(4).bredd === 32);
  const fem = streck(5).linjer[4];
  ok("det femte går snett över de fyra", fem.x1 < fem.x2 && fem.y1 > fem.y2);
  ok("det sjätte börjar en ny grupp", streck(6).linjer[5].x1 === 46 && streck(6).bredd === 78);
}

console.log("\nGrafen");
{
  const historik = [318400, 402100, 268900, 451300, 590200, 498700, 541600, 372800, 214500, 489300, 627400].map((v, i) => ({ nyckel: `m${i}`, namn: `m${i}`, antal: 20, varde: v, mal: i === 8 ? 280_000 : 520_000 }));
  const hog = grafPlan({ W: 660, H: 300, historik, nu: { namn: "okt", varde: 434_400, mal: 550_000, antal: 24, prognos: 562_000 } });
  ok("tolv staplar, månaden sist", hog.staplar.length === 12 && hog.staplar[11].nu && hog.staplar[11].klass === "nu-r");
  ok("skalan går till 700 tkr i steg om 100", hog.linjer.length === 8 && hog.linjer.at(-1).etikett === "700", hog.linjer.map((l) => l.etikett).join(","));
  const lag = grafPlan({ W: 660, H: 160, historik, nu: { namn: "okt", varde: 434_400, mal: 550_000, antal: 24, prognos: 562_000 } });
  ok("en låg graf har varannan linje: steg om 200", lag.linjer.map((l) => l.etikett).join(",") === "0,200,400,600", lag.linjer.map((l) => l.etikett).join(","));
  ok("en månad över målet är mint, under är dov", hog.staplar[10].klass === "natt-r" && hog.staplar[0].klass === "under-r");
  ok("prognosen syns över månadens stapel", hog.staplar[11].prognosY !== null && hog.staplar[11].prognosY < hog.staplar[11].y0 - hog.staplar[11].h);
  const natt = grafPlan({ W: 660, H: 300, historik, nu: { namn: "okt", varde: 600_000, mal: 550_000, antal: 30, prognos: 700_000 } });
  ok("ingen prognos när målet är nått", natt.staplar[11].prognosY === null);
  const utan = grafPlan({ W: 660, H: 300, historik: historik.map((m) => ({ ...m, mal: null })), nu: { namn: "okt", varde: 30_000, mal: null, antal: 2, prognos: null } });
  ok("utan mål inget målstreck", utan.staplar.every((s) => s.malY === null));
  const liten = grafPlan({ W: 660, H: 300, historik: historik.map((m) => ({ ...m, varde: 0, mal: null })), nu: { namn: "okt", varde: 17_940, mal: null, antal: 1, prognos: null } });
  ok("en liten månad får en egen skala", liten.linjer.at(-1).etikett === "20" || liten.linjer.at(-1).etikett === "19", liten.linjer.map((l) => l.etikett).join(","));
  ok("rekordmånaden är den bästa av de tolv", hog.staplar.filter((s) => s.rekord).length === 1 && hog.staplar[10].rekord);
  ok("slår månaden rekordet bär den märket", natt.staplar.filter((s) => s.rekord).length === 1 && grafPlan({ W: 660, H: 300, historik, nu: { namn: "okt", varde: 700_000, mal: 550_000, antal: 30, prognos: null } }).staplar[11].rekord);
  ok("utan tre månader med värde inget rekord", liten.staplar.every((s) => !s.rekord));
  ok("verktygstipset har värde, mål och antal", hog.staplar[0].titel === `m0: 318${H}400${H}kr av 520${H}000${H}kr · 20 order`, hog.staplar[0].titel);
}

console.log("\nKompositionernas tider (prototypen v5)");
{
  ok("räkneverket: fem siffror landar på bild 38, värdet på 88", siffror(18_900) === 5 && landar(5) === 38 && vanligL(18_900) === 88);
  const v = orderLjud("vanlig", 18_900);
  ok("kassans ching (0,40 s in) landar på värdet", v.find((p) => p.ljud === "kassa").f + CHING * 60 === vanligL(18_900));
  ok("svischet börjar 0,18 s in i filen med styrkan 0,45", v[0].ljud === "svisch" && v[0].p.fran === 0.18 && v[0].p.styrka === 0.45);
  const s = orderLjud("stor", 52_800);
  const virvel = s.find((p) => p.ljud === "trumvirvel");
  ok("trumvirvelns cymbal (2,00 s in) slår på bild D", nara(virvel.p.fran + STOR_D / 60, 2.0));
  ok("smällen, trumpeterna, publiken, pengarna och kassan på sina bilder", ["small", "trumpeter", "publik", "pengar", "kassa"].map((x) => s.find((p) => p.ljud === x).f).join() === [STOR_D - 22, STOR_D - 6, STOR_D - 24, STOR_D + 9, STOR_D + 112].join());
  ok("den första ordern får fanfaren i stället för hornet", orderLjud("forsta", 9800).some((p) => p.ljud === "fanfar") && !orderLjud("forsta", 9800).some((p) => p.ljud === "horn"));
  ok("en vanlig order vilar till 262 och krymper på 44", orderTider("vanlig").byt === VANLIG_VILA && orderTider("vanlig").slut === 262 + KRYMP);
  ok("en stor affär vilar till D + 270", orderTider("stor").byt === STOR_VILA && STOR_VILA === 370);
  const m = maletLjud();
  ok("målet: smällen 0,36 s före bild 30, fanfaren 24, arenan 30, efter 650 ms", nara(m[0].f, MALET_VANTA + 30 - 0.36 * 60) && m[1].f === MALET_VANTA + 24 && m[2].f === MALET_VANTA + 30);
  const t3 = serieTider(3);
  ok("serien: raderna med en halv sekunds mellanrum, summan efter", t3.rad(1) - t3.rad(0) === 30 && t3.summa > t3.rad(2) && t3.byt > t3.lag);
  ok("serien har en kassa per rad och ett horn", serieLjud(3).filter((p) => p.ljud === "kassa").length === 3 && serieLjud(3).filter((p) => p.sparr).length === 1);
  ok("en serie på tolv visar åtta", serieTider(12).rad(11) === serieTider(8).rad(7));
}

console.log("\nKurvorna");
{
  ok("ip klämmer i ändarna", ip(-5, [0, 10], [0, 1]) === 0 && ip(50, [0, 10], [0, 1]) === 1);
  ok("ip med en kurva per delintervall", nara(ip(5, [0, 5, 24], [1, 1.045, 1], [UT, STD]), 1.045));
  ok("fjädern landar på 1", nara(fjader(600, 0, 20), 1, 1e-4) && fjader(0, 0, 20) === 0);
  ok("fjädern väntar sin fördröjning", fjader(10, 16, 20) === 0);
  ok("färgerna blandas", farg("#000000", "#ffffff", 0.5) === "rgb(128,128,128)");
  ok("skalan blandas i log", nara(skalaMix(1, 4, 0.5), 2));
}

console.log("\nSkärmen");
{
  ok("inbränningen flyttar 0–2 px", [0, 240_000, 480_000, 2_160_000].every((t) => { const p = pixelskift(t); return p.x >= 0 && p.x <= 2 && p.y >= 0 && p.y <= 2; }));
  ok("omladdning kl. 04 efter en timme", nattomladdning(Date.parse("2026-10-23T02:10:00Z"), Date.parse("2026-10-22T20:00:00Z")) && !nattomladdning(Date.parse("2026-10-23T02:10:00Z"), Date.parse("2026-10-23T01:50:00Z")));
  ok("ett nytt bygge laddar om i lugn, utan klick eller utanför arbetsdagen", byggomladdning({ nyttBygge: true, lugnt: true, ljudUtanKlick: true, arbetsdag: true }) && !byggomladdning({ nyttBygge: true, lugnt: true, ljudUtanKlick: false, arbetsdag: true }));
}

console.log("\nStilmallen och koden hör ihop");
{
  const css = readFileSync(new URL("../src/app/salesboard/tavla.css", import.meta.url), "utf8");
  ok("inga uu-enheter blev kvar", !/\d+uu\b/.test(css));
  const filer = ["Vila.tsx", "Tavla.tsx", "motion/Ordern.tsx", "motion/Serie.tsx", "motion/Malet.tsx", "motion/delar.tsx"];
  const klasser = new Set();
  for (const f of filer) {
    const text = readFileSync(new URL(`../src/app/salesboard/${f}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/\btv-[a-z0-9-]+/g)) klasser.add(m[0]);
  }
  const saknas = [...klasser].filter((k) => !css.includes(`.${k}`));
  ok("varje tv-klass i koden har en regel i tavla.css", saknas.length === 0, saknas.join(" "));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mallt gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
