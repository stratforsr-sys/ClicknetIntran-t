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
import { moteNyss, nyTilldelning, tilldelaVillkorat } from "../src/lib/nav2/leadsforma.ts";
import { readFileSync } from "node:fs";

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

console.log("\n\x1b[1mNav 2.0: ett steg på ett otilldelat lead (granskningen F2-1)\x1b[0m");
{
  const CHEF = "11111111-1111-4111-8111-111111111111", ELIN = "22222222-2222-4222-8222-222222222222";
  const NU = "2026-10-23T09:00:00.000Z";
  const t = nyTilldelning({ assigned_to: null }, CHEF, true, NU);
  ok("fördelaren som sparar ett utfall får leadet", !!t && t.assigned_to === CHEF);
  ok("och tiden hen fick det", !!t && t.assigned_at === NU);
  ok("ett lead som redan har säljare byter inte säljare", nyTilldelning({ assigned_to: ELIN }, CHEF, true, NU) === null);
  ok("säljarens eget lead ändras inte", nyTilldelning({ assigned_to: ELIN }, ELIN, false, NU) === null);
  ok("den som inte fördelar får inget otilldelat lead", nyTilldelning({ assigned_to: null }, ELIN, false, NU) === null);
}

console.log("\n\x1b[1mNav 2.0: ett lead ges till en säljare (granskningen F2-2)\x1b[0m");
{
  const LID = "33333333-3333-4333-8333-333333333333";
  const ELIN = "22222222-2222-4222-8222-222222222222", SARA = "44444444-4444-4444-8444-444444444444";
  const NAMN = { [ELIN]: "Elin Ek", [SARA]: "Sara Sund" };
  // Den falska kedjan: läsningar i tur och ordning, och hur många rader uppdateringen ändrar.
  const falsk = (lasningar, antal) => {
    const a = { uppdatera: [], efter: 0 };
    return {
      a,
      dep: {
        las: async () => (lasningar.length ? lasningar.shift() : null),
        uppdatera: async (id, till, vantad) => { a.uppdatera.push([id, till, vantad]); return antal; },
        namn: async (id) => NAMN[id] ?? null,
        efter: async () => { a.efter++; },
      },
    };
  };
  const lead = (vem) => ({ id: LID, assigned_to: vem });

  let f = falsk([lead(null), lead(ELIN)], 0);
  let r = await tilldelaVillkorat(f.dep, LID, SARA, null);
  ok("två fördelare samtidigt: 0 rader ger fel", r.fel === "Leadet har redan getts till Elin.", r.fel);
  ok("och ingen notis eller mejl", f.a.efter === 0);
  ok("uppdateringen var villkorad på ingen säljare", f.a.uppdatera.length === 1 && f.a.uppdatera[0][2] === null);

  f = falsk([lead(null)], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, null);
  ok("1 rad: ingen fel", !r.fel && r.andrad === true);
  ok("1 rad: notisen och mejlet en gång", f.a.efter === 1);

  f = falsk([lead(ELIN)], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, null);
  ok("sidan laddades före automatiken: samma besked", r.fel === "Leadet har redan getts till Elin.", r.fel);
  ok("och ingen uppdatering alls", f.a.uppdatera.length === 0 && f.a.efter === 0);

  f = falsk([lead(ELIN)], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, ELIN);
  ok("Ge till någon annan med rätt föregående: går", !r.fel && r.andrad === true && f.a.uppdatera[0][2] === ELIN);

  f = falsk([lead(ELIN)], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, undefined);
  ok("gamla Nav utan fore: villkoret är det som lästes", !r.fel && f.a.uppdatera[0][2] === ELIN && f.a.efter === 1);

  f = falsk([lead(ELIN), lead(SARA)], 0);
  r = await tilldelaVillkorat(f.dep, LID, SARA, undefined);
  ok("gamla Nav: samma lead ändrat under tiden ger samma besked", r.fel === "Leadet har redan getts till Sara.", r.fel);

  f = falsk([lead(SARA)], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, undefined);
  ok("redan hos den det ska till: ingen ändring och ingen notis", !r.fel && r.andrad === false && f.a.uppdatera.length === 0 && f.a.efter === 0);

  f = falsk([lead(null), lead(null)], 0);
  r = await tilldelaVillkorat(f.dep, LID, SARA, ELIN);
  ok("tilldelningen togs bort under tiden: säg att det ändrats", typeof r.fel === "string" && /ändrats/.test(r.fel), r.fel);

  f = falsk([], 1);
  r = await tilldelaVillkorat(f.dep, LID, SARA, null);
  ok("leadet finns inte", r.fel === "Leadet finns inte.");
}

console.log("\n\x1b[1mNav 2.0: Möte bokat en gång (granskningen F2-3)\x1b[0m");
{
  const ELIN = "22222222-2222-4222-8222-222222222222", SARA = "44444444-4444-4444-8444-444444444444";
  const nu = Date.parse("2026-10-23T09:00:00.000Z");
  const s = (sek, extra = {}) => ({ kind: "forsok", outcome: "mote", actor_id: ELIN, at: new Date(nu - sek * 1000).toISOString(), ...extra });
  ok("ett möte av samma säljare för 5 s sedan nekas", moteNyss([s(5)], ELIN, nu) === true);
  ok("efter 61 s går ett nytt möte", moteNyss([s(61)], ELIN, nu) === false);
  ok("en annan säljares möte räknas inte", moteNyss([s(5, { actor_id: SARA })], ELIN, nu) === false);
  ok("ett annat utfall räknas inte", moteNyss([s(5, { outcome: "svar" })], ELIN, nu) === false);
  ok("inga steg", moteNyss([], ELIN, nu) === false);
}

console.log("\n\x1b[1mNav 2.0: ordningen i Efter samtalet (granskningen S07, V1)\x1b[0m");
{
  // Rutten går inte att köra utan Next, så ordningen läses ur källan: steget skrivs före mötet,
  // så att ett andra "Möte bokat" ser det och Ångra finns, och inget kastas efter att mötet skapats.
  const src = readFileSync(new URL("../src/app/nav2/leads/route.ts", import.meta.url), "utf8");
  const a = src.indexOf("const forsok = async"), e = src.indexOf("\n  };\n", a);
  const f = a >= 0 && e > a ? src.slice(a, e) : "";
  ok("forsok finns i rutten", f.length > 0);
  const steg = f.indexOf('await steg(l, "forsok"'), mote = f.indexOf("await skapaMote(");
  ok("steget skrivs efter den villkorade uppdateringen", steg > f.indexOf("await andraVillkorat("));
  ok("steget skrivs före mötet", steg >= 0 && mote > steg);
  ok("ett möte som inte gick att boka tar bort steget igen", /if \(m\.fel \|\| !m\.eventId\) \{[\s\S]*?lead_event"\)\.delete\(\)\.eq\("id", h\)/.test(f));
  ok("ingenting kastas efter att mötet skapats", !/throw /.test(f.slice(mote)));
}

console.log(fel === 0
  ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n"
  : `\n\x1b[31m${fel} kontroll(er) underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
