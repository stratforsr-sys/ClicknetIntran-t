#!/usr/bin/env node
/**
 * VARJE INBADDAD FRAGA GAR ATT BESVARA.
 *
 *   node tests/inbaddningar-db.mjs
 *
 * ===========================================================================
 * VARFOR PROVET FINNS
 *
 * 2026-09-07 upptacktes att `employee!inner(team_id)` i `hamtaProvunderlag`
 * ALDRIG hade fungerat. `absence_request` har fyra frammande nycklar mot
 * `employee` — `employee_id`, `created_by`, `decided_by`, `withdrawn_by` — och
 * PostgREST vagrar da gissa vilken som menas. Den svarar `PGRST201`.
 *
 * DET FARLIGA AR INTE FELET UTAN HUR DET SER UT I KODEN:
 *
 *   const { data: andras } = await db.from("absence_request").select(...);
 *   ...andrasPerioder: (andras ?? []).map(...)
 *
 * `data` blir `null`, `?? []` gor det till en tom lista, och funktionen
 * fortsatter som om ingen var borta. Bemanningsvarningen i
 * ansokningsformularet sa alltsa "ingen ar borta under perioden" varje gang,
 * och regelbrottet `bemanning` kunde aldrig intraffa. Ingenting kraschade,
 * ingenting loggades, och inget prov kunde se det — regelmotorns prov skickar
 * in sitt underlag for hand och bevisar bara att motorn raknar ratt PA det
 * underlaget.
 *
 * Samma tystnad fanns pa fem stallen till: sjukanmalans ringlista tappade sina
 * rollbaserade mottagare (AC-3.6), `medRoll` och `medBehorighet` gav tomma
 * kretsar sa att notiser till saljchef och VD aldrig skickades (0047), och
 * lonekostnadsjobbets chefsfallback var alltid null.
 *
 * SLUTSATSEN: en inbaddning ar en fraga till en SCHEMA-relation som koden inte
 * kan se. Den maste stallas mot en riktig databas for att kunna besvaras, och
 * det ar det har provet gor — samma slag som `lonerapport-db` och
 * `offboarding-db`, och av samma skal.
 *
 * PROVET LASER KODEN, INTE EN LISTA. En ny inbaddning provas den dag den
 * skrivs, utan att nagon behover komma ihag att lagga till den har.
 * ===========================================================================
 *
 * Ingenting skrivs. Varje fraga stalls med `limit=0` — svaret behover inte
 * innehalla rader for att bevisa att den gar att stalla.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROT = new URL("../src", import.meta.url).pathname;

const URL_BAS = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const NYCKEL = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!URL_BAS || !NYCKEL) {
  console.error(
    "SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY behovs.\n" +
      "  set -a; . ~/.clicknet/nav.env; set +a; node tests/inbaddningar-db.mjs",
  );
  process.exit(1);
}

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? `\n      ${extra}` : ""}`);
  if (!villkor) fel++;
};

/** Alla .ts/.tsx under src, rekursivt. */
function filer(katalog) {
  const ut = [];
  for (const namn of readdirSync(katalog)) {
    const vag = join(katalog, namn);
    if (statSync(vag).isDirectory()) ut.push(...filer(vag));
    else if (/\.tsx?$/.test(namn)) ut.push(vag);
  }
  return ut;
}

/**
 * Hittar `.from("tabell")` foljt av `.select("...")` med en inbaddning.
 *
 * Inbaddningen kanns igen pa en parentes i select-strangen: PostgREST har
 * ingen annan syntax som anvander den. `count`-varianten `select=id.count()`
 * anvands inte i repot; dyker den upp far den undantas har.
 */
function inbaddningar(kod, fil) {
  const ut = [];
  const from = /\.from\(\s*"([a-z_]+)"\s*\)/g;
  let m;
  while ((m = from.exec(kod)) !== null) {
    const tabell = m[1];
    // Select-anropet som hor till: det forsta efter `.from`, innan nasta
    // `.from`. Fonstret racker for kedjorna i det har repot.
    const rest = kod.slice(m.index, from.lastIndex + 1200);
    const sel = /\.select\(\s*"([^"]+)"/.exec(rest);
    if (!sel) continue;
    const valet = sel[1];
    if (!valet.includes("(")) continue;
    const rad = kod.slice(0, m.index).split("\n").length;
    ut.push({ fil, rad, tabell, valet });
  }
  return ut;
}

const alla = [];
for (const f of filer(ROT)) {
  alla.push(...inbaddningar(readFileSync(f, "utf8"), f.replace(`${ROT}/`, "")));
}

console.log(`\n\x1b[1m${alla.length} inbaddade fragor i src/\x1b[0m\n`);

for (const i of alla) {
  const adress = `${URL_BAS}/rest/v1/${i.tabell}?select=${encodeURIComponent(i.valet)}&limit=0`;
  let svar;
  try {
    const r = await fetch(adress, {
      headers: { apikey: NYCKEL, Authorization: `Bearer ${NYCKEL}` },
    });
    svar = r.ok ? null : await r.json();
  } catch (e) {
    svar = { message: e.message };
  }

  ok(
    `${i.fil}:${i.rad}  ${i.tabell}`,
    svar === null,
    svar
      ? `${svar.code ?? ""} ${svar.message ?? ""}\n      select: ${i.valet}` +
          (svar.code === "PGRST201"
            ? "\n      → tvetydig inbaddning. Namnge nyckeln: employee!<tabell>_<kolumn>_fkey(...)"
            : "")
      : "",
  );
}

console.log(
  fel === 0
    ? "\n\x1b[32mAlla inbaddningar gar att besvara.\x1b[0m"
    : `\n\x1b[31m${fel} inbaddning(ar) faller — och de faller TYST i drift.\x1b[0m`,
);
process.exit(fel === 0 ? 0 : 1);
