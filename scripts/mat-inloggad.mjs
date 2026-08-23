/**
 * X3: inloggad TTFB fran produktionen.
 *
 * ===========================================================================
 * DET HAR AR MATNINGEN SOM SAKNADES.
 *
 * `mat-startsidan.mjs` och `mat-sok-och-stampling.mjs` raknar VAGOR och lagger
 * pa en uppskattning per vaga. Uppskattningen stod i matning.mjs med
 * motiveringen att funktionen star i samma region som databasen.
 *
 * Det gjorde den inte. Funktionerna kordes i iad1 och databasen i eu-north-1,
 * sa varje vaga korsade Atlanten. Uppskattningen pa 20 ms var i verkligheten
 * omkring 460 ms, och alla X3-siffror var darfor for laga med ungefar en
 * faktor tjugo per vaga. Ingen uppskattning kunde ha upptackt det — bara en
 * matning mot den riktiga adressen kan det, och det ar den har.
 *
 * Metoden: skapa en riktig anvandare, logga in, bygg sessionskakan i det
 * format @supabase/ssr laser, och hamta sidan over natet som en webblasare
 * hade gjort. Ingen uppskattning nagonstans.
 * ===========================================================================
 *
 * Kor:  node --env-file=$HOME/.clicknet/nav.env scripts/mat-inloggad.mjs
 */
import { anslut, matanvandare, PROD, URL } from "./lib/matning.mjs";

/** Sidorna som mats, och vad de ska klara enligt X3. */
const SIDOR = [
  ["/", "Startsidan", 1500],
  ["/tid", "Stamplingsvyn", 2000],
  ["/sok?q=rutin", "Sokningen", 500],
  ["/rutiner", "Rutinerna", 1500],
];

const VARV = 6;

/**
 * Sessionskakan i @supabase/ssr:s format.
 *
 * Vardet ar "base64-" foljt av base64 av hela sessionsobjektet. Blir det for
 * langt for en kaka delas det i `.0`, `.1` och sa vidare — biblioteket satter
 * ihop delarna igen vid lasning. Gransen nedan ar bibliotekets egen.
 */
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

async function matSida(vag, kaka) {
  const tider = [];
  // Forsta hamtningen raknas inte. Den betalar for uppkoppling och for en
  // funktion som kan ha somnat, och ingendera ar det sidan kostar i drift.
  for (let i = 0; i <= VARV; i++) {
    const start = performance.now();
    const svar = await fetch(PROD + vag, {
      headers: { cookie: kaka, "user-agent": "clicknet-nav-matning" },
      redirect: "manual",
    });
    await svar.text();
    const ms = performance.now() - start;
    if (i > 0) tider.push({ ms, kod: svar.status });
  }
  tider.sort((a, b) => a.ms - b.ms);
  return {
    median: tider[Math.floor(tider.length / 2)].ms,
    basta: tider[0].ms,
    samst: tider[tider.length - 1].ms,
    kod: tider[0].kod,
  };
}

const db = await anslut();
const epost = "matning+inloggad@clicknet-matning.se";
let anv;

try {
  anv = await matanvandare(db, { epost, roll: "salesperson", fornamn: "Matning" });
  if (!anv.token) throw new Error("Ingen token fran matanvandare().");

  // Vem tokenen tillhor, sa att kakan bar samma anvandare som navet slar upp.
  const konto = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${anv.token}` },
  }).then((r) => r.json());

  const kaka = sessionskakor({
    access_token: anv.token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "",
    user: konto,
  }).join("; ");

  console.log(`\n\x1b[1mInloggad TTFB mot ${PROD}\x1b[0m`);
  console.log(`Roll: saljare. ${VARV} hamtningar per sida, forsta bortraknad.\n`);
  console.log("  Sida               Median     Basta     Samst    Krav   Marginal");
  console.log("  ─────────────────────────────────────────────────────────────────");

  let fallna = 0;
  let ejLaddade = 0;

  for (const [vag, namn, krav] of SIDOR) {
    const r = await matSida(vag, kaka);
    const marginal = krav - r.median;

    /**
     * EN SIDA SOM INTE LADDADE AR INGEN MATNING.
     *
     * Star det nagot annat an 200 har vi mott en omdirigering eller ett fel —
     * och en omdirigering ar snabb. Utan den har raden rapporterade skriptet
     * "alla sidor klarar sitt krav" for fyra sidor den aldrig hamtat, vilket
     * hande forsta gangen den kordes mot en skyddad deploy. En matning som ser
     * gron ut nar den misslyckats ar samre an ingen matning alls.
     */
    if (r.kod !== 200) {
      ejLaddade++;
      console.log(
        `  ${namn.padEnd(18)} \x1b[33m      —        —        —\x1b[0m ` +
          `${krav.toString().padStart(6)}  \x1b[33mHTTP ${r.kod}, inte matt\x1b[0m`,
      );
      continue;
    }

    const ok = marginal > 0;
    if (!ok) fallna++;
    const f = ok ? "\x1b[32m" : "\x1b[31m";
    console.log(
      `  ${namn.padEnd(18)} ${f}${Math.round(r.median).toString().padStart(5)} ms\x1b[0m ` +
        `${Math.round(r.basta).toString().padStart(6)} ms ${Math.round(r.samst).toString().padStart(6)} ms ` +
        `${krav.toString().padStart(6)} ${f}${Math.round(marginal).toString().padStart(8)} ms\x1b[0m`,
    );
  }

  if (ejLaddade > 0) {
    console.log(
      `\n\x1b[31m${ejLaddade} sida(or) svarade inte med 200 och ar alltsa inte matta.\x1b[0m` +
        `\nEn gammal deploy-adress ar skyddad av Vercel och omdirigerar till inloggning —` +
        `\nmat mot produktionsdomanen, eller satt NAV_URL till en oskyddad adress.\n`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      fallna === 0
        ? "\n\x1b[32mAlla sidor klarar sitt krav.\x1b[0m\n"
        : `\n\x1b[31m${fallna} sida(or) over kravet.\x1b[0m\n`,
    );
    if (fallna > 0) process.exitCode = 1;
  }
} finally {
  if (anv) await anv.stad();
  await db.end();
}
