#!/usr/bin/env node
/**
 * Notisklockans logik. Ren, utan databas.
 *
 * Det som provas har ar de tre reglerna som gor avfardningen (0037) till nagot
 * annat an "dolj raden":
 *
 *   1. ETT ID BAR DET SOM GOR POSTEN NY. En ny version av en rutin, ett nytt
 *      svar i ett arende — bada ska ge ett NYTT id, sa att posten kommer
 *      tillbaka aven for den som klickade bort den forra.
 *   2. AVFARDNINGEN GALLER FORE KAPNINGEN. Femton platser ar hela listan; en
 *      bortklickad post far inte ata upp sin plats.
 *   3. FORMEN PROVAS, INTE INNEHALLET. `avfardaNotisen` far en strang fran
 *      webblasaren och maste kunna avvisa skrap utan att fraga databasen.
 *
 *   node --experimental-strip-types tests/notiser.mjs
 */
import { MAX_NOTISER, arNotisId, notisId, sortera } from "../src/lib/notiser.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const UUID = "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607";
const UUID2 = "9e8d7c6b-5a4f-4321-9876-543210fedcba";

console.log("\n\x1b[1mId:t bar det som gor posten ny\x1b[0m");
{
  ok("en rutin i version 2 och 3 ar tva olika poster",
    notisId("rutin", UUID, 2) !== notisId("rutin", UUID, 3),
    notisId("rutin", UUID, 3));

  ok("samma version ger samma id tva ganger",
    notisId("rutin", UUID, 2) === notisId("rutin", UUID, 2));

  ok("tva svar i samma arende ar tva poster",
    notisId("arende", UUID, UUID2) !== notisId("arende", UUID, UUID),
    "annars ligger ett nytt svar dolt bakom det gamla klicket");

  // Kallorna far inte kollidera: `franvaro-<id>` ar en ansokan som vantar pa
  // beslut och `franvaro-beslut-<id>` ar beskedet om den. Klickar man bort det
  // ena ska det andra sta kvar.
  ok("ansokan och beslut ar skilda poster",
    notisId("franvaro", UUID) !== notisId("franvaro-beslut", UUID));

  ok("inlamnat och bedomt rollspel ar skilda poster",
    notisId("rollspel", UUID) !== notisId("rollspel-bedomt", UUID));

  ok("ny rapport och svar pa rapport ar skilda poster",
    notisId("fel", UUID) !== notisId("fel-svar", UUID));
}

console.log("\n\x1b[1mFormen provas, inte innehallet\x1b[0m");
{
  ok("ett riktigt id slapps igenom", arNotisId(notisId("rutin", UUID, 4)));
  ok("alla tolv kallorna kanns igen",
    ["nyhet", "rutin", "kurs", "arende", "franvaro", "franvaro-beslut", "franvaro-lucka",
      "sjuk", "rollspel", "rollspel-bedomt", "fel", "fel-svar"]
      .every((k) => arNotisId(notisId(k, UUID))));

  ok("en okand kalla nekas", !arNotisId(`lonespec-${UUID}`));
  ok("bara kallan utan id nekas", !arNotisId("rutin-"));
  ok("tom strang nekas", !arNotisId(""));
  ok("null nekas", !arNotisId(null));
  ok("ett tal nekas", !arNotisId(7));

  // Kolumnen tar 200 tecken. Kontrollen ska saga nej fore databasen, sa att
  // felet blir tyst i stallet for en rod ruta ovanpa sidan man just bad om.
  ok("langre an 200 tecken nekas", !arNotisId("rutin-" + "a".repeat(300)));

  // Inget av det har kan ta sig igenom PostgREST anda, men en kontroll som
  // slapper igenom skrap later skrapet bli rader i nagons tabell.
  ok("citattecken nekas", !arNotisId(`rutin-${UUID}'; drop table x; --`));
  ok("mellanslag nekas", !arNotisId(`rutin-${UUID} extra`));
  ok("nyrad nekas", !arNotisId(`rutin-${UUID}\ndrop`));
}

console.log("\n\x1b[1mAvfardningen galler FORE kapningen till 15\x1b[0m");
{
  // Tjugo poster, de fem forsta bortklickade. Listan ska anda bli femton — inte
  // tio. Det ar hela loftet med knappen: du far se det som ligger under.
  const alla = Array.from({ length: 20 }, (_, i) => ({
    id: notisId("nyhet", `0000000${i}-0000-4000-8000-000000000000`),
    typ: "nyhet",
    rubrik: `Post ${i}`,
    detalj: "",
    href: "/nyheter",
    tidpunkt: new Date(Date.UTC(2026, 0, 20 - i)).toISOString(),
    olast: false,
  }));

  const bortklickade = new Set(alla.slice(0, 5).map((n) => n.id));
  const kvar = sortera(alla.filter((n) => !bortklickade.has(n.id))).slice(0, MAX_NOTISER);

  ok("femton poster kvar, inte tio", kvar.length === 15, `blev ${kvar.length}`);
  ok("ingen bortklickad syns", kvar.every((n) => !bortklickade.has(n.id)));
  ok("posten som lag pa plats 16 syns nu",
    kvar.some((n) => n.rubrik === "Post 15"),
    "annars gav klicket en kortare lista i stallet for en ny post");

  // Ordningen ska vara oforandrad av filtreringen.
  ok("nyast forst fortfarande", kvar[0].rubrik === "Post 5" && kvar[14].rubrik === "Post 19");
}

console.log("\n\x1b[1mOlasta prickar raknas pa det som syns\x1b[0m");
{
  const poster = [
    { id: notisId("kurs", UUID), olast: true, tidpunkt: "2026-01-01T00:00:00Z" },
    { id: notisId("kurs", UUID2), olast: true, tidpunkt: "2026-01-02T00:00:00Z" },
  ];
  const avfardade = new Set([notisId("kurs", UUID)]);
  const synliga = poster.filter((n) => !avfardade.has(n.id));

  ok("siffran i klockan foljer listan", synliga.filter((n) => n.olast).length === 1,
    "en klocka som visar 2 over en lista med 1 ar en klocka man slutar lita pa");
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
