#!/usr/bin/env node
/**
 * TACKNINGSPROVET: varje muterande server action ar bokford.
 *
 * ===========================================================================
 * VARFOR DET HAR PROVET FINNS
 *
 * Migration 0018 valde bort en notistabell med ett argument som holl i ett ar:
 * "en notistabell kraver att varje producent kommer ihag att skriva sin rad,
 * och den som glommer ger en tyst lucka."
 *
 * 0047 infor en sadan tabell anda — for de poster som inte GAR att harleda, se
 * rubriken dar. Invandningen forsvinner inte for att behovet ar akta, och det
 * har provet ar svaret pa den. En glomd notis upptacks har, i stallet for av
 * den som inte fick den.
 *
 * REGELN: varje exporterad server action i `src/app/**\/actions.ts` ska sta i
 * `TACKNING` nedan med ett av tre varden:
 *
 *   "notifierar"  — anropar `notifiera()` eller `notifieraFlera()`. Provet
 *                   LASER FILEN och faller om anropet inte finns pa riktigt.
 *   "harledd"     — posten raknas fram i `notiser-server.ts` eller
 *                   `coachning-server.ts` ur raderna handlingen skriver.
 *   <en mening>    — skalet till att handlingen inte notifierar nagon.
 *
 * En ny action som ingen tankt pa hamnar i ingen av grupperna, och provet
 * faller med dess namn. Samma konstruktion som `tests/handelselogg.mjs`, och av
 * samma skal: en lista som underhalls for hand slutar stamma tyst.
 * ===========================================================================
 *
 *   node tests/notiser-tackning.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROT = new URL("../src/app", import.meta.url).pathname;

/**
 * Bokforingen. Nyckeln ar `<modulvag>::<funktion>`, dar modulvagen ar sokvagen
 * under `src/app` utan `/actions.ts` — alltsa den vag anvandaren ser i webblasaren.
 */
const TACKNING = {
  // ---------------------------------------------------------------------------
  // Coachning
  // ---------------------------------------------------------------------------
  "coachning::skapaUppgift": "harledd",
  "coachning::paborjaUppgift":
    "En anteckning om att arbetet startat. Den som borjade vet om det, och chefen ser det i lagvyn.",
  "coachning::lamnaIn": "harledd",
  "coachning::kvittera": "notifierar",
  "coachning::avbrytUppgift": "notifierar",
  "coachning::skapaSamtal": "notifierar",
  "coachning/mallar::skapaMall":
    "En mall ar en plan, inte en handelse om en person. Ingen har fatt nagot.",
  "coachning/mallar::tillampaMall": "harledd",

  // ---------------------------------------------------------------------------
  // Arenden
  // ---------------------------------------------------------------------------
  "arenden::skapaArende": "harledd",
  "arenden::svara": "harledd",
  "arenden::andraStatus": "notifierar",
  "arenden::tilldela": "notifierar",

  // ---------------------------------------------------------------------------
  // Kundorder
  // ---------------------------------------------------------------------------
  "order::skapaOrder": "Ett utkast ar saljarens eget och har inte natt nagon.",
  "order::skickaInOrder": "notifierar",
  "order::godkannOrder": "notifierar",
  "order::returneraOrder": "notifierar",
  "order::makuleraOrder": "notifierar",
  "order::markeraBetald": "notifierar",
  "order::raderaUtkast": "Ett utkast som aldrig skickades in.",
  "order::forberedOrderbilaga": "Forbereder en uppladdning pa den egna ordern.",
  "order::registreraOrderbilaga": "Bilaga pa den egna ordern.",
  "order::taBortOrderbilaga": "Bilaga pa den egna ordern.",
  "order::lasAvtalsforslag": "Laser en PDF och skriver ingenting.",
  "order::rattaFranAvtal": "Rattar det egna utkastet.",

  // ---------------------------------------------------------------------------
  // Tid
  // ---------------------------------------------------------------------------
  "tid::stampla": "Den som stamplar vet att hon stamplade.",
  "tid::begarRattelse": "notifierar",
  "tid::beslutaRattelse": "notifierar",
  "tid::sparaArbetsschema": "notifierar",
  "tid::sparaRastschema": "notifierar",
  "tid::kvitteraRastschema": "Egen kvittens pa ett schema man just last.",
  "tid::kommenteraAvvikelse": "notifierar",
  "tid/lonerapport::skapaPeriod":
    "En tom period ar ingen handelse. Attesten ar beskedet, och den notifierar.",
  "tid/lonerapport::generera":
    "Underlaget gar att generera om hur manga ganger som helst innan attesten. Ett besked per omgang hade varit brus.",
  "tid/lonerapport::attestera": "notifierar",
  "tid/lonerapport::laggJustering": "notifierar",
  "tid/lonerapport::avslutaAvvikelse": "notifierar",
  "tid/ogiltig-franvaro::godkannHandelse": "harledd",
  "tid/ogiltig-franvaro::avvisaHandelse":
    "Ett avvisat forslag nadde ALDRIG den det gallde — RLS i 0037 slapper fram raden forst nar den ar beslutad. Att notifiera hade varit att beratta om en anklagelse som lades ned.",
  "tid/ogiltig-franvaro::havHandelse": "notifierar",
  "tid/ogiltig-franvaro::laggUppHandelse": "harledd",
  "tid/sparrar::kopplaDokument": "Konfiguration av en sparr, inte en handelse om nagon.",
  "tid/sparrar::slaPa": "Modulsparr. Regel- och driftandringar star i /logg (beslut 2026-09-03).",
  "tid/sparrar::slaAv": "Modulsparr. Regel- och driftandringar star i /logg (beslut 2026-09-03).",

  // ---------------------------------------------------------------------------
  // Franvaro
  // ---------------------------------------------------------------------------
  "franvaro::forhandsgranska": "Laser och raknar. Skriver ingenting.",
  "franvaro::skickaAnsokan": "harledd",
  "franvaro::draTillbaka": "notifierar",
  "franvaro::beslutaAnsokan": "harledd",
  "franvaro::stallInLedighet": "notifierar",
  "franvaro::registreraSjuk": "harledd",
  "franvaro::bekraftaSjuk": "notifierar",
  "franvaro::avslutaSjuk": "notifierar",
  "franvaro::stallInSjuk": "notifierar",
  "franvaro::kvitteraFrist":
    "Bockningen TAR BORT `sjuk-frist` ur bade den sjukes och chefens klocka. Ett besked om att en paminnelse slutat galla ar en paminnelse till.",
  "franvaro::mataInSaldo": "notifierar",
  "franvaro::skapaFlode": "Ett kalenderfloede at en sjalv.",
  "franvaro::rotaFlode": "Ett kalenderfloede at en sjalv.",
  "franvaro::forberedIntyg": "Forbereder en uppladdning; fristen kvitteras separat.",
  "franvaro::registreraIntyg": "Slacker `sjuk-frist`. Samma skal som `kvitteraFrist`.",
  "franvaro/regler::sparaTyp": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "franvaro/regler::sparaPolicy": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "franvaro/regler::sparaSparrperiod": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "franvaro/regler::sparaTak": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "franvaro/regler::sparaRingordning": "Regelandring. Star i /logg (beslut 2026-09-03).",

  // ---------------------------------------------------------------------------
  // Avtal
  // ---------------------------------------------------------------------------
  "avtal::sparaMall": "En mall ar ingen handelse om en person.",
  "avtal::sattMallstatus": "En mall ar ingen handelse om en person.",
  "avtal::skapaAvtal": "Ett utkast som annu inte utfardats nar ingen.",
  "avtal::utfardaAvtal": "harledd",
  "avtal::draTillbakaAvtal": "notifierar",
  "avtal::raderaUtkast": "Ett utkast som aldrig utfardades.",

  // ---------------------------------------------------------------------------
  // Rutiner
  // ---------------------------------------------------------------------------
  "rutiner::skapaDokument": "Ett utkast ar inte publicerat och riktar sig till ingen.",
  "rutiner::sparaDokument": "harledd",
  "rutiner::kvittera": "Egen kvittens. Den slacker sin egen notis.",
  "rutiner::markeraGranskad": "harledd",
  "rutiner::arkivera": "notifierar",
  "rutiner::forberedBilaga":
    "En bilaga skapar med FLIT ingen ny version (se rubriken i filen) — alltsa inget nytt kvittenskrav och ingen notis.",
  "rutiner::registreraBilaga": "Samma skal som `forberedBilaga`.",
  "rutiner::taBortBilaga": "Samma skal som `forberedBilaga`.",

  // ---------------------------------------------------------------------------
  // Personal och konto
  // ---------------------------------------------------------------------------
  "personal::laggUppAnstalld":
    "notifierar via `laggUppAnstalld()` i lib/anstallning-server.ts, som ar gemensam for /personal/ny och /rekrytering/[id]/anstall.",
  "personal::aterstallLosenord": "notifierar",
  "personal::andraRoll": "notifierar",
  "personal::aktivera": "notifierar",
  "personal::offboarda":
    "Kontot ar stangt i samma skrivning. Mottagaren kan inte logga in och skulle aldrig se raden.",
  "personal::hamtaReferenser": "Laser. Skriver ingenting.",
  "personal::taBortAnstalld": "Personen finns inte langre (0046). Det finns ingen mottagare.",
  "personal::kvitteraOffboarding": "Checklistan ar chefens egen arbetslista, inte ett besked.",
  "personal::kvitteraOnboarding": "Checklistan ar chefens egen arbetslista, inte ett besked.",
  "personal::skapaTeam": "Ett tomt team har inga medlemmar att beratta for.",
  "personal::sparaTeam":
    "Andrar teamets namn och ledare. Bytet av CHEF for en enskild person gar genom `sattOrganisation`, som notifierar.",
  "personal::taBortTeam": "Ett team gar bara att ta bort nar det ar tomt.",
  "personal::sattOrganisation": "notifierar",
  "personal::andraBehorighet": "notifierar",

  // ---------------------------------------------------------------------------
  // Rekrytering
  // ---------------------------------------------------------------------------
  "rekrytering::nyKandidat": "notifierar",
  "rekrytering::flyttaSteg": "notifierar",
  "rekrytering::sparaScorecard":
    "Ett omdome om en manniska, skrivet av en namngiven kollega. Det lases pa kandidatkortet dar man anda star nar man skriver sitt eget — och en notis om nagon annans omdome fore sitt eget hade fargat det.",
  "rekrytering::registreraNoShow": "notifierar",
  "rekrytering::sattTalangpool": "En flagga med samtycke. Kandidaten har inget konto i navet.",
  "rekrytering::anstallKandidat": "notifierar",

  // ---------------------------------------------------------------------------
  // Nyheter, fel, provision, K&V, lonekostnad
  // ---------------------------------------------------------------------------
  "nyheter::markeraNavnyhetLast":
    "Egen kvittens pa en slapplistepost. Den skriver samma rad i `notification_dismissed` som klockans kryss — alltsa raka motsatsen till att skicka en notis.",
  "nyheter::skapaNyhet": "Ett utkast riktar sig till ingen.",
  "nyheter::publiceraNyhet": "harledd",
  "nyheter::arkiveraNyhet":
    "Inlagget slutar synas. Ingen vantade pa det, och `nyhet`-posten slocknar av sig sjalv.",
  "fel::rapporteraFel": "harledd",
  "fel::sattStatus": "harledd",
  "provision::bokforProvision": "harledd",
  "provision/regler::sparaNiva": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "provision/regler::stangNiva": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "provision/regler::sparaKonsekvenssteg": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "provision/regler::taBortKonsekvenssteg": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "kv::registreraSamtal":
    "Ett registrerat samtal ar underlag. BEDOMNINGEN ar beskedet, och den harleds som `kv-bedomning`.",
  "kv::sparaBedomning": "harledd",
  "kv/regler::sparaOmrade": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "kv/regler::sparaRegler": "Regelandring. Star i /logg (beslut 2026-09-03).",
  "lonekostnad::sparaSats": "Regelandring. Foraldrade satser ger ett arende via nattjobbet (E15.8).",
  "lonekostnad::sparaLon":
    "Lonen ar en uppgift OM en person som hon inte far se sjalv i navet — lonekostnadsvyn ar behorighetsstyrd (AC-13.13). En notis hade lackt att nagon rort talet.",
  "lonekostnad::sparaFodelsear": "Underlag for arbetsgivaravgift. Ingen handelse.",
  "lonekostnad::sparaIntakt": "Bolagets intakt, inte en uppgift om en person.",
  "lonekostnad::raknaPeriod": "Raknar om en period. Skriver inget om nagon enskild.",

  // ---------------------------------------------------------------------------
  // Utbildning
  // ---------------------------------------------------------------------------
  "utbildning::skapaKurs": "Ett utkast riktar sig till ingen.",
  "utbildning::sparaKurs": "harledd",
  "utbildning::sparaModul":
    "Kursnotisen bar `X av Y moduler klara` och foljer med av sig sjalv nar antalet andras.",
  "utbildning::taBortModul": "Samma skal som `sparaModul`.",
  "utbildning::flyttaModul": "Andrar bara ordningen.",
  "utbildning::klarModul": "Egen progress. Kursnotisen raknar om sig sjalv.",
  "utbildning::lamnaQuiz":
    "Resultatet visas direkt pa sidan, godkant som underkant. En notis om nagot man just last pa skarmen ar ett eko — och en om vantetiden till nasta forsok star i kursnotisen.",
  "utbildning::forberedRollspel": "Forbereder en uppladdning; inlamningen ar handelsen.",
  "utbildning::registreraRollspel": "harledd",
  "utbildning::bedomRollspel": "harledd",

  // ---------------------------------------------------------------------------
  // Eget konto och angra
  // ---------------------------------------------------------------------------
  "profil::bytLosenord": "Den egna handlingen. En notis till sig sjalv ar ett eko.",
  "profil::skickaKod": "Den egna handlingen.",
  "profil::verifieraKod": "Den egna handlingen.",
  "profil::glomEnheten": "Den egna handlingen.",
  "angra::angra":
    "Kvittot med angra-knappen visas bara for den som NYSS gjorde atgarden, och varje gren gor om behorighetskontrollen. Angraren ar alltsa alltid samma person som utforaren, och `notifiera()` skickar aldrig till aktoren. Se rubriken i notiser.ts.",
};

/** Filer som exporterar saker som inte ar server actions. */
const UTANFOR = new Set(["logga-in", "byt-losenord"]);

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

/** Alla actions.ts under src/app, som modulvag → filinnehall. */
function samlaFiler(katalog, prefix = "") {
  const ut = new Map();
  for (const post of readdirSync(katalog)) {
    const vag = join(katalog, post);
    if (statSync(vag).isDirectory()) {
      // Ruttgrupper — `(app)` — och parallella rutter syns inte i URL:en.
      const del = post.startsWith("(") || post.startsWith("@") ? prefix : prefix ? `${prefix}/${post}` : post;
      for (const [k, v] of samlaFiler(vag, del)) ut.set(k, v);
    } else if (post === "actions.ts") {
      ut.set(prefix, readFileSync(vag, "utf8"));
    }
  }
  return ut;
}

/** Kroppen for en exporterad funktion: fran raden till nasta toppnivadeklaration. */
function kropp(kalla, namn) {
  const start = kalla.search(new RegExp(`^export async function ${namn}\\b`, "m"));
  if (start < 0) return "";
  const rest = kalla.slice(start + 1);
  const slut = rest.search(/^export (async function|function|const|type)\b/m);
  return slut < 0 ? rest : rest.slice(0, slut);
}

const filer = samlaFiler(ROT);

console.log("\n\x1b[1mVarje server action ar bokford\x1b[0m");
{
  const okanda = [];
  for (const [modul, kalla] of filer) {
    if (UTANFOR.has(modul)) continue;
    for (const m of kalla.matchAll(/^export async function (\w+)/gm)) {
      const nyckel = `${modul}::${m[1]}`;
      if (!(nyckel in TACKNING)) okanda.push(nyckel);
    }
  }
  ok(
    "ingen action saknas i TACKNING",
    okanda.length === 0,
    okanda.length ? `\n      saknas: ${okanda.join("\n      saknas: ")}` : `${filer.size} moduler`,
  );
}

console.log("\n\x1b[1mBokforingen stammer med koden\x1b[0m");
{
  // "notifierar" ska betyda att anropet FINNS. Annars ar bokforingen ett
  // pastaende om koden i stallet for en beskrivning av den.
  const ljuger = [];
  const glomda = [];

  for (const [nyckel, varde] of Object.entries(TACKNING)) {
    const [modul, namn] = nyckel.split("::");
    const kalla = filer.get(modul);
    if (!kalla) continue;
    const text = kropp(kalla, namn);
    if (!text) continue;

    const anropar = /\bnotifiera(Flera)?\(/.test(text);
    // `laggUppAnstalld` notifierar via lib-funktionen och inte i sin egen kropp.
    const viaLib = varde.startsWith("notifierar via");

    if (varde === "notifierar" && !anropar) ljuger.push(nyckel);
    if (varde !== "notifierar" && !viaLib && anropar) glomda.push(nyckel);
  }

  ok(
    'varje "notifierar" har ett riktigt anrop',
    ljuger.length === 0,
    ljuger.join(", "),
  );
  ok(
    "ingen action notifierar utan att sta som det",
    glomda.length === 0,
    glomda.join(", "),
  );
}

console.log("\n\x1b[1mBokforingen har inga doda rader\x1b[0m");
{
  const doda = [];
  for (const nyckel of Object.keys(TACKNING)) {
    const [modul, namn] = nyckel.split("::");
    const kalla = filer.get(modul);
    if (!kalla || !new RegExp(`^export async function ${namn}\\b`, "m").test(kalla)) {
      doda.push(nyckel);
    }
  }
  ok(
    "varje rad i TACKNING pekar pa en action som finns",
    doda.length === 0,
    doda.join(", "),
  );
}

console.log("");
if (fel > 0) {
  console.log(`\x1b[31m${fel} fel\x1b[0m\n`);
  process.exit(1);
}
console.log("\x1b[32mAlla server actions ar bokforda.\x1b[0m\n");
