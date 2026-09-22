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
  // E13 steg 6. Sidan omdirigerar den som inte far besluta, sa den provas som
  // alla andra: renderar den utan serverfel, och lacker den nagon annans namn?
  "/tid/ogiltig-franvaro",
  "/tid/lonerapport",
  // Uppgiftsmodulen. `/uppgifter` glomdes 2026-09-11 och star med nu — sidan ar
  // en av fa som renderar EN ANNAN PERSONS namn ("Anna la uppgiften pa dig"),
  // och det ar precis sadana sidor lackprovet finns for.
  "/uppgifter",
  // 0066. Genomgangen renderar samma rader som `/uppgifter` men OCKSA
  // kollegornas namn i steg tre ("Hos Anna sedan 6 dagar"), vilket gor den till
  // precis en sadan sida provet finns for. Mallsidan star med av ett annat
  // skal: dess personvaljare listar alla man far se, och en valjare som rymmer
  // for manga ar den vanligaste formen av lackage.
  "/uppgifter/genomgang",
  "/uppgifter/mallar",
  // Kalendern (0057). Utan parameter ar det den egna dagen. Att prova den med
  // `?person=` gar inte har — id:t skiljer sig mellan korningar — sa kollegans
  // vy provas i rls.mjs i stallet, dar den hor hemma.
  "/kalender",
  "/kalender/delning",
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
  // Malsidan ar saljchef och VD. En saljare ska motas av 404 och INTE av en
  // lista over kollegornas mal — provet letar efter deras namn i svaret.
  "/provision/mal",
  // E13 steg 7. Manaden i adressen ar INTE ett id — den kraver ingen rad att
  // peka pa, och en manad utan provision ar ett giltigt lage som ska rendera.
  "/provision/underlag/2026-08-01",
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

/**
 * ===========================================================================
 * NAMN SOM EN SIDA AR BYGGD FOR ATT VISA — OCH VARFOR UNDANTAGET AR SMALT
 *
 * `/franvaro/sjuk` borjar med telefonlistan: vem man ringer nar man blir sjuk.
 * Den ar sidans forsta krav (AC-3.6, AC-3.18) och star for ALLA roller, for
 * annars vet den sjuka inte vem hen ska ringa. VD:ns efternamn i den listan ar
 * alltsa inte ett lackage — men provet las det som ett, eftersom hemligheterna
 * ovan ar varenda anstalld i driften.
 *
 * Provet var rott av det skalet 2026-09-14/15 for saljare, teamledare OCH
 * ekonomi — samma rad, samma sida. Kontrollerat 2026-09-16: ekonomirollens
 * svar bar INGENTING annat, och `sick_report_read` slapper inte in den
 * rollen alls.
 *
 * Undantaget ar darfor sa smalt det gar att gora det:
 *
 *   - Bara pa `/franvaro/sjuk`. Samma namn pa nagon annan sida ar fortfarande
 *     ett lackage.
 *   - Bara EFTERNAMN, och bara for dem ringlistan sjalv pekar ut. Listan
 *     hamtas ur `absence_call_order` och inte skriven har: byter VD:n namn,
 *     eller far listan en ny plats, foljer provet med av sig sjalvt.
 *   - E-postadresser undantas ALDRIG. Ringlistan visar telefon, aldrig mejl,
 *     sa en adress i det svaret ar ett fel aven for de har personerna.
 *   - Chefsplatsen (`target_kind = 'manager'`) star inte med: provets
 *     anvandare skapas utan `manager_id`, sa den platsen renderar aldrig ett
 *     namn for dem. Skulle den nagon gang gora det ska provet bli rott och
 *     kalibreras om — inte tiga.
 *
 * Och for att undantaget inte ska kunna tysta sidan helt provas ringlistan
 * POSITIVT nedan: namnen SKA sta dar. Det ar samma grepp som den negativa
 * kontrollen for saljchefen — en vakt som slutar hitta nagot bevisar inget.
 * ===========================================================================
 */
const { rows: ringlistan } = await db.query(
  `select distinct e.last_name
     from absence_call_order o
     join employee_role er on er.role = o.role
     join employee e on e.id = er.employee_id
    where o.active and o.target_kind = 'role'
      and e.status <> 'offboarded' and e.last_name is not null
   union
   select distinct e.last_name
     from absence_call_order o
     join employee e on e.id = o.employee_id
    where o.active and o.target_kind = 'person' and e.last_name is not null`,
);
const ringlistansNamn = ringlistan.map((r) => r.last_name).filter((n) => n.length >= 4);

/** Vag -> varden som ar avsiktligt publika just dar. */
const UNDANTAG = new Map([["/franvaro/sjuk", new Set(ringlistansNamn)]]);
const TOMT = new Set();

console.log(`\n\x1b[1mVarje sida som varje roll mot ${PROD}\x1b[0m`);
console.log(`${SIDOR.length} sidor, ${hemligheter.length} uppgifter ur driften som inte far synas.`);
console.log(
  ringlistansNamn.length
    ? `Ringlistan pa /franvaro/sjuk pekar ut ${ringlistansNamn.length} efternamn som SKA synas dar.`
    : `\x1b[33mRinglistan pekar inte ut nagon med efternamn — den positiva kontrollen hoppas over.\x1b[0m`,
);

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
    /** null = sidan hanns aldrig las; true/false = ringlistan syntes eller inte. */
    let ringlistanSyntes = null;

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

      // Sidan ska visa ringlistan. Kontrolleras efter loopen — se rubriken ovan.
      if (vag === "/franvaro/sjuk") {
        ringlistanSyntes = ringlistansNamn.some((n) => kropp.includes(n));
      }

      // DET SOM FAKTISKT BETYDER NAGOT. Kom nagon annans uppgifter ut?
      const undantagna = UNDANTAG.get(vag) ?? TOMT;
      for (const [vad, varde] of hemligheter) {
        if (undantagna.has(varde)) continue;
        if (kropp.includes(varde)) lackage.push(`${vag} bar ${vad}`);
      }
    }

    ok(`${SIDOR.length} sidor utan serverfel`, kraschar.length === 0, kraschar.join(", "));

    // Den positiva halvan av undantaget: tas telefonlistan bort ska provet saga
    // till, inte bli tyst. AC-3.6 — sidans forsta element ar vem man ringer.
    if (ringlistansNamn.length > 0) {
      ok(
        "ringlistan star kvar pa /franvaro/sjuk",
        ringlistanSyntes === true,
        ringlistanSyntes === null ? "sidan lastes aldrig" : ringlistanSyntes ? "" : "inget av ringlistans namn i svaret",
      );
    }

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
