#!/usr/bin/env node
/**
 * Leveranskalendern (0069), pass 1: reglerna i `lib/leveranskalender.ts`.
 *
 *   TZ=UTC node --experimental-strip-types tests/leveranskalender.mjs
 *
 * Behörigheten och transaktionerna provas mot databasen i tests/rls.mjs —
 * de är SQL. Här provas det som avgör vad kalendern RITAR och SÄGER:
 *
 *   1. `layout()` och `daySum()`. En krock som ritas ovanpå en annan post ser
 *      prydlig ut, och en dagsumma som räknar fel är fel åt samma håll varje dag.
 *   2. `autopick()`. "Föreslå tid" som föreslår lunchen, en lördag eller en tid
 *      som redan passerat är ett förslag man slutar lita på.
 *   3. Texterna. Kvittona står ordagrant i SPEC.md avsnitt 9, och notiserna ska
 *      säga vem som gjorde vad — aldrig en tom rubrik.
 */
import {
  DAGSTAK,
  autopick,
  avatarfarg,
  arDatum,
  dagarForVy,
  dayLabel,
  daySum,
  datumLang,
  endOf,
  felkod,
  hemdag,
  intervallForVy,
  isFree,
  kvittoFlyttad,
  kvittoForslag,
  kvittoInstallt,
  kvittoKopierad,
  kvittoLangd,
  kvittoSvar,
  layout,
  manadsrutor,
  notistext,
  periodtext,
  steg,
  upptagnaAv,
  weekno,
  LK_FEL,
  enskildTitel,
  kvittoSerieFlyttad,
  kvittoSerieInbjudan,
  regeltext,
  serieregel,
  kvittoForsok,
  kvittoKickoff,
  kvittoValkomst,
  overlamning,
  paminnelsetext,
  slaInfo,
  kundbrev,
  VY_SIFFRA,
  VY_TANGENT,
  arVy,
} from "../src/lib/leveranskalender.ts";
import { inbjudan, motesflode } from "../src/lib/ical.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${!villkor && extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const lika = (namn, fatt, vantat) => ok(namn, JSON.stringify(fatt) === JSON.stringify(vantat), `fick ${JSON.stringify(fatt)}, väntade ${JSON.stringify(vantat)}`);

const post = (id, start, minuter, extra = {}) => ({
  id,
  ref: id,
  slag: "mote",
  agare: "a",
  dag: "2026-10-07",
  start,
  minuter,
  rubrik: id,
  svar: "org",
  klar: false,
  href: null,
  organisator: "a",
  deltagare: [],
  serie: false,
  serieId: null,
  steg: null,
  utfall: null,
  forsok: 1,
  paminnelse: 10,
  ...extra,
});

console.log("\n\x1b[1mDatum och vyer\x1b[0m");
lika("veckonummer 2026-09-30", weekno("2026-09-30"), 40);
lika("veckonummer över nyår (2027-01-01 hör till v. 53)", weekno("2027-01-01"), 53);
lika("datumfältet", datumLang("2026-09-30"), "Onsdag 30 september 2026");
lika("kort dag", dayLabel("2026-09-30"), "ons 30 sep");
lika("HOME en vardag är idag", hemdag("2026-09-30"), "2026-09-30");
lika("HOME en lördag är måndagen efter", hemdag("2026-10-03"), "2026-10-05");
lika("arbetsveckan", dagarForVy("arbetsvecka", "2026-09-30"), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
lika("veckan har sju dagar", dagarForVy("vecka", "2026-09-30").length, 7);
lika("agendan är sju dagar från vald dag", dagarForVy("agenda", "2026-09-30")[6], "2026-10-06");
ok("månaden börjar på en måndag", manadsrutor("2026-10-15")[0] === "2026-09-28");
ok("månaden har fem eller sex veckor", [35, 42].includes(manadsrutor("2026-10-15").length));
lika("dagvyn hämtar hela veckan", intervallForVy("dag", "2026-09-30"), { fran: "2026-09-28", till: "2026-10-04" });
lika("dagvyn hoppar över helgen framåt", steg("dag", "2026-10-02", 1), "2026-10-05");
lika("dagvyn hoppar över helgen bakåt", steg("dag", "2026-10-05", -1), "2026-10-02");
lika("månadssteg", steg("manad", "2026-01-31", 1), "2026-02-01");
lika("periodtext för veckan", periodtext("arbetsvecka", "2026-09-30"), { text: "28 sep – 2 okt 2026", liten: "v. 40" });
ok("ett trasigt datum avvisas", !arDatum("2026-02-30") && !arDatum("30/9") && arDatum("2026-09-30"));

console.log("\n\x1b[1mUtläggningen: på exakt minut\x1b[0m");
{
  const u = layout([post("a", 540, 30), post("b", 550, 30), post("c", 600, 30)]);
  const av = (id) => u.find((x) => x.e.id === id);
  lika("två överlappande delar på två kolumner", [av("a").cols, av("b").cols], [2, 2]);
  ok("och står i var sin kolumn", av("a").col !== av("b").col);
  lika("en senare post är ensam", av("c").cols, 1);
  const k = layout([post("a", 540, 15), post("b", 555, 15)]);
  ok("en post som börjar när den förra slutar krockar inte", k.every((x) => x.cols === 1));
  lika("slutet räknas på minuten, inte på halvtimmen", endOf({ start: 545, minuter: 20 }), 565);
  lika("en post utan längd är en halvtimme", endOf({ start: 540, minuter: null }), 570);
  lika("en post kortare än en kvart ritas som en kvart", endOf({ start: 540, minuter: 5 }), 555);
}

console.log("\n\x1b[1mDagsumman räknar alla ogjorda bokningar\x1b[0m");
{
  const poster = [
    post("mote", 540, 60),
    post("uppg", 660, 30, { slag: "uppgift" }),
    post("klar", 720, 90, { klar: true }),
    post("nej", 780, 60, { svar: "nej" }),
    post("ledig", null, 480, { slag: "ledig" }),
    post("annan", 540, 60, { agare: "b" }),
  ];
  lika("möte + uppgift, inte klar, nej, ledig eller någon annans", daySum(poster, "2026-10-07", "a"), 90);
  ok("DAGSTAK är sex timmar", DAGSTAK === 360);
}

console.log("\n\x1b[1mFöreslå tid\x1b[0m");
{
  const upp = {
    a: { "2026-10-07": { block: [{ s: 480, e: 600, id: "x" }], ledig: false } },
    b: { "2026-10-07": { block: [{ s: 600, e: 660, id: "y" }], ledig: false }, "2026-10-08": { block: [], ledig: true } },
  };
  lika("första gemensamma luckan efter båda", autopick(upp, ["a", "b"], "2026-10-07", 480, 30, 5, "2026-10-01", 0), { d: "2026-10-07", s: 660 });
  lika("aldrig över lunch 12–13", autopick(upp, ["a"], "2026-10-07", 11 * 60 + 45, 60, 0, "2026-10-01", 0), { d: "2026-10-07", s: 780 });
  lika("en ledig dag hoppas över", autopick(upp, ["b"], "2026-10-08", 480, 30, 3, "2026-10-01", 0), { d: "2026-10-09", s: 480 });
  lika("aldrig på helg", autopick({}, ["a"], "2026-10-10", 480, 30, 3, "2026-10-01", 0), { d: "2026-10-12", s: 480 });
  lika("aldrig närmare än 15 min från nu", autopick({}, ["a"], "2026-10-07", 480, 30, 0, "2026-10-07", 9 * 60 + 1), { d: "2026-10-07", s: 9 * 60 + 30 });
  lika("aldrig bakåt i tiden", autopick({}, ["a"], "2026-10-01", 480, 30, 10, "2026-10-05", 0)?.d, "2026-10-05");
  lika("den egna posten räknas inte som krock när den flyttas", autopick(upp, ["a"], "2026-10-07", 480, 30, 0, "2026-10-01", 0, "x"), { d: "2026-10-07", s: 480 });
  lika("ingen tid alls ger null", autopick({ a: { "2026-10-07": { block: [], ledig: true } } }, ["a"], "2026-10-07", 480, 30, 0, "2026-10-01", 0), null);
  ok("krockrutan säger vem", upptagnaAv(upp, ["a", "b"], "2026-10-07", 540, 30).join() === "a");
  ok("isFree nej på lördag", !isFree({}, ["a"], "2026-10-10", 540, 30));
}

console.log("\n\x1b[1mKvittona, ordagrant ur SPEC avsnitt 9\x1b[0m");
lika("flyttad", kvittoFlyttad("2026-09-30", 600, ["Elin"]), "Flyttad till ons 30 sep 10:00. Elin behöver bekräfta den nya tiden.");
lika("flyttad utan deltagare", kvittoFlyttad("2026-09-30", 600, []), "Flyttad till ons 30 sep 10:00.");
lika("ny längd", kvittoLangd(540, 600, ["Elin", "Adam"]), "Nu 09:00–10:00. Elin, Adam behöver bekräfta den nya tiden.");
lika("svar", kvittoSvar("ja", "Zen"), "Svar skickat: ja. Zen ser det i sin klocka.");
lika("svar för en förekomst", kvittoSvar("nej", "Zen", "2026-09-30"), "Svar skickat för ons 30 sep: nej. Zen ser det i sin klocka.");
lika("förslag", kvittoForslag("Zen", "2026-09-30", 780, 45), "Förslaget skickat till Zen: ons 30 sep 13:00–13:45.");
lika("inställt", kvittoInstallt(["Elin"]), "Inställt. Elin får en notis och ett mejl.");
lika("kopierad", kvittoKopierad("2026-10-07", 540, true), "Kopierad till ons 7 okt 09:00. Inbjudan skickad igen.");

console.log("\n\x1b[1mFelkoderna från databasen\x1b[0m");
lika("lk:vardag blir texten", felkod('P0001: lk:vardag'), "vardag");
ok("varje kod har en text", ["behorighet", "vardag", "rubrik", "finns_inte", "installd", "for_sent", "oforandrad", "ogiltig"].every((k) => LK_FEL[k]));
lika("ett okänt fel ges inte en påhittad text", felkod("duplicate key value"), null);

console.log("\n\x1b[1mNotiserna säger vem som gjorde vad\x1b[0m");
{
  const u = { avNamn: "Zen", rubrik: "Veckoavslut", dag: "2026-10-02", tid: "15:00" };
  const rad = (mall, data = {}) => ({ kalla: "x", mall, till: "b", av: "a", event_id: "e1", data });
  const mallar = ["inbjudan", "bokat-at-dig", "flyttad", "installd", "svar", "forslag", "forslag-godkant", "forslag-behallen"];
  ok("varje mall ger en rubrik och en länk", mallar.every((m) => {
    const t = notistext(rad(m, { svar: "ja", dag: "2026-10-05", tid: "10:00", minuter: 30, svara_igen: true }), u);
    return t && t.rubrik.length > 0 && t.rubrik.length <= 200 && t.href.startsWith("/") && !/\s/.test(t.href);
  }));
  lika("inbjudan", notistext(rad("inbjudan"), u).rubrik, "Zen bjöd in dig till “Veckoavslut”");
  lika("flyttad med nytt svar", notistext(rad("flyttad", { dag: "2026-10-05", tid: "10:00", svara_igen: true }), u).rubrik, "Zen flyttade “Veckoavslut”. Svara igen");
  lika("flyttad visar den nya tiden", notistext(rad("flyttad", { dag: "2026-10-05", tid: "10:00", svara_igen: true }), u).detalj, "ny tid mån 5 okt 10:00 · ditt tidigare svar gäller inte längre");
  lika("länken öppnar händelsen på den nya dagen", notistext(rad("flyttad", { dag: "2026-10-05", tid: "10:00" }), u).href, "/kalender?dag=2026-10-05&handelse=e1");
  lika("nej med meddelande i klartext", notistext(rad("svar", { svar: "nej", note: "Är på kundbesök" }), u).detalj, "fre 2 okt 15:00 · “Är på kundbesök”");
  lika("förslaget har tid och längd", notistext(rad("forslag", { dag: "2026-10-05", tid: "13:00", minuter: 45 }), u).detalj, "mån 5 okt 13:00–13:45");
  ok("en okänd mall skickas inte", notistext(rad("påhittad"), u) === null);
  const p = notistext({ kalla: "uppgift-paminnelse", mall: "uppgift-paminnelse", till: "b", av: null, task_id: "t1", data: { dag: "2026-10-02", tid: "14:00" } }, { avNamn: null, rubrik: "Ring tillbaka", dag: "2026-10-02", tid: "14:00" });
  lika("uppgiftens påminnelse", [p.rubrik, p.detalj, p.href], ["Ring tillbaka", "Om tio minuter, kl 14:00", "/uppgifter/t1"]);
}

console.log("\n\x1b[1mSerier och 1:1 (pass 2)\x1b[0m");
{
  lika("varje vecka blir veckovis på dagens veckodag", serieregel("vecka", "2026-09-30"), { monster: "veckovis", intervall: 1, veckodag: 3, starts_on: "2026-09-30", ends_on: null });
  lika("varannan vecka", serieregel("varannan", "2026-09-30").intervall, 2);
  lika("upprepas inte är en serie med en enda gång", serieregel("aldrig", "2026-09-30").ends_on, "2026-09-30");
  lika("regeltexten", [regeltext(serieregel("vecka", "2026-09-30")), regeltext(serieregel("varannan", "2026-09-30")), regeltext(serieregel("vardagar", "2026-09-30")), regeltext(serieregel("aldrig", "2026-09-30"))], ["varje vecka", "varannan vecka", "varje vardag", "en gång"]);
  const namn = (id) => ({ z: "Zen", e: "Elin" })[id];
  lika("1:1 heter efter den andra, för organisatören", enskildTitel("z", "e", "z", namn), "1:1 Elin");
  lika("och för säljaren", enskildTitel("z", "e", "e", namn), "1:1 Zen");
  lika("och för någon som ser in", enskildTitel("z", "e", "x", namn), "1:1 Zen · Elin");
  lika("hela serien flyttad", kvittoSerieFlyttad("2026-10-01", 600, false, ["Elin"]), "Hela serien flyttad till torsdagar 10:00. Elin behöver bekräfta den nya tiden.");
  lika("hela serien, vardagar", kvittoSerieFlyttad("2026-10-01", 495, true, []), "Hela serien flyttad till vardagar 08:15.");
  lika("inbjudan till en serie", kvittoSerieInbjudan(["Elin"], "varje vecka"), "Inbjudan skickad till Elin. Serie varje vecka.");
  const u = { avNamn: "Zen", rubrik: "1:1", dag: "2026-10-07", tid: "10:00" };
  const rad = (mall, data = {}) => ({ kalla: "x", mall, till: "e", av: "z", event_id: "e1", data });
  lika("en 1:1 står utan citattecken", notistext(rad("inbjudan-serie", { regel: "varje vecka", dag: "2026-10-07", tid: "10:00" }), u).rubrik, "Zen bjöd in dig till 1:1, varje vecka");
  lika("och säger när första gången är", notistext(rad("inbjudan-serie", { regel: "varje vecka", dag: "2026-10-07", tid: "10:00" }), u).detalj, "första gången ons 7 okt 10:00");
  lika("hela serien flyttad, notisen", notistext(rad("flyttad-serie", { regel: "torsdagar", tid: "10:00", svara_igen: true }), u).rubrik, "Zen flyttade hela serien 1:1. Svara igen");
  lika("ny punkt", notistext(rad("punkt", { text: "Invändningar" }), u).detalj, "“Invändningar”");
  lika("förberedelsen", notistext({ ...rad("forberedelse"), av: null }, { ...u, avNamn: null }).rubrik, "Inför er 1:1: lägg till det du vill ta upp");
  lika("be om förberedelse", notistext(rad("forbered-be"), u).rubrik, "Zen vill att du förbereder er 1:1");
}

console.log("\n\x1b[1mLeveransen (pass 3)\x1b[0m");
{
  const nu = Date.parse("2026-10-01T10:00:00Z");
  lika("grön över 8 h", slaInfo("2026-10-01T20:30:00Z", nu).cls, "ok");
  lika("gul under 8 h", slaInfo("2026-10-01T13:12:00Z", nu), { cls: "warn", txt: "3 h 12 min kvar", pct: (3.2 / 24) * 100 });
  lika("röd när försenad", slaInfo("2026-10-01T08:55:00Z", nu).txt, "Försenad 1 h 05 min");
  lika("överlämningen räknar sex fält", overlamning({ kontakt: "Mira", telefon: "070", mal: "Fler kunder", lovat: "", basta_tid: " ", risker: null }), { har: 3, av: 6, saknas: ["Vad som lovades", "Bästa tid att ringa", "Risker"] });
  lika("påminnelsen 30 min före", paminnelsetext("2026-10-07", 540), "ons 7 okt kl 08:30");
  lika("välkomstsamtal bokat", kvittoValkomst("Kvarnens Bageri", "2026-10-07", 540, "Sara", "Elin"), "Välkomstsamtal med Kvarnens Bageri bokat ons 7 okt 09:00 hos Sara. Elin får en notis.");
  lika("nästa försök", kvittoForsok(2, "2026-10-07", 780), "Försök 2 bokat ons 7 okt 13:00, på en annan tid på dagen.");
  lika("kickoff", kvittoKickoff("2026-10-08", 540, "Mira Kvarnström"), "Kickoff tors 8 okt 09:00. Mira Kvarnström får inbjudan via mejl.");
  const u = { avNamn: "Zen", rubrik: "Kvarnens Bageri", dag: "2026-10-01", tid: null };
  const rad = (mall, data = {}) => ({ kalla: "x", mall, till: "s", av: "z", event_id: null, order_id: "o1", data });
  lika("ny kund i kön", notistext(rad("leverans-ny"), u).rubrik, "Ny kund i kön: Kvarnens Bageri");
  lika("komplettera leder till överlämningen", notistext(rad("leverans-komplettera", { saknas: "Risker" }), u).href, "/kalender/overlamning/o1");
  lika("fristen", notistext(rad("leverans-frist"), u).rubrik, "Kvarnens Bageri har snart väntat 24 h");
  const bokad = notistext({ ...rad("leverans-bokad-saljare", { ansvarigNamn: "Sara Lind" }), event_id: "e1" }, { ...u, rubrik: "Välkomstsamtal · Kvarnens Bageri", dag: "2026-10-07", tid: "09:00" });
  lika("säljaren får veta när kunden välkomnas", [bokad.rubrik, bokad.detalj], ["Kvarnens Bageri välkomnas ons 7 okt 09:00", "av Sara Lind"]);
  ok("felkoden tagen har en text", !!LK_FEL.tagen);
}

console.log("\n\x1b[1mPass 4: Teamet\x1b[0m");
{
  ok("team är en vy", arVy("team"));
  lika("Ctrl+Alt+5 är Teamet", VY_TANGENT.Digit5, "team");
  lika("siffrorna i vyknapparna", VY_SIFFRA, { dag: 1, arbetsvecka: 2, vecka: 3, manad: 4, team: 5, agenda: 6 });
  lika("Teamet visar en dag", dagarForVy("team", "2026-10-07"), ["2026-10-07"]);
  lika("Teamet hämtar bara dagen", intervallForVy("team", "2026-10-07"), { fran: "2026-10-07", till: "2026-10-07" });
  lika("Teamet hoppar över helgen framåt", steg("team", "2026-10-09", 1), "2026-10-12");
  lika("Teamet hoppar över helgen bakåt", steg("team", "2026-10-12", -1), "2026-10-09");
  lika("rubriken som dagvyn", periodtext("team", "2026-09-30"), periodtext("dag", "2026-09-30"));
}

console.log("\n\x1b[1mPass 4: .ics och kundens brev\x1b[0m");
{
  const m = {
    id: "e1",
    sekvens: 2,
    rubrik: "Kickoff med Clicknet",
    start: new Date("2026-10-08T07:00:00Z"),
    minuter: 60,
    plats: "Teams; rum 2",
    url: null,
    beskrivning: null,
    andrad: new Date("2026-10-01T10:00:00Z"),
  };
  const nu = new Date("2026-10-01T12:00:00Z");
  const req = inbjudan(m, "REQUEST", { namn: "Zen Saab", epost: "zen@clicknet.se" }, { namn: "Mira", epost: "mira@kund.se", svara: true }, nu);
  // Vik ut raderna först: en lång ATTENDEE viks vid 75 oktetter (RFC 5545).
  const rader = req.replace(/\r\n /g, "").split("\r\n");
  ok("REQUEST har METHOD:REQUEST", rader.includes("METHOD:REQUEST"));
  ok("UID är händelsens, och stabil", rader.includes("UID:e1@nav.clicknet.se"));
  ok("SEQUENCE är händelsens", rader.includes("SEQUENCE:2"));
  ok("start i UTC", rader.includes("DTSTART:20261008T070000Z") && rader.includes("DTEND:20261008T080000Z"));
  ok("semikolon i platsen escapas", rader.includes("LOCATION:Teams\\; rum 2"));
  ok("kunden får svara", rader.some((r) => r.startsWith("ATTENDEE") && r.includes("RSVP=TRUE") && r.endsWith("mailto:mira@kund.se")));
  ok("organisatören står med", rader.some((r) => r.startsWith('ORGANIZER;CN="Zen Saab":mailto:zen@clicknet.se')));
  ok("raderna slutar med CRLF", req.endsWith("END:VCALENDAR\r\n"));
  const can = inbjudan(m, "CANCEL", { epost: "zen@clicknet.se" }, { epost: "k@x.se", svara: false }, nu).replace(/\r\n /g, "").split("\r\n");
  ok("CANCEL har METHOD och STATUS", can.includes("METHOD:CANCEL") && can.includes("STATUS:CANCELLED"));
  ok("kollegan får inga svarsknappar", can.some((r) => r.startsWith("ATTENDEE") && r.includes("RSVP=FALSE")));
  const pub = motesflode([m, { ...m, id: "e2", sekvens: 0 }], "Möten — Zen", nu).split("\r\n");
  ok("flödet är PUBLISH utan deltagare", pub.includes("METHOD:PUBLISH") && !pub.some((r) => r.startsWith("ATTENDEE") || r.startsWith("ORGANIZER")));
  lika("två händelser i flödet", pub.filter((r) => r === "BEGIN:VEVENT").length, 2);
  ok("långa rader viks vid 75 oktetter", motesflode([{ ...m, rubrik: "Å".repeat(80) }], "x", nu).split("\r\n").every((r) => Buffer.byteLength(r) <= 75));

  const a = { sekvens: 0, rubrik: "Kickoff med Clicknet", nar: "torsdag 8 oktober 2026 kl 09:00–10:00", kontakt: "Mira", plats: null, url: null, avsandare: "Sara" };
  const ny = kundbrev({ ...a, metod: "REQUEST" });
  lika("inbjudans ämne", ny.amne, "Inbjudan: Kickoff med Clicknet torsdag 8 oktober 2026 kl 09:00–10:00");
  ok("inbjudan hälsar och säger Clicknet med versal", ny.text.startsWith("Hej Mira,") && ny.text.includes("kickoff med Clicknet"));
  lika("ombokningens ämne", kundbrev({ ...a, metod: "REQUEST", sekvens: 1 }).amne, "Ny tid: Kickoff med Clicknet torsdag 8 oktober 2026 kl 09:00–10:00");
  lika("det inställdas ämne", kundbrev({ ...a, metod: "CANCEL", sekvens: 2 }).amne, "Inställt: Kickoff med Clicknet torsdag 8 oktober 2026 kl 09:00–10:00");
  ok("utan kontakt: bara Hej", kundbrev({ ...a, metod: "REQUEST", kontakt: null }).text.startsWith("Hej,"));
  ok("plats och länk följer med", kundbrev({ ...a, metod: "REQUEST", plats: "Kontoret", url: "https://x.se" }).text.includes("Plats: Kontoret\nLänk: https://x.se"));
}

console.log("\n\x1b[1mAvatarerna\x1b[0m");
{
  const id = "c1b73484-b547-4fac-9ecd-3c854c9f437b";
  ok("samma person får alltid samma färg", avatarfarg(id) === avatarfarg(id));
  ok("färgen är 1–6", Array.from({ length: 50 }, (_, i) => avatarfarg(`p${i}`)).every((n) => n >= 1 && n <= 6));
}

console.log("");
if (fel > 0) {
  console.log(`\x1b[31m${fel} fel\x1b[0m\n`);
  process.exit(1);
}
console.log("\x1b[32mLeveranskalenderns regler håller.\x1b[0m\n");
