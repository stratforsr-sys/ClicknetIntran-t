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
} from "../src/lib/leveranskalender.ts";

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
