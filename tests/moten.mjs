#!/usr/bin/env node
/**
 * Nav 2.0, Möten (A4): den rena logiken i motenforma.ts. Ingen databas.
 *
 *   ~/nav2-utkast/delar/moten/sdd/prov.sh tests/moten.mjs
 *   (eller: TZ=UTC node --experimental-strip-types tests/moten.mjs)
 *
 * `arbetsdagar` hämtas ur anstalldaforma.ts, som importerar `@/lib/saljtakt`;
 * den ytan löser Node inte själv, så en krok pekar `@/` mot src/ (som i
 * tests/nav2-anstallda-avslut.mjs). motenforma.ts själv har bara relativa
 * importer och behöver ingen krok.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const kastar = (f) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const { arbetsdagar } = await import("../src/lib/nav2/anstalldaforma.ts");
const { SKAL } = await import("../src/lib/nav2/leadsforma.ts");
const M = await import("../src/lib/nav2/motenforma.ts");

rubrik("Konstanter");
ok("fem kolumner i tavlans ordning", JSON.stringify(M.KOLUMNER) === JSON.stringify(["bokat", "bekraftat", "utfall_saknas", "folj_upp", "tyst"]));
ok(
  "kolumnnamnen",
  JSON.stringify(M.KOLUMNER.map((k) => M.KOLUMN_NAMN[k])) === JSON.stringify(["Bokat", "Bekräftat", "Utfall saknas", "Följ upp", "Tyst"]),
);
ok("nulägena", M.NULAGE.ingen === "Ingen SEO" && M.NULAGE.sjalv === "Gör själv" && M.NULAGE.byra === "Har byrå");
ok("nej-skälen är Leads skäl", M.NEJ_SKAL === SKAL || JSON.stringify(M.NEJ_SKAL) === JSON.stringify(SKAL));

rubrik("normaliseraDoman");
ok("adress med protokoll, www, gemener och sökväg", M.normaliseraDoman("https://www.Exempel.se/om-oss?x=1") === "exempel.se");
ok("redan en domän", M.normaliseraDoman("exempel.se") === "exempel.se");
ok("tom sträng: null", M.normaliseraDoman("") === null);
ok("null: null", M.normaliseraDoman(null) === null);
ok("blanksteg runt och port", M.normaliseraDoman("  HTTP://Exempel.se:8080/  ") === "exempel.se");
ok("underdomän behålls", M.normaliseraDoman("https://shop.exempel.se/x") === "shop.exempel.se");
ok("inget som liknar en domän: null", M.normaliseraDoman("inte en adress") === null);

rubrik("telefonE164 (Granskningsfokus 3)");
for (const ra of ["070-123 45 67", "+46 70 123 45 67", "0046701234567", "46701234567"]) {
  ok(`${ra} → +46701234567`, M.telefonE164(ra) === "+46701234567", `fick ${M.telefonE164(ra)}`);
}
ok("annat land behåller sitt +", M.telefonE164("+47 912 34 567") === "+4791234567");
ok("skräp: null", M.telefonE164("abc") === null && M.telefonE164("12") === null && M.telefonE164("") === null && M.telefonE164(null) === null);
ok("utan nolla och landskod: null", M.telefonE164("701234567") === null);

rubrik("Rättigheter");
const bokare = { id: "b", roller: ["sales"] };
const hallare = { id: "h", roller: ["sales"] };
const annan = { id: "x", roller: ["sales"] };
const tl = { id: "t", roller: ["team_lead"] };
const sm = { id: "s", roller: ["sales_manager"] };
const mote = { bokat_av: "b", halls_av: "h" };
ok("hållaren får sätta utfall", M.farSattaUtfall(hallare, mote) === true);
ok("bokaren som inte håller får inte", M.farSattaUtfall(bokare, mote) === false);
ok("team_lead får inte", M.farSattaUtfall(tl, mote) === false);
ok("sales_manager får", M.farSattaUtfall(sm, mote) === true);
ok("ceo och admin får", M.farSattaUtfall({ id: "c", roller: ["ceo"] }, mote) && M.farSattaUtfall({ id: "a", roller: ["admin"] }, mote));
ok("en annan säljare får inte", M.farSattaUtfall(annan, mote) === false);
ok("bokaren får bekräfta", M.farBekrafta(bokare, mote) === true);
ok("någon annan säljare får inte", M.farBekrafta(annan, mote) === false);
ok("team_lead får bekräfta", M.farBekrafta(tl, mote) === true);
ok("farSe: bokare, hållare och chef", M.farSe(bokare, mote) && M.farSe(hallare, mote) && M.farSe(tl, mote) && !M.farSe(annan, mote));
ok("farBekrafta = farSe för alla", [bokare, hallare, annan, tl, sm].every((u) => M.farBekrafta(u, mote) === M.farSe(u, mote)));
ok("flera roller: en chefsroll räcker", M.farSe({ id: "q", roller: ["sales", "ceo"] }, mote) === true);

rubrik("motesArt");
ok("ny", M.motesArt(false, null) === "ny");
ok("ombokning", M.motesArt(false, "id") === "ombokning");
ok("uppföljning", M.motesArt(true, null) === "uppfoljning");
ok("hållet möte i kedjan väger tyngre än ombokning", M.motesArt(true, "id") === "uppfoljning");

rubrik("efterIngetSvar");
{
  const u = M.efterIngetSvar("2026-10-30");
  ok("fredag → tisdag 3 november (två arbetsdagar)", u.uppfoljning_datum === "2026-11-03", `fick ${u.uppfoljning_datum}`);
  ok("samma som arbetsdagar(idag, 2)", u.uppfoljning_datum === arbetsdagar("2026-10-30", 2));
  ok("bara datumet i lappen", Object.keys(u).join() === "uppfoljning_datum");
  ok("torsdag → måndag", M.efterIngetSvar("2026-10-29").uppfoljning_datum === arbetsdagar("2026-10-29", 2));
}

rubrik("efterUtfall (idag = torsdag 2026-10-29)");
const IDAG = "2026-10-29";
const NU = "2026-10-29T10:00:00.000Z";
{
  const a = M.efterUtfall({ utfall: "hallet", resultat: "offert" }, IDAG, false, NU);
  ok("offert: datum = idag + 3 arbetsdagar", a.kedja?.uppfoljning_datum === "2026-11-03" && a.kedja.uppfoljning_datum === arbetsdagar(IDAG, 3), `fick ${a.kedja?.uppfoljning_datum}`);
  ok("offert: Inget svar i rad nollas", a.kedja?.inget_svar_i_rad === 0);
  ok("offert: offert_nar = nu-parametern", a.kedja?.offert_nar === NU);
  ok("offert: mötet får utfall och resultat", a.mote.utfall === "hallet" && a.mote.resultat === "offert");
  ok("offert: ingen avslutskolumn och ingen ny tid", !("avslut" in a.kedja) && a.nyttMote === null);
  const utan = M.efterUtfall({ utfall: "hallet", resultat: "offert" }, IDAG, false);
  ok("offert utan nu-parameter: offert_nar är ett ISO-värde", typeof utan.kedja?.offert_nar === "string" && !Number.isNaN(Date.parse(utan.kedja.offert_nar)));

  const b = M.efterUtfall({ utfall: "hallet", resultat: "offert", datum: "2026-11-10" }, IDAG, false, NU);
  ok("offert med eget datum", b.kedja?.uppfoljning_datum === "2026-11-10");

  ok("uppföljning utan datum kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning" }, IDAG, false)) === "Välj ett datum för uppföljningen.");
  ok("uppföljning med tomt datum kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning", datum: "" }, IDAG, false)) === "Välj ett datum för uppföljningen.");
  const c = M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning", datum: "2026-11-05", text: "Ring om budgeten" }, IDAG, false, NU);
  ok("uppföljning: datum, text och nollad räknare", c.kedja?.uppfoljning_datum === "2026-11-05" && c.kedja.uppfoljning_text === "Ring om budgeten" && c.kedja.inget_svar_i_rad === 0);
  ok("uppföljning rör inte offert_nar", c.kedja && !("offert_nar" in c.kedja));

  const d = M.efterUtfall({ utfall: "hallet", resultat: "nej", skal: "För dyrt" }, IDAG, false, NU);
  ok("nej: kedjan avslutas med skälet", d.kedja?.avslut === "nej" && d.kedja.nej_skal === "För dyrt");
  ok("nej: mötet bär resultat och skäl", d.mote.utfall === "hallet" && d.mote.resultat === "nej" && d.mote.nej_skal === "För dyrt");
  ok("nej utan skäl kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "nej" }, IDAG, false)) === "Välj ett skäl.");
  ok("nej med okänt skäl kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "nej", skal: "Därför" }, IDAG, false)) === "Välj ett skäl.");

  const e = M.efterUtfall({ utfall: "uteblev" }, IDAG, false, NU);
  ok("uteblev utan ny tid: i morgon, texten Uteblev", e.kedja?.uppfoljning_datum === "2026-10-30" && e.kedja.uppfoljning_text === "Uteblev", JSON.stringify(e.kedja));
  ok("uteblev: Inget svar i rad nollas", e.kedja?.inget_svar_i_rad === 0);
  ok("uteblev: mötet får utfallet och ingen ny tid", e.mote.utfall === "uteblev" && e.nyttMote === null);

  const f = M.efterUtfall({ utfall: "uteblev", nyTid: { dag: "2026-10-31", start: "10:00" } }, IDAG, false, NU);
  ok("uteblev med ny tid: ombokning", JSON.stringify(f.nyttMote) === JSON.stringify({ art: "ombokning", dag: "2026-10-31", start: "10:00" }));
  ok("uteblev med ny tid: kedjan är orörd", f.kedja === null);

  const g = M.efterUtfall({ utfall: "avbokat" }, IDAG, false, NU);
  ok("avbokat utan hållet möte: kedjan avslutas", g.kedja?.avslut === "avbokat" && g.mote.utfall === "avbokat");
  const h = M.efterUtfall({ utfall: "avbokat" }, IDAG, true, NU);
  ok("avbokat på uppföljningsmöte: inget avslut", h.kedja !== null && !("avslut" in h.kedja));
  ok("avbokat på uppföljningsmöte: i morgon, texten Avbokat", h.kedja?.uppfoljning_datum === "2026-10-30" && h.kedja.uppfoljning_text === "Avbokat" && h.kedja.inget_svar_i_rad === 0);
  const i = M.efterUtfall({ utfall: "uteblev" }, IDAG, true, NU);
  ok("uteblev på uppföljningsmöte: samma som utan hållet (Följ upp)", i.kedja?.uppfoljning_text === "Uteblev" && !("avslut" in i.kedja));

  ok("hållet utan resultat kastar", kastar(() => M.efterUtfall({ utfall: "hallet" }, IDAG, false)) === "Välj vad mötet ledde till.");
  ok("affär kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "affar" }, IDAG, false)) === "Affär sparas när ordern är lagd.");
  ok("fredag: uteblev → måndag", M.efterUtfall({ utfall: "uteblev" }, "2026-10-30", false, NU).kedja?.uppfoljning_datum === "2026-11-02");
  ok("lappen rör aldrig tid och aktör (rutten sätter dem)", ![a, b, d, e, g].some((x) => ["utfall_nar", "utfall_av", "resultat_nar", "resultat_av"].some((k) => k in x.mote)));
}

rubrik("ledigaTider (idag 2026-10-29, nu 13:10)");
{
  const NU2 = "2026-10-29 13:10";
  const t = M.ledigaTider([], IDAG, NU2);
  ok("första tiden är 13:30 i dag, nära", JSON.stringify(t[0]) === JSON.stringify({ dag: "2026-10-29", start: "13:30", nara: true }), JSON.stringify(t[0]));
  const dagar = [...new Set(t.map((x) => x.dag))];
  ok("tio arbetsdagar", dagar.length === 10, `fick ${dagar.length}`);
  ok("bara arbetsdagar", dagar.every((d) => arbetsdagar(d, -1) !== d && arbetsdagar(arbetsdagar(d, -1), 1) === d));
  ok("sista dagen = idag + 9 arbetsdagar", dagar[9] === arbetsdagar(IDAG, 9), dagar[9]);
  ok("helgen hoppas över", !t.some((x) => x.dag === "2026-10-31" || x.dag === "2026-11-01"));
  const heldag = t.filter((x) => x.dag === "2026-10-30").map((x) => x.start);
  ok("en hel dag: var 30:e minut 08:00–16:30", heldag.length === 18 && heldag[0] === "08:00" && heldag[1] === "08:30" && heldag[17] === "16:30", heldag.join(" "));
  ok("i dag börjar efter nu", t.filter((x) => x.dag === IDAG).map((x) => x.start).join() === "13:30,14:00,14:30,15:00,15:30,16:00,16:30");
  ok("nara de tre första arbetsdagarna", dagar.every((d, n) => t.filter((x) => x.dag === d).every((x) => x.nara === (n < 3))));
  ok("i ordning", t.every((x, n) => n === 0 || `${t[n - 1].dag} ${t[n - 1].start}` < `${x.dag} ${x.start}`));

  const u = M.ledigaTider([{ fran: "2026-10-29 14:00", till: "2026-10-29 15:00" }], IDAG, NU2).filter((x) => x.dag === IDAG).map((x) => x.start);
  ok("upptaget 14:00–15:00 tar bort 14:00 och 14:30", u.join() === "13:30,15:00,15:30,16:00,16:30", u.join());
  const v = M.ledigaTider([{ fran: "2026-10-29 14:10", till: "2026-10-29 14:20" }], IDAG, NU2).filter((x) => x.dag === IDAG).map((x) => x.start);
  ok("ett kort upptaget mitt i en tid tar bort tiden", !v.includes("14:00") && v.includes("14:30"), v.join());
  const w = M.ledigaTider([{ fran: "2026-10-29 14:30", till: "2026-10-29 15:00" }], IDAG, NU2, 60).filter((x) => x.dag === IDAG).map((x) => x.start);
  ok("60 min: en tid som skulle slå i upptaget tas bort", !w.includes("14:00") && !w.includes("14:30") && w.includes("15:00") && !w.includes("16:30"), w.join());
  const x = M.ledigaTider([{ fran: "2026-10-29 17:00", till: "2026-10-30 09:00" }], IDAG, NU2).filter((y) => y.dag === "2026-10-30").map((y) => y.start);
  ok("upptaget över midnatt tar bort morgondagens första tider", x[0] === "09:00" && x.length === 16, x.join());
  const y = M.ledigaTider([], IDAG, "2026-10-29 13:30").filter((z) => z.dag === IDAG).map((z) => z.start);
  ok("nu exakt 13:30: första tiden är 14:00", y[0] === "14:00");
  const z = M.ledigaTider([], "2026-10-31", "2026-10-31 09:00");
  ok("startar en lördag: första tiden är måndagen 08:00", z[0].dag === "2026-11-02" && z[0].start === "08:00" && z[0].nara === true);
  const s = M.ledigaTider([], IDAG, "2026-10-29 19:00");
  ok("efter arbetsdagens slut börjar listan i morgon", s[0].dag === "2026-10-30" && s[0].start === "08:00");
}

rubrik("A6: rättningar efter A4-granskningen");
{
  ok("telefonE164: (0) efter landskoden tas bort", M.telefonE164("+46 (0)70-123 45 67") === "+46701234567", `fick ${M.telefonE164("+46 (0)70-123 45 67")}`);
  ok("telefonE164: 0046 (0)70 …", M.telefonE164("0046 (0)70 123 45 67") === "+46701234567");
  ok("telefonE164: +460… avvisas", M.telefonE164("+460701234567") === null && M.telefonE164("+46 0 70 123 45 67") === null);
  ok("telefonE164: 00701234567 avvisas", M.telefonE164("00701234567") === null);
  ok("telefonE164: alltid ^\\+\\d{8,15}$ (det mote_uppslag godtar)", ["070-123 45 67", "08-123 456", "+47 912 34 567"].every((n) => /^\+\d{8,15}$/.test(M.telefonE164(n) ?? "")));
  ok("telefonE164: för kort för uppslaget (under åtta siffror efter +): null", ["0701", "+46 70", "12345 67", "0123"].every((n) => M.telefonE164(n) === null), ["0701", "+46 70", "12345 67", "0123"].map((n) => M.telefonE164(n)).join());

  const I = "2026-10-29";
  const NUX = "2026-10-29T10:00:00.000Z";
  const o1 = M.efterUtfall({ utfall: "hallet", resultat: "offert", text: "   " }, I, false, NUX);
  ok("tom text är saknad: offert får förvalet", o1.kedja?.uppfoljning_text === "Offert skickad", JSON.stringify(o1.kedja));
  const o2 = M.efterUtfall({ utfall: "hallet", resultat: "offert", text: "" }, I, false, NUX);
  ok("tom sträng: förvalet också", o2.kedja?.uppfoljning_text === "Offert skickad");
  const o3 = M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning", datum: "2026-11-05", text: "  " }, I, false, NUX);
  ok("uppföljning med blank text: null", o3.kedja?.uppfoljning_text === null, JSON.stringify(o3.kedja));
  const o4 = M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning", datum: "2026-11-05", text: "  Ring tisdag " }, I, false, NUX);
  ok("text trimmas", o4.kedja?.uppfoljning_text === "Ring tisdag");

  ok("arDatum: riktiga datum", M.arDatum("2026-10-29") === true && M.arDatum("2028-02-29") === true);
  ok("arDatum: datum som inte finns", ["2026-13-45", "2026-02-30", "2026-00-10", "2026-04-31", "2027-02-29", "2026-10-00"].every((d) => M.arDatum(d) === false));
  ok("arDatum: inte en sträng på formen", M.arDatum(null) === false && M.arDatum("2026-1-5") === false && M.arDatum(20261029) === false);
  ok("uppföljning med 2026-02-30 kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "uppfoljning", datum: "2026-02-30" }, I, false)) === "Välj ett datum för uppföljningen.");
  ok("offert med 2026-13-45 kastar", kastar(() => M.efterUtfall({ utfall: "hallet", resultat: "offert", datum: "2026-13-45" }, I, false)) === "Välj ett datum för uppföljningen.");

  // ledigaTider: räkningen av tio dagar börjar där det finns lediga tider.
  const sent = M.ledigaTider([], I, "2026-10-29 19:00");
  const dagar = [...new Set(sent.map((x) => x.dag))];
  ok("nu 19:00: dagens dag är inte med", !dagar.includes(I) && dagar[0] === "2026-10-30");
  ok("nu 19:00: ändå tio arbetsdagar", dagar.length === 10, `fick ${dagar.length}`);
  ok("nu 19:00: sista dagen = i morgon + 9 arbetsdagar", dagar[9] === arbetsdagar("2026-10-30", 9), dagar[9]);
  ok("nu 19:00: nara = de tre första av dem", dagar.every((d, n) => sent.filter((x) => x.dag === d).every((x) => x.nara === (n < 3))));
  const full = M.ledigaTider([{ fran: "2026-10-30 00:00", till: "2026-10-30 23:59" }], I, "2026-10-29 13:10");
  const fd = [...new Set(full.map((x) => x.dag))];
  ok("en helt upptagen dag räknas inte", !fd.includes("2026-10-30") && fd.length === 10 && fd[1] === "2026-11-02", fd.join());
  ok("nara följer räkningen, inte kalendern", fd.every((d, n) => full.filter((x) => x.dag === d).every((x) => x.nara === (n < 3))));
  const inga = M.ledigaTider([{ fran: "2026-01-01 00:00", till: "2027-12-31 23:59" }], I, "2026-10-29 13:10");
  ok("allt upptaget: tomt svar, ingen oändlig slinga", inga.length === 0);
}

rubrik("Frimejl och bolagets domän");
{
  ok("gmail.com är frimejl", M.arFrimejl("gmail.com") === true);
  ok("alla de vanliga", ["hotmail.com", "outlook.com", "live.se", "icloud.com", "yahoo.com", "telia.com"].every((d) => M.arFrimejl(d)));
  ok("exempel.se är det inte", M.arFrimejl("exempel.se") === false && M.arFrimejl(null) === false);
  ok("bolagsDoman: frimejl blir null", M.bolagsDoman("kalle@gmail.com") === null && M.bolagsDoman("https://www.gmail.com") === null);
  ok("bolagsDoman: egen domän", M.bolagsDoman("https://www.Exempel.se/x") === "exempel.se" && M.bolagsDoman("info@exempel.se") === "exempel.se");
  ok("bolagsDoman: skräp och tomt: null", M.bolagsDoman("inte en adress") === null && M.bolagsDoman("") === null && M.bolagsDoman(null) === null);
}

rubrik("lokalTidpunkt och upptagetTillIntervall");
{
  ok("lokalTidpunkt: 08:30", M.lokalTidpunkt("2026-10-29", 8 * 60 + 30) === "2026-10-29 08:30");
  ok("lokalTidpunkt: över midnatt", M.lokalTidpunkt("2026-10-29", 24 * 60 + 15) === "2026-10-30 00:15");
  const u = M.upptagetTillIntervall({
    "2026-10-29": { block: [{ s: 14 * 60, e: 15 * 60, id: null }, { s: 23 * 60, e: 24 * 60 + 30, id: "x" }], ledig: false },
    "2026-10-30": { block: [], ledig: true },
  });
  ok("block blir intervall i lokal tid", JSON.stringify(u[0]) === JSON.stringify({ fran: "2026-10-29 14:00", till: "2026-10-29 15:00" }), JSON.stringify(u[0]));
  ok("block över midnatt", JSON.stringify(u[1]) === JSON.stringify({ fran: "2026-10-29 23:00", till: "2026-10-30 00:30" }), JSON.stringify(u[1]));
  ok("ledig hela dagen = upptagen hela dagen", u.some((x) => x.fran === "2026-10-30 00:00" && x.till >= "2026-10-30 23:59"), JSON.stringify(u));
  ok("tomt in: tomt ut", M.upptagetTillIntervall({}).length === 0 && M.upptagetTillIntervall(undefined).length === 0);
  const t = M.ledigaTider(u, "2026-10-29", "2026-10-29 08:00");
  ok("intervallen tar bort tiderna i ledigaTider", !t.some((x) => x.dag === "2026-10-29" && (x.start === "14:00" || x.start === "14:30")) && !t.some((x) => x.dag === "2026-10-30"));
}

rubrik("bokaIndata");
{
  const HALLS = "11111111-1111-4111-8111-111111111111";
  const bas = { namn: "  Exempel AB ", telefon: "070-123 45 67", kalla: "Offerta", hallsAv: HALLS, dag: "2026-11-02", start: "10:00" };
  const r = M.bokaIndata(bas);
  ok("giltig indata: ok", r.ok === true, JSON.stringify(r));
  const v = r.varden;
  ok("namnet trimmas", v?.namn === "Exempel AB");
  ok("telefonen blir E.164", v?.telefon === "+46701234567");
  ok("längd saknas: 30", v?.langd === 30);
  ok("dag och start", v?.dag === "2026-11-02" && v?.start === "10:00");
  ok("valfria fält som null", v?.kontakt === null && v?.epost === null && v?.doman === null && v?.mal === null && v?.nulage === null && v?.kedja === null && v?.foregaende === null);
  ok("hållaren och källan", v?.hallsAv === HALLS && v?.kalla === "Offerta");

  const fel = (andra) => {
    const x = M.bokaIndata({ ...bas, ...andra });
    return x.ok ? null : x.fel;
  };
  ok("namn saknas", fel({ namn: undefined }) === "Skriv bolagets namn." && fel({ namn: "   " }) === "Skriv bolagets namn." && fel({ namn: 5 }) === "Skriv bolagets namn.");
  ok("telefonnumret går inte att tolka", fel({ telefon: "abc" }) === "Telefonnumret går inte att tolka." && fel({ telefon: "" }) === "Telefonnumret går inte att tolka." && fel({ telefon: undefined }) === "Telefonnumret går inte att tolka.");
  ok("telefon +460… går inte att tolka", fel({ telefon: "+460701234567" }) === "Telefonnumret går inte att tolka.");
  ok("källa saknas", fel({ kalla: " " }) === "Skriv varifrån bolaget kommer.");
  ok("hållare saknas eller är inget id", fel({ hallsAv: undefined }) === "Välj vem som ska hålla mötet." && fel({ hallsAv: "x" }) === "Välj vem som ska hålla mötet.");
  ok("dag som inte finns", fel({ dag: "2026-02-30" }) === "Välj ett datum." && fel({ dag: undefined }) === "Välj ett datum.");
  ok("start måste vara HH:MM", ["10", "25:00", "10:60", "9:00", "10:00:00", undefined, 1000].every((s) => fel({ start: s }) === "Välj en starttid."));
  ok("start i hela femminuters-steg", fel({ start: "10:03" }) === "Välj en starttid." && fel({ start: "10:05" }) === null);
  const sam = M.bokaIndata({ ...bas, dag: undefined, start: "2026-11-03 09:30" });
  ok("start på LOKAL-formen ger dag och start", sam.ok && sam.varden.dag === "2026-11-03" && sam.varden.start === "09:30", JSON.stringify(sam));
  ok("LOKAL-start och en annan dag: fel", fel({ dag: "2026-11-02", start: "2026-11-03 09:30" }) === "Välj en starttid.");
  ok("LOKAL-start med dag som inte finns", fel({ dag: undefined, start: "2026-02-30 09:30" }) === "Välj ett datum.");
  ok("nulage utanför NULAGE", fel({ nulage: "annat" }) === "Välj nuläge." && fel({ nulage: 3 }) === "Välj nuläge.");
  ok("nulage ur NULAGE", ["ingen", "sjalv", "byra"].every((n) => M.bokaIndata({ ...bas, nulage: n }).varden?.nulage === n));
  ok("nulage tomt: null", M.bokaIndata({ ...bas, nulage: "" }).varden?.nulage === null);
  ok("längd 45", M.bokaIndata({ ...bas, langd: 45 }).varden?.langd === 45);
  ok("längd utanför 15–480 eller inget heltal", [14, 481, 30.5, "abc", -1, 0].every((l) => fel({ langd: l }) === "Mötets längd stämmer inte."));
  ok("längd som sträng med siffror går", M.bokaIndata({ ...bas, langd: "60" }).varden?.langd === 60);
  ok("e-post normaliseras", M.bokaIndata({ ...bas, epost: " Kalle@Exempel.SE " }).varden?.epost === "kalle@exempel.se");
  ok("e-post som inte är en adress", fel({ epost: "kalle" }) === "E-postadressen går inte att tolka.");
  ok("e-post tom: null", M.bokaIndata({ ...bas, epost: "  " }).varden?.epost === null);
  ok("domän normaliseras", M.bokaIndata({ ...bas, doman: "https://www.Exempel.se/om" }).varden?.doman === "exempel.se");
  ok("frimejlsdomän sparas aldrig", M.bokaIndata({ ...bas, doman: "gmail.com" }).varden?.doman === null);
  ok("domän som inte går att tolka: null, inget fel", M.bokaIndata({ ...bas, doman: "inte en adress" }).varden?.doman === null);
  ok("kontakt och mål trimmas, tomma blir null", M.bokaIndata({ ...bas, kontakt: " Kalle ", mal: "  " }).varden?.kontakt === "Kalle" && M.bokaIndata({ ...bas, mal: "  " }).varden?.mal === null);
  ok("kedja och föregående måste vara id", fel({ kedja: "x" }) === "Kedjan stämmer inte." && fel({ foregaende: "x" }) === "Det tidigare mötet stämmer inte.");
  ok("kedja och föregående som id", M.bokaIndata({ ...bas, kedja: HALLS, foregaende: HALLS }).varden?.kedja === HALLS && M.bokaIndata({ ...bas, kedja: HALLS, foregaende: HALLS }).varden?.foregaende === HALLS);
  ok("inte ett objekt: fel", M.bokaIndata(null).ok === false && M.bokaIndata("x").ok === false);
  ok("för långt namn", fel({ namn: "x".repeat(201) }) === "Namnet är för långt.");

  const p = M.paminnIndata({ namn: " Exempel AB ", telefon: "070-123 45 67", dag: "2026-11-02", start: "09:00" });
  ok("paminnIndata: ok", p.ok && p.varden.namn === "Exempel AB" && p.varden.telefon === "070-123 45 67" && p.varden.dag === "2026-11-02" && p.varden.start === "09:00", JSON.stringify(p));
  ok("paminnIndata: namn, telefon, dag, start", M.paminnIndata({ telefon: "070-123 45 67", dag: "2026-11-02", start: "09:00" }).fel === "Skriv bolagets namn." && M.paminnIndata({ namn: "A", telefon: "x", dag: "2026-11-02", start: "09:00" }).fel === "Telefonnumret går inte att tolka." && M.paminnIndata({ namn: "A", telefon: "0701234567", dag: "2026-13-02", start: "09:00" }).fel === "Välj ett datum." && M.paminnIndata({ namn: "A", telefon: "0701234567", dag: "2026-11-02", start: "9" }).fel === "Välj en starttid.");
}

rubrik("tolkaUppslag och uppslagsVarning");
{
  const tomt = M.tolkaUppslag(null);
  ok("null och skräp: tomt svar", tomt.samtal.length === 0 && tomt.bokat.length === 0 && tomt.kund === false && M.tolkaUppslag("x").kund === false && M.tolkaUppslag({ samtal: 5, bokat: "x", kund: "ja" }).bokat.length === 0);
  const u = M.tolkaUppslag({
    samtal: [{ vem: "Anna Ek", nar: "2026-10-28T09:00:00Z", sek: 42, riktning: "outbound" }],
    bokat: [{ namn: "Exempel AB", mote_tid: "2026-11-02T09:00:00Z", halls_av_namn: "Kalle Berg" }, { namn: "Utan tid" }],
    kund: true,
  });
  ok("samtal och bokat tolkas, rader utan mötestid slängs", u.samtal.length === 1 && u.samtal[0].sek === 42 && u.bokat.length === 1 && u.bokat[0].halls_av_namn === "Kalle Berg" && u.kund === true);
  const v = M.uppslagsVarning(u, (iso) => `[${iso.slice(0, 10)}]`);
  ok("varning om bokat möte och kund", v === "Exempel AB har redan ett bokat möte [2026-11-02] hos Kalle Berg. Bolaget är redan kund.", String(v));
  ok("ingen varning utan bokat och kund", M.uppslagsVarning({ samtal: u.samtal, bokat: [], kund: false }, () => "") === null);
  ok("bara kund", M.uppslagsVarning({ samtal: [], bokat: [], kund: true }, () => "") === "Bolaget är redan kund.");
}

rubrik("A6 fix: vem som får hålla ett möte");
{
  ok("HALLARE_ROLLER = säljarkretsen", JSON.stringify(M.HALLARE_ROLLER) === JSON.stringify(["salesperson", "team_lead", "sales_manager"]));
  ok("säljare, teamledare och säljchef får hålla", M.arHallare(["salesperson"]) && M.arHallare(["team_lead"]) && M.arHallare(["x", "sales_manager"]));
  ok("andra roller och inga roller får inte", !M.arHallare(["admin"]) && !M.arHallare(["ceo"]) && !M.arHallare([]) && !M.arHallare(null));
}

rubrik("A6 fix 2: paminnIndata håller rubriken under 200 tecken");
{
  const p150 = M.paminnIndata({ namn: "x".repeat(150), telefon: "+46" + " ".repeat(28) + "701234567", dag: "2026-11-02", start: "09:00" });
  ok("namn på 150 tecken och telefon på 40 går", p150.ok === true, JSON.stringify(p150).slice(0, 80));
  ok("rubriken 'Ring ' + namn + ' ' + telefon blir aldrig över 200", p150.ok && `Ring ${p150.varden.namn} ${p150.varden.telefon}`.length <= 200, p150.ok ? String(`Ring ${p150.varden.namn} ${p150.varden.telefon}`.length) : "");
  ok("namn på 151 tecken: fel", M.paminnIndata({ namn: "x".repeat(151), telefon: "0701234567", dag: "2026-11-02", start: "09:00" }).fel === "Namnet är för långt.");
  const tel41 = M.paminnIndata({ namn: "A", telefon: "0701234567".padEnd(41, " 1"), dag: "2026-11-02", start: "09:00" });
  ok("telefon över 40 tecken: fel", tel41.ok === false);
}

rubrik("A7: andringForKund, farAndraKedja och indata för mötets knappar");
{
  const med = M.andringForKund(true);
  ok("Affär med möte: mötet blir Hållet/Affär och kedjan avslutas som affär", med.mote?.utfall === "hallet" && med.mote?.resultat === "affar" && med.kedja.avslut === "affar", JSON.stringify(med));
  const utan = M.andringForKund(false);
  ok("Affär utan möte: bara kedjan", utan.mote === null && utan.kedja.avslut === "affar", JSON.stringify(utan));
  const ID = "11111111-1111-4111-8111-111111111111";
  const ID2 = "22222222-2222-4222-8222-222222222222";
  const dm = { deltagare: [ID] };
  ok("farAndraKedja: deltagare får", M.farAndraKedja({ id: ID, roller: ["salesperson"] }, dm.deltagare));
  ok("farAndraKedja: chef får utan att vara med", M.farAndraKedja({ id: ID2, roller: ["team_lead"] }, dm.deltagare) && M.farAndraKedja({ id: ID2, roller: ["ceo"] }, dm.deltagare));
  ok("farAndraKedja: en annan säljare får inte", !M.farAndraKedja({ id: ID2, roller: ["salesperson"] }, dm.deltagare) && !M.farAndraKedja({ id: ID2, roller: [] }, []));

  // fore: ISO-sträng eller null, aldrig något annat. Strängen går vidare ORÖRD (mikrosekunder).
  const f = (x) => M.foreVarde(x);
  ok("foreVarde: null och saknad är null", f(null).ok && f(null).varden === null && f(undefined).ok && f(undefined).varden === null);
  ok("foreVarde: ISO-sträng med mikrosekunder går orörd", f("2026-10-29T10:00:00.123456+00:00").varden === "2026-10-29T10:00:00.123456+00:00" && f("2026-10-29T10:00:00Z").ok);
  ok("foreVarde: skräp avvisas", !f("igår").ok && !f(5).ok && !f("").ok && !f({}).ok && !f("2026-10-29").ok && !f("2026-10-29T10:00:00.1Z); drop table").ok);

  // utfall
  const u = (o) => M.utfallIndata({ mote: ID, ...o });
  ok("utfallIndata: Hållet + Offert + datum + text", (() => { const r = u({ utfall: "hallet", resultat: "offert", datum: "2026-11-03", text: " Ring tisdag " }); return r.ok && r.varden.mote === ID && r.varden.inn.utfall === "hallet" && r.varden.inn.resultat === "offert" && r.varden.inn.datum === "2026-11-03" && r.varden.inn.text === "Ring tisdag"; })());
  ok("utfallIndata: Uteblev + ny tid", (() => { const r = u({ utfall: "uteblev", nyTid: { dag: "2026-11-02", start: "09:00" } }); return r.ok && r.varden.inn.nyTid.dag === "2026-11-02" && r.varden.inn.nyTid.start === "09:00"; })());
  ok("utfallIndata: okänt utfall och mote som inte är ett id", !u({ utfall: "kanske" }).ok && !M.utfallIndata({ mote: "x", utfall: "hallet" }).ok);
  ok("utfallIndata: ny tid bara med Uteblev, och bara en riktig tid", !u({ utfall: "hallet", resultat: "offert", nyTid: { dag: "2026-11-02", start: "09:00" } }).ok && !u({ utfall: "uteblev", nyTid: { dag: "2026-11-02", start: "9" } }).ok);
  ok("utfallIndata: okänt resultat avvisas, Nej kräver skäl ur listan", !u({ utfall: "hallet", resultat: "kanske" }).ok && u({ utfall: "hallet", resultat: "nej", skal: "För dyrt" }).ok && u({ utfall: "hallet", resultat: "nej", skal: "För dyrt" }).varden.inn.skal === "För dyrt");
  ok("utfallIndata: för lång text avvisas", !u({ utfall: "hallet", resultat: "uppfoljning", datum: "2026-11-03", text: "x".repeat(1001) }).ok);

  // nej, kund, flytta, id
  const SKAL1 = M.NEJ_SKAL[0];
  ok("nejIndata: skäl ur NEJ_SKAL", M.nejIndata({ kedja: ID, skal: SKAL1 }).ok && !M.nejIndata({ kedja: ID, skal: "Bara för att" }).ok && !M.nejIndata({ kedja: ID }).ok && !M.nejIndata({ kedja: "x", skal: SKAL1 }).ok);
  ok("kundIndata: kedja och order, möte valfritt", (() => { const r = M.kundIndata({ kedja: ID, order: ID2 }); const s = M.kundIndata({ kedja: ID, order: ID2, mote: ID }); return r.ok && r.varden.mote === null && s.ok && s.varden.mote === ID && !M.kundIndata({ kedja: ID }).ok && !M.kundIndata({ kedja: ID, order: ID2, mote: "x" }).ok; })());
  ok("flyttaIndata: mote, dag och start (också 'YYYY-MM-DD HH:MM')", (() => { const r = M.flyttaIndata({ mote: ID, dag: "2026-11-02", start: "10:30" }); const s = M.flyttaIndata({ mote: ID, start: "2026-11-02 10:30" }); return r.ok && r.varden.dag === "2026-11-02" && r.varden.start === "10:30" && s.ok && s.varden.dag === "2026-11-02" && !M.flyttaIndata({ mote: ID, dag: "2026-11-02", start: "10:33" }).ok && !M.flyttaIndata({ mote: "x", dag: "2026-11-02", start: "10:30" }).ok; })());
  ok("moteId: bara ett riktigt id", M.moteIndata({ mote: ID }).ok && !M.moteIndata({ mote: "x" }).ok && !M.moteIndata({}).ok);
  ok("kedjaFore: kedja och fore", (() => { const r = M.kedjaFore({ kedja: ID, fore: "2026-10-29T10:00:00.5+00:00" }); const n = M.kedjaFore({ kedja: ID, fore: null }); return r.ok && r.varden.fore === "2026-10-29T10:00:00.5+00:00" && n.ok && n.varden.fore === null && !M.kedjaFore({ kedja: "x", fore: null }).ok && !M.kedjaFore({ kedja: ID, fore: "igår" }).ok; })());
}

rubrik("Fixrunda 1: läsläge, bokning i befintlig kedja, flytt nollställer Bekräftat");
{
  ok("arSkrivning: alla skrivningar spärras i läsläge", ["boka", "paminn", "bekrafta", "flytta", "avboka", "utfall", "kund", "nej", "inget_svar", "prova_igen"].every((h) => M.arSkrivning(h)));
  ok("arSkrivning: uppslag och lediga (och samtal, okänt) spärras inte", !M.arSkrivning("uppslag") && !M.arSkrivning("lediga") && !M.arSkrivning("samtal") && !M.arSkrivning("okand") && !M.arSkrivning(""));
  const e = M.efterBokning("2026-10-30T09:00:00.000Z");
  ok("efterBokning: räknaren 0 och versionen = nu", e.inget_svar_i_rad === 0 && e.uppfoljning_andrad === "2026-10-30T09:00:00.000Z" && Object.keys(e).length === 2, JSON.stringify(e));
  ok("SQL_FLYTTA_MOTE nollställer bekräftat och villkoras på utfall och nuvarande tid", /bekraftat_nar = null, bekraftat_av = null/.test(M.SQL_FLYTTA_MOTE) && /utfall is null/.test(M.SQL_FLYTTA_MOTE) && /mote_tid = \$4/.test(M.SQL_FLYTTA_MOTE));
}

rubrik("Slutgranskningen: farKopplaOrder");
{
  const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
  ok("order lagd av en deltagare får kopplas", M.farKopplaOrder({ id: C, roller: ["salesperson"] }, [A], { salesperson_id: B, created_by: A }));
  ok("order som tillhör en deltagare får kopplas", M.farKopplaOrder({ id: C, roller: ["salesperson"] }, [A], { salesperson_id: A, created_by: B }));
  ok("order som ingen i kedjan rör får inte kopplas av en säljare", !M.farKopplaOrder({ id: C, roller: ["salesperson"] }, [A], { salesperson_id: B, created_by: B }) && !M.farKopplaOrder({ id: C, roller: [] }, [], { salesperson_id: null, created_by: null }));
  ok("en chef får koppla vilken order som helst", M.farKopplaOrder({ id: C, roller: ["team_lead"] }, [A], { salesperson_id: B, created_by: B }) && M.farKopplaOrder({ id: C, roller: ["admin"] }, [], { salesperson_id: null, created_by: null }));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);
