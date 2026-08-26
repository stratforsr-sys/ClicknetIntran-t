#!/usr/bin/env node
/**
 * Varje sida, som varje roll, mot den RIKTIGA adressen.
 *
 * ===========================================================================
 * VAD DET HAR PROVET SVARAR PA SOM INGET ANNAT GOR
 *
 * `tests/rls.mjs` provar att fel roll far noll RADER ur databasen. Det ar den
 * viktigaste fragan, men det ar inte samma fraga som "gar sidan att oppna".
 *
 * En sida kan ge noll rader helt korrekt och anda krascha pa `rad[0].namn`. Ett
 * fel i en server component blir en 500 som inget annat prov i sviten ser,
 * eftersom inget annat prov RENDERAR nagot. Provet oppnar darfor varje sida i
 * navet som fyra olika roller.
 *
 * ---------------------------------------------------------------------------
 * VARFOR DET INTE PROVAR HTTP-STATUS MOT EN LISTA OVER TILLATNA ROLLER
 *
 * Det gjorde det forst, och den forsta korningen 2026-08-26 sag ut att hitta
 * elva behorighetsluckor for en saljare. DET GJORDE DEN INTE. Tva saker gor
 * statuskoden oanvandbar som behorighetsmatt har:
 *
 *   1. `redirect()` INUTI EN STROMMAD KOMPONENT ger HTTP 200. Next skickar
 *      sidans skal forst, och nar `SchemaInnehall` sedan kastar sin
 *      omdirigering finns statusraden redan hos webblasaren. Omdirigeringen
 *      hamnar i strommen i stallet och sker hos klienten. Det skyddade
 *      innehallet renderas aldrig — kontrollerat, se markorerna nedan — men
 *      koden ar 200.
 *
 *   2. FLERA SIDOR AR MED FLIT OSPARRADE och later RLS avgora. `/personal` ar
 *      den tydligaste: den star oppen for alla, och en saljare ser exakt en rad
 *      dar — sig sjalv. Det ar PRD 5.2, inte en lucka. En vy som rakar hamta
 *      fel data ska fa noll rader fran Postgres, inte filtreras i React.
 *
 * Provet fragar darfor efter det som faktiskt betyder nagot: KOM DET UT NAGON
 * ANNANS UPPGIFTER? Namn och e-postadresser ur driften soks i varje svar for
 * varje roll. Det ar samma fraga som rls.mjs staller till databasen, men stalld
 * till den fardiga HTML-sidan — alltsa efter att sidan haft chansen att rendera
 * nagot den inte borde.
 * ===========================================================================
 *
 *   node tests/sidor.mjs
 *
 * Hoppas over om NAV_URL inte svarar.
 */
import { anslut, matanvandare, PROD, URL, ANON } from "../scripts/lib/matning.mjs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

/**
 * Sidorna som oppnas. Ingen rollmatris — se rubriken overst for varfor.
 *
 * Sidor med [id] i adressen star inte med: de kraver en rad att peka pa, och en
 * uppdiktad uuid provar felhanteringen i stallet for sidan.
 */
const SIDOR = [
  "/",
  "/tid",
  "/tid/schema",
  "/tid/sparrar",
  "/tid/avvikelser",
  "/tid/lonerapport",
  "/rutiner",
  "/rutiner/ny",
  "/utbildning",
  "/utbildning/rollspel",
  "/utbildning/oversikt",
  "/nyheter",
  "/nyheter/nytt",
  "/arenden",
  "/arenden/nytt",
  "/arenden/statistik",
  "/franvaro",
  "/franvaro/ny",
  "/franvaro/sjuk",
  "/franvaro/planering",
  "/franvaro/attest",
  "/franvaro/regler",
  "/provision",
  "/provision/regler",
  "/kv",
  "/kv/regler",
  "/order",
  "/sok?q=rutin",
  "/sok?q=a,b",
  "/fel",
  "/fel/nytt",
  "/profil",
  "/personal",
  "/personal/ny",
  "/personal/team",
  "/adoption",
  "/rekrytering",
  "/rekrytering/ny",
  "/avtal",
  "/avtal/mallar",
  "/logg",
  "/lonekostnad",
  "/lonekostnad/satser",
  "/admin/arbetstid",
];

/**
 * Rollerna som provas.
 *
 * Sista faltet sager om rollen SKA se personalregistret. Sales_manager gor det
 * — PRD 5.2 — och for den vands kontrollen om: den kraver att uppgifterna GAR
 * att hitta.
 *
 * DET AR PROVETS NEGATIVA KONTROLL, och den ar viktigare an den ser ut. Ett
 * lackprov som inte hittar nagot for nagon bevisar ingenting: det kan lika garna
 * vara sokningen som ar trasig, adresserna som andrats eller sidorna som slutat
 * rendera. Att sokningen hittar namnen for exakt den roll som ska se dem, och
 * for ingen annan, visar att bade sokningen och sparren fungerar.
 */
const ROLLER = [
  ["salesperson", "Säljare", false],
  ["team_lead", "Teamledare", false],
  ["sales_manager", "Säljchef", true],
  ["finance", "Ekonomi", false],
];

function sessionskakor(session) {
  const ref = new globalThis.URL(URL).hostname.split(".")[0];
  const namn = `sb-${ref}-auth-token`;
  const varde = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const GRANS = 3180;
  if (varde.length <= GRANS) return [`${namn}=${varde}`];
  const delar = [];
  for (let i = 0; i < varde.length; i += GRANS) delar.push(varde.slice(i, i + GRANS));
  return delar.map((d, i) => `${namn}.${i}=${d}`);
}

let uppe = false;
try {
  const r = await fetch(PROD + "/logga-in", { redirect: "manual" });
  uppe = r.status < 500;
} catch {
  uppe = false;
}

if (!uppe) {
  console.log(`\n  \x1b[33m–\x1b[0m ${PROD} svarar inte. Provet hoppas over.\n`);
  process.exit(0);
}

const db = await anslut();

/**
 * Uppgifter ur DRIFTEN som ingen av provets roller far se.
 *
 * Hamtas ur databasen i stallet for att skrivas in har: en hardkodad lista
 * slutar stamma den dag nagon byter namn eller slutar, och da provar provet
 * ingenting utan att bli rott.
 *
 * Provets egna anvandare raknas bort. De ar nyss skapade och kan inte aga
 * driftdata, och en saljare SKA se sitt eget namn pa varenda sida — det star i
 * profilraden i sidopanelen.
 *
 * E-postadresser och efternamn, inte fornamn. Ett fornamn som "Simon" kan sta i
 * en rutintext helt oskyldigt; en e-postadress kan det inte.
 */
const { rows: driften } = await db.query(
  `select email, last_name from employee
    where email not like 'sidprov+%' and email not like 'matning+%'
      and email not like 'rlstest+%' and email not like 'kolla+%'`,
);
const hemligheter = [];
for (const r of driften) {
  if (r.email) hemligheter.push([`e-posten ${r.email}`, r.email]);
  if (r.last_name && r.last_name.length >= 4) hemligheter.push([`efternamnet ${r.last_name}`, r.last_name]);
}

console.log(`\n\x1b[1mVarje sida som varje roll mot ${PROD}\x1b[0m`);
console.log(`${SIDOR.length} sidor, ${hemligheter.length} uppgifter ur driften som inte far synas.`);

const stadare = [];
try {
  for (const [roll, etikett, serAlla] of ROLLER) {
    const epost = `sidprov+${roll}@clicknet-matning.se`;
    const anv = await matanvandare(db, { epost, roll, fornamn: "Sidprov" });
    stadare.push(anv.stad);
    if (!anv.token) {
      ok(`${etikett}: kunde logga in`, false);
      continue;
    }

    const konto = await fetch(`${URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${anv.token}` },
    }).then((r) => r.json());

    const kaka = sessionskakor({
      access_token: anv.token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "",
      user: konto,
    }).join("; ");

    console.log(`\n  \x1b[1m${etikett}\x1b[0m (${roll})`);

    const kraschar = [];
    const lackage = [];

    for (const vag of SIDOR) {
      const svar = await fetch(PROD + vag, {
        headers: { cookie: kaka, "user-agent": "clicknet-nav-sidprov" },
        redirect: "manual",
      });
      const kropp = await svar.text();

      if (svar.status >= 500) {
        kraschar.push(`${vag} (HTTP ${svar.status})`);
        continue;
      }

      // En omdirigering till inloggningen betyder att sessionskakan inte togs.
      // Det ar ett fel i provet, inte i navet, och far inte se ut som en spärr.
      const till = svar.headers.get("location") ?? "";
      if (svar.status >= 300 && svar.status < 400 && till.includes("/logga-in")) {
        kraschar.push(`${vag} (utloggad — kakan togs inte)`);
        continue;
      }

      // DET SOM FAKTISKT BETYDER NAGOT. Kom nagon annans uppgifter ut?
      for (const [vad, varde] of hemligheter) {
        if (kropp.includes(varde)) lackage.push(`${vag} bar ${vad}`);
      }
    }

    ok(`${SIDOR.length} sidor utan serverfel`, kraschar.length === 0, kraschar.join(", "));

    if (serAlla) {
      ok("ser personalen — provets negativa kontroll", lackage.length > 0,
        lackage.length === 0
          ? "sokningen hittade INGENTING for den roll som ska se allt: provet provar inget"
          : `${lackage.length} traffar, som sig bor`);
    } else {
      ok("ingen annans uppgifter i nagon sida", lackage.length === 0, lackage.slice(0, 6).join(" | "));
    }
  }
} finally {
  for (const stad of stadare) await stad();
  await db.end();
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
