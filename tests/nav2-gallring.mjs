#!/usr/bin/env node
/**
 * S09 · GDPR: gallringens regler, utan databas.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-gallring.mjs
 *
 * Reglerna ar rena funktioner i `src/lib/nav2/gallring.ts` och
 * `src/lib/personal-radering.ts`. Sjalva raderingen (gallra med kor: true) ar
 * avstangd tills bestallaren sett antalen (GALLRA = false), och det provas har
 * ocksa: ett ja far inte sla igenom av misstag.
 */
import {
  GALLRA,
  MOTESBOLAG_MANADER,
  PALETT_DAGAR,
  TALANGPOOL_MANADER,
  foraldralosa,
  kandidaterAttRadera,
  maskera,
  motesbolagAttRadera,
  palettAttRadera,
  svenskDag,
} from "../src/lib/nav2/gallring.ts";
import { forsvunna } from "../src/lib/personal-radering.ts";

let fel = 0, antal = 0;
const ok = (namn, villkor, extra = "") => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n\x1b[1mBrytaren och lagringstiderna (B5)\x1b[0m");
ok("gallringen ar avstangd tills bestallaren sagt ja", GALLRA === false);
ok("palettens fragor sparas i 90 dagar", PALETT_DAGAR === 90);
ok("talangpoolen sparas i 24 manader", TALANGPOOL_MANADER === 24);
ok("motesbolag sparas i 24 manader", MOTESBOLAG_MANADER === 24);

console.log("\n\x1b[1mMaskeringen (F2-7)\x1b[0m");
{
  const m = maskera("fråga om 19850101-1234");
  ok("personnumret med sekel ar borta", !m.includes("1234") && !m.includes("850101"), m);
  ok("tio siffror utan streck ar borta", !maskera("8501011234 hjälp").includes("8501011234"));
  ok("plus-formen ar borta", !maskera("850101+1234").includes("1234"));
  ok("tva nummer i samma fraga ar borta", !/\d{6}[-+]?\d{4}/.test(maskera("850101-1234 och 900202-5678")));
  ok("vanlig text ar orord", maskera("hur ansöker jag om ledighet") === "hur ansöker jag om ledighet");
  ok("ett kort tal star kvar", maskera("semester 2026") === "semester 2026");
}

console.log("\n\x1b[1mSvensk dag, inte klockslag\x1b[0m");
ok("23.30 UTC en sommarnatt ar nasta dag i Sverige", svenskDag(new Date("2026-07-01T23:30:00Z")) === "2026-07-02");
ok("mitt pa dagen ar samma dag", svenskDag(new Date("2026-10-23T12:00:00Z")) === "2026-10-23");

console.log("\n\x1b[1mPalettens fragor raderas efter 90 dagar\x1b[0m");
{
  const nu = new Date("2026-10-23T03:00:00Z");
  const rader = [
    { q: "gammal", week: "2026-07-20", dag: "2026-07-24" },   // 91 dagar
    { q: "grans", week: "2026-07-20", dag: "2026-07-25" },    // exakt 90: sparas
    { q: "ny", week: "2026-10-19", dag: "2026-10-22" },
    { q: "utan dag", week: "2026-06-01", dag: null },         // gammal rad fore 0223: veckans sista dag raknas
    { q: "utan dag, ny", week: "2026-10-19", dag: null },
  ];
  ok("palettAttRadera(rader, nu, 90) ger raderna aldre an 90 dagar",
    lika(palettAttRadera(rader, nu, 90), [{ q: "gammal", week: "2026-07-20" }, { q: "utan dag", week: "2026-06-01" }]),
    JSON.stringify(palettAttRadera(rader, nu, 90)));
  ok("en rad pa grANSEN sparas", !palettAttRadera(rader, nu, 90).some((r) => r.q === "grans"));
}

console.log("\n\x1b[1mKandidaterna (F1-6, 0110:231-239, B5)\x1b[0m");
{
  const nu = new Date("2026-10-23T03:00:00Z");
  const k = (id, x) => ({ id, stage: "rejected", hired_employee_id: null, talent_pool: false, talent_pool_consent: null, gdpr_purge_at: null, senaste: "2026-10-01T10:00:00Z", cv_file_id: null, ...x });
  const rader = [
    k("avslag-13-man", { gdpr_purge_at: "2026-09-22T10:00:00Z", senaste: "2025-09-22T10:00:00Z" }),
    k("avslag-11-man", { gdpr_purge_at: "2026-11-22T10:00:00Z", senaste: "2025-11-22T10:00:00Z" }),
    k("anstalld", { stage: "hired", hired_employee_id: "e1", gdpr_purge_at: "2025-01-01T00:00:00Z", senaste: "2024-01-01T00:00:00Z" }),
    k("anstalld-utan-steg", { stage: "offer", hired_employee_id: "e2", senaste: "2024-01-01T00:00:00Z" }),
    k("oppen-stilla-13-man", { stage: "screening", senaste: "2025-09-20T10:00:00Z" }),
    k("oppen-aktiv", { stage: "screening", senaste: "2026-09-20T10:00:00Z" }),
    k("pool-25-man", { talent_pool: true, talent_pool_consent: "2024-09-20T10:00:00Z", senaste: "2024-09-20T10:00:00Z" }),
    k("pool-23-man", { talent_pool: true, talent_pool_consent: "2024-11-25T10:00:00Z", senaste: "2024-09-20T10:00:00Z" }),
    k("pool-utan-samtycke-gammal", { talent_pool: true, senaste: "2024-01-01T10:00:00Z" }),
  ];
  const ut = kandidaterAttRadera(rader, nu, { fristDagar: 365, poolManader: 24 });
  ok("avslag for 13 manader sedan gallras", ut.includes("avslag-13-man"));
  ok("avslag for 11 manader sedan star kvar (gdpr_purge_at i framtiden)", !ut.includes("avslag-11-man"));
  ok("en anstalld kandidat gallras aldrig", !ut.includes("anstalld") && !ut.includes("anstalld-utan-steg"));
  ok("en oppen process utan handelse pa 12 manader gallras", ut.includes("oppen-stilla-13-man"));
  ok("en oppen process med handelser star kvar", !ut.includes("oppen-aktiv"));
  ok("talangpoolen: samtycke for 25 manader sedan gallras", ut.includes("pool-25-man"));
  ok("talangpoolen: samtycke for 23 manader sedan star kvar", !ut.includes("pool-23-man"));
  ok("talangpoolen utan samtycke raknas fran senaste handelsen", ut.includes("pool-utan-samtycke-gammal"));
  // Granskningen V1: hired_employee_id ar "on delete set null". En anstalld som
  // tagits bort skyddar inte langre sin kandidatrad.
  const borttagna = [
    k("anstalld-borttagen", { stage: "hired", hired_employee_id: null, gdpr_purge_at: "2025-01-01T00:00:00Z", senaste: "2024-01-01T00:00:00Z" }),
    k("anstalld-som-slutat-helt", { stage: "hired", hired_employee_id: "e9", gdpr_purge_at: "2025-01-01T00:00:00Z", senaste: "2024-01-01T00:00:00Z" }),
    k("anstalld-aktiv", { stage: "hired", hired_employee_id: "e1", gdpr_purge_at: "2025-01-01T00:00:00Z", senaste: "2024-01-01T00:00:00Z" }),
  ];
  const ut2 = kandidaterAttRadera(borttagna, nu, { fristDagar: 365, poolManader: 24, aktivaAnstallda: new Set(["e1"]) });
  ok("en anstalld kandidat vars person tagits bort helt gallras efter gallringsdagen", ut2.includes("anstalld-borttagen"));
  ok("en anstalld kandidat vars person star som borttagen gallras", ut2.includes("anstalld-som-slutat-helt"));
  ok("en anstalld kandidat vars person finns kvar gallras inte", !ut2.includes("anstalld-aktiv"));
  ok("utan beslutad frist gallras ingen utanfor poolen",
    lika(kandidaterAttRadera(rader, nu, { fristDagar: null, poolManader: 24 }).sort(), ["pool-25-man", "pool-utan-samtycke-gammal"]));
}

console.log("\n\x1b[1mMotesbolag (Moten A11): 24 manader efter senaste handelsen\x1b[0m");
{
  const nu = new Date("2026-10-29T03:00:00Z");
  const b = (id, senast_handelse, affar = false) => ({ id, senast_handelse, affar });
  const rader = [
    b("24-man-1-dag", "2024-10-28T03:00:00Z"),            // 24 manader och 1 dag
    b("24-man-1-sek", "2024-10-29T02:59:59Z"),            // en sekund over gransen
    b("23-man", "2024-11-29T03:00:00Z"),                  // 23 manader
    b("pa-gransen", "2024-10-29T03:00:00Z"),              // exakt 24 manader
    b("ny", "2026-10-01T10:00:00Z"),
    b("affar-gammal", "2022-01-01T00:00:00Z", true),      // affar: orderns regler galler
    b("affar-24-man-1-dag", "2024-10-28T03:00:00Z", true),
    b("gammal", "2023-03-15T12:00:00Z"),
  ];
  const ut = motesbolagAttRadera(rader, nu);
  ok("24 manader och 1 dag sedan, utan affar: raderas", ut.includes("24-man-1-dag"));
  ok("en sekund over 24 manader, utan affar: raderas", ut.includes("24-man-1-sek"));
  ok("23 manader sedan: star kvar", !ut.includes("23-man"));
  ok("exakt pa gransen star kvar (som talangpoolen: strikt aldre)", !ut.includes("pa-gransen"));
  ok("ett ungt bolag star kvar", !ut.includes("ny"));
  ok("med affar star bolaget kvar oavsett alder", !ut.includes("affar-gammal") && !ut.includes("affar-24-man-1-dag"));
  ok("ett mycket gammalt bolag utan affar raderas", ut.includes("gammal"));
  ok("bara de utan affar och aldre an 24 manader", lika([...ut].sort(), ["24-man-1-dag", "24-man-1-sek", "gammal"].sort()), JSON.stringify(ut));
  ok("tom lista ger tom lista", lika(motesbolagAttRadera([], nu), []));
  ok("en tidsstampel som inte gar att tolka raderar inte", lika(motesbolagAttRadera([b("trasig", "inte ett datum")], nu), []));
}

console.log("\n\x1b[1mForaldralosa filer i lagringen (F1-5, C7)\x1b[0m");
{
  const nu = new Date("2026-10-23T03:00:00Z");
  const o = (lager, path, andrad = "2026-10-01T00:00:00Z") => ({ lager, bucket: lager === "r2" ? "intranet" : "filer", path, andrad });
  const objekt = [
    o("r2", "sales_order/a"),                              // har rad
    o("r2", "sales_order/b"),                              // saknar rad: foraldralos
    o("r2", "sick_certificate/c"),                         // intyg efter raderad sjukanmalan
    o("supabase", "arenden/x/d"),                          // arendebilaga utan rad
    o("supabase", "arenden/x/e"),                          // arendebilaga med rad
    o("r2", "roleplay/f", "2026-10-22T20:00:00Z"),        // laddas upp just nu: for ung
    o("r2", "kalender/g"),                                 // okant prefix: rors aldrig
    o("supabase", "arenden/x/.emptyFolderPlaceholder"),    // Supabases platshallare
  ];
  const kanda = new Set(["r2|intranet|sales_order/a", "supabase|filer|arenden/x/e"]);
  const ut = foraldralosa(objekt, kanda, nu).map((x) => x.path);
  ok("en fil utan rad ar foraldralos", ut.includes("sales_order/b") && ut.includes("sick_certificate/c"));
  ok("en arendebilaga utan rad ar foraldralos", ut.includes("arenden/x/d"));
  ok("en fil med rad star kvar", !ut.includes("sales_order/a") && !ut.includes("arenden/x/e"));
  ok("en fil yngre an ett dygn star kvar (uppladdningen kan pagaa)", !ut.includes("roleplay/f"));
  ok("ett prefix utan ägare i navet rors aldrig", !ut.includes("kalender/g"));
  ok("Supabases platshallare raknas inte", !ut.some((p) => p.endsWith(".emptyFolderPlaceholder")));
}

console.log("\n\x1b[1mFiler som forsvann med en person (personal-radering)\x1b[0m");
{
  const fore = [
    { id: "1", tabell: "file_object", store: "r2", bucket: "intranet", path: "sick_certificate/1" },
    { id: "2", tabell: "file_object", store: "r2", bucket: "intranet", path: "call_recording/2" },
    { id: "3", tabell: "hr_case_attachment", store: "supabase", bucket: "filer", path: "arenden/k/3" },
  ];
  const kvar = new Set(["file_object|2"]);
  ok("intyget och bilagan, vars rader ar borta, ska bort ur lagringen",
    lika(forsvunna(fore, kvar).map((r) => r.id), ["1", "3"]));
  ok("en rad som star kvar (foretagets underlag) rors inte", !forsvunna(fore, kvar).some((r) => r.id === "2"));
}

console.log(fel === 0
  ? `\n\x1b[32mAlla ${antal} kontroller godkanda.\x1b[0m\n`
  : `\n\x1b[31m${fel} av ${antal} kontroll(er) underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
