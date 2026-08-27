/**
 * X3: det gemensamma i matningarna.
 *
 * Bruten ur scripts/mat-startsidan.mjs 2026-08-23, nar sok och stampling skulle
 * matas med samma metod. Ingen av siffrorna andrades av utbrytningen —
 * startsidan mattes om efterat och gav samma svar.
 *
 * Metoden ar densamma for alla tre matten:
 *
 *   1. VAGORNA. Antalet SEKVENTIELLA omgangar mot Supabase. Varje omgang maste
 *      vanta in den forra. Det ar den delen som gar att gora nagot at i kod och
 *      den enda som vaxer nar navet vaxer.
 *   2. NYTTOLASTEN over natet, matt med curl mot produktionen.
 *   3. En 4G-uppskattning byggd pa 1 och 2, med varje antagande utskrivet.
 *
 * Latensen harifran till Supabase ar HOGRE an fran Vercels funktion, som star i
 * samma region som databasen. Det som ar jamforbart mellan mattillfallen och
 * mellan sidor ar ANTALET VAGOR.
 */
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const kor = promisify(execFile);

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
export const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
export const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
export const PROD = process.env.NAV_URL ?? "https://clicknet-nav.vercel.app";

/**
 * Uppskattad rundtur mellan Vercels funktion och Supabase, bada i eu-north-1.
 *
 * ===========================================================================
 * DET HAR AR X3:s SISTA UPPSKATTNING, OCH DEN STAR KVAR SOM UPPSKATTNING.
 *
 * Talet ar INTE matt. `mat-inloggad.mjs` mater hela sidor pa riktigt och
 * behover det darfor inte — det ar bara `mat-startsidan.mjs` och
 * `mat-sok-och-stampling.mjs` som raknar vagor och lagger pa det har.
 *
 * SA HAR MATER DU DET, nar tillfallet kommer:
 *
 *   En vagas kostnad ar skillnaden mellan tva korningar av SAMMA sida dar
 *   antalet vagor skiljer med exakt en. Det gar inte att mata mot en gammal
 *   deploy-adress — Vercel skyddar dem och de svarar 302 (`mat-inloggad.mjs`
 *   har en kontroll for just det). Matningen maste alltsa goras FORE och
 *   EFTER en andring som tar bort en vag, mot produktionsdomanen.
 *
 *   Tillfallet fanns 2026-08-27: sokningens prefixfraga gick fran att stallas
 *   efter den snava till att ga parallellt, alltsa tva vagor till en for en
 *   sokning utan traff. Fore-matningen missades — andringen hann deployas
 *   forst. Nasta gang en vag forsvinner: mat `/sok?q=nagot-som-inte-finns`
 *   fem ganger fore push och fem ganger efter.
 *
 * VARFOR INGEN SIFFRA GISSADES IN I STALLET: talet var en gang 20 ms under
 * antagandet att funktionen stod i samma region som databasen. Den stod i
 * `iad1` och kostade i verkligheten ~460 ms per tur. Ingen uppskattning kunde
 * ha upptackt det. Att byta en uppskattning mot en annan uppskattning som SER
 * matt ut vore samma fel en gang till.
 *
 * Talet ar medvetet PESSIMISTISKT for tva tjanster i samma region, och star
 * har for att det ska ga att ifragasatta och andra pa ett stalle.
 * ===========================================================================
 */
export const MS_PER_VAG = 20;

export const PROFILER = [
  { namn: "4G, normalt", mbit: 10, rtt: 50 },
  { namn: "4G, trangt", mbit: 3, rtt: 100 },
];

export async function anslut() {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  return db;
}

/**
 * Skapar en riktig inloggad anvandare att mata med, och lamnar tillbaka en
 * stadfunktion. Anvandaren ar aldrig en av driftens — matningen ska inte kunna
 * lamna spar i nagons uppgifter.
 */
export async function matanvandare(db, { epost, roll, fornamn = "Matt" }) {
  const losen = "Mattlosen!" + Math.random().toString(36).slice(2, 10);

  /**
   * Stadar bort matanvandaren och det hen hunnit skriva.
   *
   * Kors bade fore och efter, sa att en avbruten korning inte later en rad ligga
   * kvar och blockera nasta. Ordningen ar tvingad: `time_event` far en cascade
   * fran `employee` att falla, eftersom AC-2.3 nekar radering av en stampling
   * — aven en som kommer indirekt. Triggern kopplas darfor ur medvetet, precis
   * som i tests/rls.mjs.
   *
   * `audit_log` stads pa actor_id och aldrig bredare an sa. Driftens rader ar
   * bevis (AC-12.1) och far inte forsvinna for att nagon matte en sida.
   */
  const stad = async () => {
    const { rows } = await db.query(`select id, auth_user_id from employee where email = $1`, [epost]);
    for (const r of rows) {
      await db.query(`delete from audit_log where actor_id = $1::uuid`, [r.id]);
      await db.query(`alter table time_event disable trigger time_event_orubblig`);
      await db.query(`delete from time_event where employee_id = $1::uuid`, [r.id]);
      await db.query(`alter table time_event enable trigger time_event_orubblig`);
      if (r.auth_user_id) {
        await fetch(`${URL}/auth/v1/admin/users/${r.auth_user_id}`, { method: "DELETE", headers: ADMIN });
      }
      await db.query(`delete from employee where id = $1::uuid`, [r.id]);
    }
  };

  await stad();

  const skapad = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify({ email: epost, password: losen, email_confirm: true }),
  }).then((r) => r.json());

  const { rows: [anst] } = await db.query(
    `insert into employee (auth_user_id, email, first_name, last_name, status, employment_type)
     values ($1::uuid,$2,$3,'Testsson','active','permanent') returning id`,
    [skapad.id, epost, fornamn],
  );
  await db.query(`insert into employee_role (employee_id, role) values ($1::uuid,$2)`, [anst.id, roll]);

  const token = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: epost, password: losen }),
  }).then((r) => r.json()).then((j) => j.access_token);

  const som = { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    id: anst.id,
    authId: skapad.id,
    token,
    som,
    stad,
    /** En lasning med anvandarens egen token. RLS galler, precis som i navet. */
    q: (fraga) => fetch(`${URL}/rest/v1/${fraga}`, { headers: som }).then((r) => r.text()),
    /** Ett rpc-anrop med samma token. */
    rpc: (funktion, args = {}) =>
      fetch(`${URL}/rest/v1/rpc/${funktion}`, {
        method: "POST", headers: som, body: JSON.stringify(args),
      }).then((r) => r.text()),
  };
}

/**
 * Kor vagorna i ordning och skriver ut vad var och en kostade.
 *
 * `VAGOR` ar en lista av [namn, funktion]. Funktionen far gora vad den vill sa
 * lange den ar EN rundtur — flera fragor inuti ett Promise.all ar en vaga, och
 * det ar hela poangen med matningen.
 */
export async function matVagor(VAGOR, { uppvarmning }) {
  console.log(`\n\x1b[1mVagorna\x1b[0m  (${VAGOR.length} sekventiella omgangar)\n`);

  // Uppvarmningen raknas inte: forsta anropet betalar for uppkoppling och TLS,
  // och den kostnaden finns inte i en varm serverlos funktion.
  if (uppvarmning) await uppvarmning();

  let summa = 0;
  let fragor = 0;
  for (const [namn, gor, antal = 1] of VAGOR) {
    const t0 = performance.now();
    await gor();
    const ms = performance.now() - t0;
    summa += ms;
    fragor += antal;
    console.log(
      `  ${String(Math.round(ms)).padStart(5)} ms  ${namn}  (${antal} ${antal > 1 ? "frågor" : "fråga"})`,
    );
  }

  console.log(`\n  ${String(Math.round(summa)).padStart(5)} ms  SUMMA  ${fragor} frågor i ${VAGOR.length} vågor`);
  console.log(
    `\n  Latensen harifran ar hogre an fran Vercels funktion, som star i samma\n` +
    `  region som databasen. Det som ar jamforbart ar ANTALET vagor: ${VAGOR.length}.\n`,
  );

  return { summa, fragor, vagor: VAGOR.length };
}

/**
 * Storleken mats med curl, inte med fetch.
 *
 * Nodes fetch (undici) satter sin egen `accept-encoding` och packar upp svaret
 * at en. Bade `arrayBuffer().byteLength` och `content-length` blev darfor den
 * UPPACKADE storleken — tre ganger sa stor som det som gar over natet, och en
 * 4G-uppskattning byggd pa den blir tre ganger for pessimistisk. Provat: 513 kB
 * dar curl ger 162 kB.
 */
export async function overNatet(vag, forsok = 3) {
  for (let i = 1; ; i++) {
    try {
      const { stdout } = await kor("curl", [
        "-s", "-o", "/dev/null",
        "-H", "accept-encoding: br, gzip",
        "-w", "%{size_download} %{http_code} %{time_starttransfer}",
        `${PROD}${vag}`,
      ]);
      const [storlek, kod, ttfb] = stdout.trim().split(" ");
      if (Number(kod) === 0) throw new Error("inget svar");
      return { storlek: Number(storlek), kod: Number(kod), ttfb: Number(ttfb) * 1000 };
    } catch (e) {
      // Manga snabba anrop i rad ger ibland ett TLS-handslag som inte gar
      // igenom. Det ar matningens eget problem och inte navets.
      if (i >= forsok) throw e;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
}

export async function mat(vag, gangar = 5) {
  const tider = [];
  let sista;
  for (let i = 0; i < gangar; i++) {
    sista = await overNatet(vag);
    tider.push(sista.ttfb);
  }
  tider.sort((a, b) => a - b);
  return { median: tider[Math.floor(tider.length / 2)], ...sista };
}

/** Skalets skript och stilar, komprimerat over natet. */
export async function skaletsByte() {
  const html = await fetch(`${PROD}/logga-in`).then((r) => r.text());
  const filer = [...new Set(html.match(/\/_next\/static\/[^"']*?\.(?:js|css)/g) ?? [])];
  let byte = 0;
  for (const f of filer) byte += (await overNatet(f)).storlek;
  return { byte, antal: filer.length };
}

/**
 * Skriver ut 4G-uppskattningen mot ett krav och sager om det halls.
 *
 * `forstaBesok` styr om de tre rundturerna for DNS, TCP och TLS raknas med. En
 * stampling gors av nagon som redan ar inne — dar ar uppkopplingen redan gjord,
 * och att rakna den hade matt fel sak.
 */
export function uppskatta({ rubrik, servertid, byteOverNatet, kravMs, forstaBesok = true }) {
  console.log(`\x1b[1m${rubrik}\x1b[0m\n`);
  const utfall = [];

  for (const p of PROFILER) {
    const byteS = (p.mbit * 1000 * 1000) / 8;
    const uppkoppling = forstaBesok ? 3 * p.rtt : 0;
    const hamtning = (byteOverNatet / byteS) * 1000;
    const summa = uppkoppling + p.rtt + servertid + hamtning;
    utfall.push({ profil: p.namn, ms: summa });

    const krav = (kravMs / 1000).toString().replace(".", ",");
    console.log(
      `  ${p.namn.padEnd(12)} ${p.mbit} Mbit/s, ${p.rtt} ms RTT\n` +
      (forstaBesok ? `    uppkoppling ${Math.round(uppkoppling)} ms + ` : "    ") +
      `svar ${Math.round(p.rtt + servertid)} ms + hamtning ${Math.round(hamtning)} ms\n` +
      `    = ${Math.round(summa)} ms  ` +
      `${summa < kravMs ? `\x1b[32munder ${krav} s\x1b[0m` : `\x1b[31mover ${krav} s\x1b[0m`}` +
      `   (marginal ${Math.round(kravMs - summa)} ms)\n`,
    );
  }

  return utfall;
}
