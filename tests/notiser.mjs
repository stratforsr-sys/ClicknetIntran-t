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
import {
  HANDELSEKALLOR,
  MAX_NOTISER,
  NOTIS_KALLOR,
  TYP_ETIKETT,
  TYP_IKON,
  arNotisId,
  arNotistyp,
  notisId,
  sortera,
} from "../src/lib/notiser.ts";

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
  // Listan skrevs forut ut for hand med tolv namn i, och den slutade stamma
  // redan vid nasta modul. Nu provas SAMTLIGA kallor ur `NOTIS_KALLOR` — en ny
  // kalla som inte gar att avfarda faller alltsa har i stallet for i tysthet.
  {
    const trilskande = NOTIS_KALLOR.filter((k) => !arNotisId(notisId(k, UUID)));
    ok(`alla ${NOTIS_KALLOR.length} kallorna kanns igen`, trilskande.length === 0,
      trilskande.join(", "));
  }

  // Handelserader har heltals-id (bigserial), inte uuid. Ett id byggt pa dem
  // maste ocksa slappas igenom — annars gar posterna ur 0047 inte att kryssa.
  {
    const trilskande = HANDELSEKALLOR.filter((k) => !arNotisId(notisId(k, 918273)));
    ok("handelsekallor med heltals-id kanns igen", trilskande.length === 0,
      trilskande.join(", "));
  }

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

console.log(`\n\x1b[1mAvfardningen galler FORE kapningen till ${MAX_NOTISER}\x1b[0m`);
{
  // Fem fler poster an listan rymmer, de fem forsta bortklickade. Listan ska
  // anda bli full — inte fem kortare. Det ar hela loftet med krysset: du far se
  // det som ligger under.
  //
  // Antalet raknas UR `MAX_NOTISER` och skrivs inte som en siffra. Talet gick
  // fran 15 till 25 nar kallorna gick fran tjugoen till sextiotre, och ett
  // handskrivet prov hade da provat fel sak utan att falla.
  const alla = Array.from({ length: MAX_NOTISER + 5 }, (_, i) => ({
    id: notisId("nyhet", `0000000${i}-0000-4000-8000-000000000000`),
    typ: "nyhet",
    rubrik: `Post ${i}`,
    detalj: "",
    href: "/nyheter",
    tidpunkt: new Date(Date.UTC(2026, 0, 1) + (MAX_NOTISER + 5 - i) * 86_400_000).toISOString(),
    olast: false,
  }));

  const bortklickade = new Set(alla.slice(0, 5).map((n) => n.id));
  const kvar = sortera(alla.filter((n) => !bortklickade.has(n.id))).slice(0, MAX_NOTISER);

  ok(`listan ar full: ${MAX_NOTISER} poster`, kvar.length === MAX_NOTISER, `blev ${kvar.length}`);
  ok("ingen bortklickad syns", kvar.every((n) => !bortklickade.has(n.id)));
  ok("posten som lag precis utanfor listan syns nu",
    kvar.some((n) => n.rubrik === `Post ${MAX_NOTISER}`),
    "annars gav klicket en kortare lista i stallet for en ny post");

  // Ordningen ska vara oforandrad av filtreringen.
  ok("nyast forst fortfarande",
    kvar[0].rubrik === "Post 5" && kvar[MAX_NOTISER - 1].rubrik === `Post ${MAX_NOTISER + 4}`);
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


console.log("\n\x1b[1mHandelsekallorna ar en delmangd, och typerna ar fullstandiga\x1b[0m");
{
  const utanfor = HANDELSEKALLOR.filter((k) => !NOTIS_KALLOR.includes(k));
  ok("varje handelsekalla star ocksa i NOTIS_KALLOR", utanfor.length === 0, utanfor.join(", "));

  // En kalla far inte sta i BADA halvorna. En handelserad for nagot som ocksa
  // harleds hade gett tva poster om samma sak, med olika id — och bortklicket
  // pa den ena hade lamnat den andra kvar.
  const dubbletter = NOTIS_KALLOR.filter((k, i) => NOTIS_KALLOR.indexOf(k) !== i);
  ok("ingen kalla star tva ganger", dubbletter.length === 0, dubbletter.join(", "));

  // `TYP_IKON[n.typ]` slar upp utan fallback i Notisklocka.tsx. En typ som
  // saknas dar blir ett tomt ikonnamn mitt i listan.
  const typer = Object.keys(TYP_ETIKETT);
  const utanIkon = typer.filter((t) => !TYP_IKON[t]);
  ok("varje typ har bade etikett och ikon", utanIkon.length === 0, utanIkon.join(", "));

  ok("arNotistyp kanner igen alla typer", typer.every(arNotistyp));
  ok("arNotistyp nekar en typ ur tomma luften", !arNotistyp("lonespec"));
  ok("arNotistyp nekar null och tal", !arNotistyp(null) && !arNotistyp(7));
}

console.log("\n\x1b[1mOlast betyder \"hant sedan du sist oppnade\"\x1b[0m");
{
  /**
   * Regeln som gor "Markera alla som lasta" till ett lofte navet kan halla.
   *
   * Ett dussin poster i notiser-server.ts satter `olast: true` rakt av. Utan
   * regeln nedan kunde siffran pa klockan aldrig bli noll — man tryckte pa
   * knappen och prickarna stod kvar. Speglar sista stycket i `hamtaNotiser()`.
   */
  const sedd = Date.parse("2026-03-10T12:00:00Z");
  const arNy = (t) => Date.parse(t) > sedd;
  const regel = (n) => (n.olast && !arNy(n.tidpunkt) ? { ...n, olast: false } : n);

  const gammalPaminnelse = regel({ olast: true, tidpunkt: "2026-03-01T08:00:00Z" });
  ok("en paminnelse aldre an oppningen slutar lysa", gammalPaminnelse.olast === false,
    "annars gar siffran pa klockan aldrig till noll");

  const nyHandelse = regel({ olast: true, tidpunkt: "2026-03-10T13:00:00Z" });
  ok("nagot som hant efter oppningen lyser", nyHandelse.olast === true);

  // Veckoraknaren i id:t ar det som later en post komma tillbaka. Regeln far
  // inte gora den overflodig — den slacker prickan, inte posten.
  ok("posten finns kvar aven nar den ar last", "olast" in gammalPaminnelse);

  /**
   * DARFOR MASTE TIDPUNKTEN VARA STABIL. En post som raknar `Date.now()` minus
   * nagot far en ny tidpunkt vid varje rendering — men den ar alltid i det
   * FORFLUTNA, sa den blir last direkt. Det ar skalet till att chefens rader
   * numera bar senaste rorelsen och certifikatposten raknar bakat fran
   * `expires_at`.
   */
  const nyssOppnad = Date.now();
  const regelNu = (n) =>
    n.olast && !(Date.parse(n.tidpunkt) > nyssOppnad) ? { ...n, olast: false } : n;
  const instabil = regelNu({
    olast: true,
    tidpunkt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  });
  ok("en tidpunkt raknad ur nuet blir last direkt", instabil.olast === false,
    "provet star kvar som forklaring till varfor tidpunkterna ar stabila");
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
