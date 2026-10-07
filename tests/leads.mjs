#!/usr/bin/env node
/**
 * Leads från hemsidan (0076). Ren logik, ingen databas.
 *
 * Det som provas är tolkningen av det formulärverktygen skickar — den del som
 * avgör om ett lead når säljaren eller tyst försvinner. Mottagarens databasdel
 * (dubbletter, taket per timme) provas mot riktiga databasen vid migrationen.
 *
 *   node --experimental-strip-types tests/leads.mjs
 */
import {
  alder,
  antalLankar,
  DOLT_NUMMER,
  leadTitel,
  leadUndertitel,
  maskeraPersonnummer,
  normaliseraEpost,
  normaliseraTelefon,
  nyckel,
  plattaUt,
  tolkaInskick,
  STATUSAR,
  STATUS_ETIKETT,
  STATUS_TON,
  OPPNA,
} from "../src/lib/leads.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mFältnamn\x1b[0m");
{
  ok("E-post → epost", nyckel("E-post") === "epost");
  ok("your-name → yourname", nyckel("your-name") === "yourname");
  ok("Företag → foretag", nyckel("Företag") === "foretag");
  ok("utm_source → utmsource", nyckel("utm_source") === "utmsource");
}

console.log("\n\x1b[1mSvenskt formulär, platt JSON\x1b[0m");
{
  const t = tolkaInskick({
    namn: "Anna Andersson",
    "företag": "Provbolaget AB",
    "e-post": "  Anna@Provbolaget.SE ",
    telefon: "070-123 45 67",
    meddelande: "Vi vill veta mer om er tjänst.",
    sida: "https://clicknet.se/kontakt",
    utm_source: "google",
    budget: "50 000 kr",
  });
  ok("tolkades", t.ok);
  ok("inte spam", t.ok && t.spam === null);
  ok("namnet", t.ok && t.lead.name === "Anna Andersson");
  ok("företaget", t.ok && t.lead.company === "Provbolaget AB");
  ok("e-posten med små bokstäver och utan blanksteg", t.ok && t.lead.email === "anna@provbolaget.se");
  ok("telefonen som bara siffror", t.ok && t.lead.phone === "0701234567", t.ok ? t.lead.phone : "");
  ok("sidan", t.ok && t.lead.page_url === "https://clicknet.se/kontakt");
  ok("utm", t.ok && t.lead.utm_source === "google");
  ok("okänt fält under Övriga", t.ok && t.lead.extra.budget === "50 000 kr");
  ok("källan förvald till hemsida", t.ok && t.lead.source === "hemsida");
}

console.log("\n\x1b[1mEngelska fält och för- och efternamn var för sig\x1b[0m");
{
  const t = tolkaInskick({ first_name: "Bo", last_name: "Berg", email: "bo@berg.se", company: "Berg & Son" });
  ok("namnet sätts ihop", t.ok && t.lead.name === "Bo Berg");
  ok("utan telefon går det ändå", t.ok && t.lead.phone === null);
}

console.log("\n\x1b[1mVerktygens inlindningar\x1b[0m");
{
  const webflow = tolkaInskick({ name: "Kontaktformulär", site: "abc", data: { Namn: "Cia", Email: "cia@x.se" } });
  ok("Webflow (data)", webflow.ok && webflow.lead.email === "cia@x.se");
  ok("Webflow: kundens namn, inte formulärets", webflow.ok && webflow.lead.name === "Cia", webflow.ok ? webflow.lead.name : "");
  ok("Webflow: sajtens id sparas inte", webflow.ok && !("site" in webflow.lead.extra));

  const webflow2 = tolkaInskick({ triggerType: "form_submission", payload: { data: { Telefon: "+46 70 111 22 33" } } });
  ok("Webflow (payload.data)", webflow2.ok && webflow2.lead.phone === "0701112233", webflow2.ok ? webflow2.lead.phone : "");

  const elementor = tolkaInskick({ fields: { email: { value: "d@d.se" }, message: { value: "Hej" } } });
  ok("Elementor (fields.x.value)", elementor.ok && elementor.lead.email === "d@d.se" && elementor.lead.message === "Hej");

  ok("plattaUt tål en sträng", Object.keys(plattaUt("hej")).length === 0);
  ok("plattaUt tål null", Object.keys(plattaUt(null)).length === 0);
}

console.log("\n\x1b[1mEtt lead måste gå att kontakta\x1b[0m");
{
  const t = tolkaInskick({ namn: "Anonym", meddelande: "Hej" });
  ok("utan e-post och telefon nekas", !t.ok);

  const tom = tolkaInskick({});
  ok("tom kropp nekas", !tom.ok);

  const fel1 = tolkaInskick({ email: "inte-en-adress", telefon: "0701234567" });
  ok("ogiltig e-post släpps men leadet går in på telefonen", fel1.ok && fel1.lead.email === null);
  ok("den ogiltiga e-posten syns under Övriga", fel1.ok && fel1.lead.extra["E-post (ogiltig)"] === "inte-en-adress");

  const bara = tolkaInskick({ email: "inte-en-adress" });
  ok("bara en ogiltig e-post nekas", !bara.ok);
}

console.log("\n\x1b[1mSpam\x1b[0m");
{
  const robot = tolkaInskick({ email: "a@b.se", _honeypot: "http://spam.example" });
  ok("ifylld honungsfälla", robot.ok && robot.spam === "honungsfalla");

  const tomFalla = tolkaInskick({ email: "a@b.se", _honeypot: "" });
  ok("tom honungsfälla är en människa", tomFalla.ok && tomFalla.spam === null);
  ok("honungsfältet hamnar inte i Övriga", tomFalla.ok && !("_honeypot" in tomFalla.lead.extra));

  const lankar = tolkaInskick({
    email: "a@b.se",
    message: "Köp nu http://a.example http://b.example www.c.example",
  });
  ok("tre länkar i meddelandet", lankar.ok && lankar.spam === "lankar");
  ok("två länkar går bra", antalLankar("se https://a.se och https://b.se") === 2);

  const website = tolkaInskick({ email: "a@b.se", website: "https://kund.se" });
  ok("ett fält som heter website är INTE en fälla", website.ok && website.spam === null);
  ok("…utan hamnar under Övriga", website.ok && website.lead.extra.website === "https://kund.se");

  const brus = tolkaInskick({ email: "a@b.se", "g-recaptcha-response": "xyz", form_id: "12" });
  ok("verktygens egna fält sparas inte", brus.ok && Object.keys(brus.lead.extra).length === 0);
}

console.log("\n\x1b[1mK27 — personnummer\x1b[0m");
{
  ok("ett personnummer döljs", maskeraPersonnummer("mitt nr 850101-1234 tack") === `mitt nr ${DOLT_NUMMER} tack`);
  ok("tolv siffror döljs", !/\d{6}[-+]?\d{4}/.test(maskeraPersonnummer("198501011234")));
  ok("två nummer döljs båda", maskeraPersonnummer("850101-1234 och 900202-5678").split(DOLT_NUMMER).length === 3);
  ok("text utan nummer orörd", maskeraPersonnummer("Ring efter 14") === "Ring efter 14");

  const t = tolkaInskick({
    email: "a@b.se",
    meddelande: "Enskild firma, orgnr 850101-1234",
    "företag": "Firma 8501011234",
    orgnr: "850101-1234",
  });
  const villkor = (s) => !/\d{6}[-+]?\d{4}/.test(s ?? "");
  ok("meddelandet passerar 0076:s villkor", t.ok && villkor(t.lead.message));
  ok("företaget passerar", t.ok && villkor(t.lead.company));
  ok("Övriga fält passerar (som JSON)", t.ok && villkor(JSON.stringify(t.lead.extra)));
  ok("telefonfältet maskeras inte", normaliseraTelefon("0701234567") === "0701234567");
}

console.log("\n\x1b[1mTelefon och e-post\x1b[0m");
{
  ok("+46 blir 0", normaliseraTelefon("+46 70-123 45 67") === "0701234567");
  ok("0046 blir 0", normaliseraTelefon("0046701234567") === "0701234567");
  ok("utländskt behåller plus", normaliseraTelefon("+47 912 34 567") === "+4791234567");
  ok("för kort är inget nummer", normaliseraTelefon("123") === null);
  ok("bokstäver är inget nummer", normaliseraTelefon("ring mig") === null);
  ok("e-post utan domän", normaliseraEpost("anna@") === null);
  ok("e-post med blanksteg i mitten", normaliseraEpost("an na@x.se") === null);
}

console.log("\n\x1b[1mLängder\x1b[0m");
{
  const lang = "x".repeat(6000);
  const t = tolkaInskick({ email: "a@b.se", message: lang });
  ok("meddelandet klipps till 5000", t.ok && t.lead.message.length === 5000);

  const manga = { email: "a@b.se" };
  for (let i = 0; i < 100; i++) manga[`falt${i}`] = "v";
  const m = tolkaInskick(manga);
  ok("högst 40 övriga fält", m.ok && Object.keys(m.lead.extra).length === 40);

  const tunga = { email: "a@b.se" };
  for (let i = 0; i < 30; i++) tunga[`falt${i}`] = "y".repeat(2000);
  const tt = tolkaInskick(tunga);
  ok("Övriga fält ryms i 0076:s tak", tt.ok && JSON.stringify(tt.lead.extra).length < 15_000);

  const svenska = { email: "a@b.se" };
  for (let i = 0; i < 40; i++) svenska[`f${i}`] = "å".repeat(1500);
  const sv = tolkaInskick(svenska);
  ok("taket räknas i byte — å, ä och ö är två", sv.ok && new TextEncoder().encode(JSON.stringify(sv.lead.extra)).length < 15_000);
}

console.log("\n\x1b[1mVisning\x1b[0m");
{
  const l = { company: "Bolaget AB", name: "Anna", email: "a@b.se", phone: "070" };
  ok("titeln är företaget", leadTitel(l) === "Bolaget AB");
  ok("undertiteln har personen och kontaktvägarna", leadUndertitel(l) === "Anna · a@b.se · 070");
  ok("utan företag är titeln personen", leadTitel({ ...l, company: null }) === "Anna");
  ok("utan något är titeln e-posten", leadTitel({ company: null, name: null, email: "a@b.se", phone: null }) === "a@b.se");
  ok("e-posten upprepas inte i undertiteln", leadUndertitel({ company: null, name: null, email: "a@b.se", phone: null }) === "");

  const nu = new Date("2026-10-07T12:00:00Z");
  ok("minuter", alder("2026-10-07T11:48:00Z", nu) === "12 min");
  ok("timmar", alder("2026-10-07T09:00:00Z", nu) === "3 h");
  ok("dagar", alder("2026-10-04T12:00:00Z", nu) === "3 d");
}

console.log("\n\x1b[1mStatusarna\x1b[0m");
{
  ok("alla har en etikett", STATUSAR.every((s) => typeof STATUS_ETIKETT[s] === "string"));
  ok("alla har en ton", STATUSAR.every((s) => typeof STATUS_TON[s] === "string"));
  ok("öppna är en delmängd", OPPNA.every((s) => STATUSAR.includes(s)));
}

console.log(fel === 0
  ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n"
  : `\n\x1b[31m${fel} kontroll(er) underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
