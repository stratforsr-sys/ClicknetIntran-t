#!/usr/bin/env node
/**
 * Möten: anteckningarnas regler utan databas (src/lib/nav2/motesanteckning.ts, 0310).
 *
 *   TZ=UTC node --experimental-strip-types tests/motesanteckning.mjs
 */
import { ANTECKNING_MAX, antalNya, bokningsDetalj, idIndata, iOrdning, kort, mottagare, notisText, settFramat, textIndata, tillKlient } from "../src/lib/nav2/motesanteckning.ts";

let fel = 0;
let antal = 0;
const ok = (namn, villkor) => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

console.log("\nTexten");
lika("tomt", textIndata("   \n "), { ok: false, fel: "Skriv något först." });
lika("inte en sträng", textIndata(null), { ok: false, fel: "Skriv något först." });
lika("trimmas, radbrytningarna står kvar", textIndata("  Hej\r\nLena  "), { ok: true, text: "Hej\nLena" });
lika("styrtecken bort, tabb kvar", textIndata("a\u0000b\tc\u0007"), { ok: true, text: "ab\tc" });
ok("exakt gränsen går", textIndata("x".repeat(ANTECKNING_MAX)).ok === true);
ok("ett tecken för mycket säger gränsen", textIndata("x".repeat(ANTECKNING_MAX + 1)).fel.replace(/\s/g, " ") === "Anteckningen är för lång, högst 4 000 tecken.");
ok("tomrum räknas inte mot gränsen", textIndata(" ".repeat(10) + "x".repeat(ANTECKNING_MAX) + " ".repeat(10)).ok === true);

console.log("\nId:t");
lika("webbläsarens uuid", idIndata("0B6E2C1A-7F3D-4E2B-9A1C-2D3E4F5A6B7C"), "0b6e2c1a-7f3d-4e2b-9a1c-2d3e4f5a6b7c");
lika("inte ett uuid", idIndata("1; drop table"), null);
lika("inget", idIndata(undefined), null);

console.log("\nVem som får notis");
const aktiva = new Set(["mick", "carl", "zen", "chef", "lena"]);
lika("deltagarna utom den som skrev", mottagare({ deltagare: ["mick", "carl", "zen"], forfattare: [], av: "zen", tysta: [], aktiva }), ["mick", "carl"]);
lika("en chef som svarat följer tråden", mottagare({ deltagare: ["mick", "zen"], forfattare: ["chef", "zen"], av: "mick", tysta: [], aktiva }), ["zen", "chef"]);
lika("den som tystat får inget", mottagare({ deltagare: ["mick", "carl", "zen"], forfattare: [], av: "zen", tysta: ["carl"], aktiva }), ["mick"]);
lika("den som slutat får inget", mottagare({ deltagare: ["mick", "borta"], forfattare: ["borta"], av: "zen", tysta: [], aktiva }), ["mick"]);
lika("varje person en gång", mottagare({ deltagare: ["mick", "mick", "carl"], forfattare: ["carl", "mick"], av: "zen", tysta: [], aktiva }), ["mick", "carl"]);
lika("ensam på kortet: ingen", mottagare({ deltagare: ["zen"], forfattare: ["zen"], av: "zen", tysta: [], aktiva }), []);

console.log("\nNotisen");
lika("rubrik och början", notisText({ fornamn: "Carl", bolag: "Nordic Grön AB", text: "Ägaren heter Lena.\nRing inte före 10." }), { rubrik: "Carl om Nordic Grön AB", detalj: "Ägaren heter Lena. Ring inte före 10." });
lika("utan förnamn", notisText({ fornamn: "", bolag: "Orion Car AB", text: "x" }).rubrik, "En kollega om Orion Car AB");
const lang = "Ägaren heter Lena och hon bestämmer allt som rör marknadsföring men vill inte ha bindningstid och har dåliga erfarenheter av byråer sedan tidigare år";
const k = notisText({ fornamn: "Carl", bolag: "X", text: lang }).detalj;
ok(`lång text kortas på ett ord med … (${k.length} tecken: ${k})`, k.length <= 140 && k.endsWith("…") && !k.endsWith(" …") && lang.startsWith(k.slice(0, -1)));
lika("kort klipper inte en kort text", kort("  Hej   Lena ", 140), "Hej Lena");
lika("bokningens notis bär anteckningen", bokningsDetalj("Nordic Grön · tis 17 nov 10:00", "Ägaren heter Lena."), "Nordic Grön · tis 17 nov 10:00 · ”Ägaren heter Lena.”");
lika("utan anteckning som förut", bokningsDetalj("Nordic Grön · tis 17 nov 10:00", null), "Nordic Grön · tis 17 nov 10:00");
lika("tom anteckning som förut", bokningsDetalj("Nordic Grön · tis 17 nov 10:00", "   "), "Nordic Grön · tis 17 nov 10:00");

console.log("\nOrdningen och det nya");
const T = (min) => new Date(Date.UTC(2026, 10, 16, 9, min)).toISOString();
const lista = [
  { id: "b", av: "carl", skapad: T(5), borttagen: null },
  { id: "a", av: "carl", skapad: T(5), borttagen: null },
  { id: "c", av: "mick", skapad: T(1), borttagen: null },
];
lika("tid först, sedan id", iOrdning(lista).map((x) => x.id), ["c", "a", "b"]);
lika("två nya från Carl för Mick", antalNya(lista, "mick", T(2)), 2);
lika("mina egna är aldrig nya", antalNya(lista, "carl", T(0)), 1);
lika("utan sett-rad är allt från andra nytt", antalNya(lista, "zen", null), 3);
lika("ett borttaget är inte nytt", antalNya([{ id: "x", av: "carl", skapad: T(9), borttagen: T(10) }], "mick", T(0)), 0);
lika("sett exakt till inlägget: inte nytt", antalNya(lista, "mick", T(5)), 0);

console.log("\nHur långt jag läst");
const NU = new Date(T(30));
lika("framåt", settFramat(T(1), T(5), NU), T(5));
lika("aldrig bakåt", settFramat(T(5), T(1), NU), null);
lika("samma tid: ingen ändring", settFramat(T(5), T(5), NU), null);
lika("aldrig förbi nu", settFramat(T(5), T(59), NU), T(30));
lika("första gången", settFramat(null, T(3), NU), T(3));
lika("skräp: ingen ändring", settFramat(T(5), "i går", NU), null);

console.log("\nTill klienten");
const namn = new Map([["carl", "Carl Ek"]]);
lika("borttaget har ingen text och ingen ändring", tillKlient({ id: "x", kedja_id: "k", mote_id: null, av: "carl", text: null, skapad: T(1), andrad: T(2), borttagen: T(3) }, namn), { id: "x", mote: null, av: "carl", avNamn: "Carl Ek", text: null, skapad: T(1), andrad: null, borttagen: true });
lika("den som slutat står kvar som avsändare", tillKlient({ id: "y", kedja_id: "k", mote_id: "m", av: "borta", text: "Hej", skapad: T(1), andrad: null, borttagen: null }, namn).avNamn, "En kollega som slutat");

console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
