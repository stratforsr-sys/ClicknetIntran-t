#!/usr/bin/env node
/**
 * E10: stegen, tratten och de tva sparrarna som ar hela modulen.
 *
 *   node --experimental-strip-types tests/rekrytering.mjs
 *
 * Tva halvor. Forst raknelogiken, sedan databasen — och den andra halvan ar den
 * viktiga: bade stegordningen (AC-7.3) och scorecardvillkoret (AC-7.6) ligger i
 * triggrar, sa de maste provas dar och inte mot en if-sats i en knapp.
 *
 * Provet kontrollerar ocksa att `nastaSteg()` i src/lib/rekrytering.ts stammer
 * med triggern. De star pa tva stallen med flit — granssnittet behover veta
 * vilka knappar det ska rita — och nagot maste marka nar de glider isar.
 *
 * Kraver DATABASE_URL.
 */
import pg from "pg";
import { STEG, TRATTSTEG, arOppen, dagarSedan, liggetid, nastaSteg, tratt } from "../src/lib/rekrytering.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ---------------------------------------------------------------------------
// Raknelogiken
// ---------------------------------------------------------------------------

rubrik("Stegordningen gar framat, och avslag gar fran allt som ar oppet");

ok("fran ny gar det till screening eller avslag",
  JSON.stringify(nastaSteg("new")) === JSON.stringify(["screening", "rejected"]));
ok("intervju 1 far hoppa over intervju 2", nastaSteg("interview_1").includes("offer"));
ok("men screening far INTE hoppa till erbjudande", !nastaSteg("screening").includes("offer"));
// Kunde man ga direkt hit vore scorecardvillkoret i AC-7.6 verkningslost.
ok("anstalld gar bara fran erbjudande",
  STEG.filter((s) => nastaSteg(s).includes("hired")).join(",") === "offer");
ok("fran anstalld gar det ingenstans", nastaSteg("hired").length === 0);
ok("och inte tillbaka fran avslag heller", nastaSteg("rejected").length === 0);

ok("en pagaende process ar oppen", arOppen("interview_2"));
ok("en anstalld ar det inte", !arOppen("hired"));
ok("och inte ett avslag heller", !arOppen("rejected"));

rubrik("Tratten raknar dem som KOMMIT sa langt, inte dem som star dar nu");

const nu = new Date("2026-08-23T12:00:00Z");
const k = (id, stage, kalla, dagar, closed = null) => ({
  id,
  stage,
  source_slug: kalla,
  applied_at: new Date(nu.getTime() - dagar * 86_400_000).toISOString(),
  closed_at: closed,
});

{
  const rader = tratt(
    [
      k("1", "hired", "linkedin", 200, "x"),
      k("2", "offer", "linkedin", 10),
      k("3", "new", "linkedin", 2),
      k("4", "rejected", "tips", 100, "x"),
    ],
    nu,
  );

  const li = rader.find((r) => r.kalla === "linkedin");
  ok("tre kandidater fran LinkedIn", li.totalt === 3, String(li.totalt));
  // Detta ar felet som ar latt att gora: `offer` far inte visa 1 bara for att
  // en av dem gick vidare till anstalld.
  ok("alla tre har passerat 'ny'", li.per_steg.new === 3, String(li.per_steg.new));
  ok("tva har natt erbjudande", li.per_steg.offer === 2, String(li.per_steg.offer));
  ok("en ar anstalld", li.per_steg.hired === 1 && li.anstallda === 1);

  const tips = rader.find((r) => r.kalla === "tips");
  ok("ett avslag raknas som avslag", tips.avslag === 1);
  // Annars hade summan av stegen blivit storre an antalet kandidater.
  ok("och inte som ett trattsteg", TRATTSTEG.every((s) => tips.per_steg[s] === 0));
}

{
  // Kvar efter 90 och 180 dagar galler bara den som fortfarande ar i processen.
  const rader = tratt(
    [
      k("1", "interview_1", "platsbanken", 200),
      k("2", "interview_1", "platsbanken", 100),
      k("3", "interview_1", "platsbanken", 10),
      k("4", "hired", "platsbanken", 300, "x"),
    ],
    nu,
  );
  const p = rader[0];
  ok("tva ar kvar efter 90 dagar", p.kvar_90 === 2, String(p.kvar_90));
  ok("en ar kvar efter 180", p.kvar_180 === 1, String(p.kvar_180));
  ok("den anstallda raknas inte som kvar — processen ar slut", p.kvar_180 === 1);
}

ok("storsta kallan star forst",
  tratt([k("1", "new", "b", 1), k("2", "new", "a", 1), k("3", "new", "a", 1)], nu)[0].kalla === "a");

rubrik("Liggetid pekar ut den som glomts bort");

ok("sex veckor pa samma steg syns", liggetid(new Date(nu.getTime() - 42 * 86_400_000).toISOString(), nu) === 42);
ok("skrap ger null och inte NaN", dagarSedan("inte ett datum", nu) === null);

// ---------------------------------------------------------------------------
// Databasen
// ---------------------------------------------------------------------------

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const MARK = "rekrytest-";
const stad = async () => {
  await db.query(`delete from candidate where email like $1`, [MARK + "%"]);
  await db.query(`delete from employee where email like $1`, [MARK + "%"]);
};
await stad();

const { rows: [chef] } = await db.query(
  `insert into employee (email, first_name, last_name, status, employment_type)
   values ($1, 'Rekry', 'Testsson', 'active', 'permanent') returning id`,
  [MARK + "chef@clicknet.se"],
);

const nyKandidat = async (stage = "new") => {
  const { rows: [c] } = await db.query(
    `insert into candidate (first_name, last_name, email, source_slug, stage, created_by)
     values ('Kim', 'Sokande', $1, 'linkedin', $2, $3::uuid) returning id`,
    [`${MARK}${Math.random().toString(36).slice(2, 10)}@example.com`, stage, chef.id],
  );
  return c.id;
};

const nekar = async (sql, params) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
};

rubrik("AC-7.3: stegordningen ligger i databasen, inte i knappen");

{
  const id = await nyKandidat();

  /** Satter laget forbi triggern, sa att varje utgangssteg gar att prova for sig. */
  const stallIn = async (steg) => {
    await db.query(`alter table candidate disable trigger candidate_stegbyte`);
    await db.query(`update candidate set stage = $2 where id = $1::uuid`, [id, steg]);
    await db.query(`alter table candidate enable trigger candidate_stegbyte`);
  };

  /**
   * Hela matrisen: varje steg mot varje annat steg. Det ar ocksa provet pa att
   * `nastaSteg()` i biblioteket stammer med triggern — listan star pa tva
   * stallen med flit, och nagot maste marka nar de glider isar.
   *
   * `offer` och `hired` star utanfor har. De har egna villkor (AC-7.6 och
   * AC-7.9) och provas i nasta avsnitt.
   */
  for (const fran of STEG) {
    for (const till of STEG) {
      if (till === fran || till === "offer" || till === "hired") continue;

      await stallIn(fran);
      const svar = await nekar(`update candidate set stage = $2 where id = $1::uuid`, [id, till]);
      const gick = svar === null;
      const borde = nastaSteg(fran).includes(till);

      ok(`${fran} -> ${till} ${borde ? "gar" : "nekas"}`, gick === borde,
        gick ? "slapptes igenom" : "nekades");
    }
  }
}

rubrik("AC-7.6: ett erbjudande kraver en ifylld scorecard");

{
  const id = await nyKandidat("interview_1");

  const utan = await nekar(`update candidate set stage = 'offer' where id = $1::uuid`, [id]);
  ok("utan scorecard nekas erbjudandet", utan !== null, utan ? "" : "SLAPPTES IGENOM");

  await db.query(
    `insert into interview_scorecard (candidate_id, stage, interviewer_id, recommendation)
     values ($1::uuid, 'interview_1', $2::uuid, 'yes')`,
    [id, chef.id],
  );

  const med = await nekar(`update candidate set stage = 'offer' where id = $1::uuid`, [id]);
  ok("med scorecard gar det igenom", med === null, med ?? "");

  // En anstallning utan employee-rad ar en kandidat som forsvunnit ur bada
  // registren. AC-7.9 kraver kopplingen.
  const utanRad = await nekar(`update candidate set stage = 'hired' where id = $1::uuid`, [id]);
  ok("anstalld utan employee-rad nekas", utanRad !== null, utanRad ? "" : "SLAPPTES IGENOM");
}

rubrik("Stegloggen skrivs av databasen och gar inte att andra");

{
  const id = await nyKandidat();
  await db.query(`update candidate set stage = 'screening' where id = $1::uuid`, [id]);
  await db.query(`update candidate set stage = 'rejected' where id = $1::uuid`, [id]);

  const { rows } = await db.query(
    `select from_stage, to_stage from candidate_stage_event where candidate_id = $1::uuid order by id`,
    [id],
  );
  ok("tre rader: skapad, screening, avslag", rows.length === 3, `${rows.length} rader`);
  ok("den forsta har inget fran-steg", rows[0].from_stage === null && rows[0].to_stage === "new");
  ok("och den sista bar bytet", rows[2].from_stage === "screening" && rows[2].to_stage === "rejected");

  const andra = await nekar(`update candidate_stage_event set to_stage = 'hired' where candidate_id = $1::uuid`, [id]);
  ok("loggen gar inte att skriva om", andra !== null, andra ? "" : "SLAPPTES IGENOM");
  const radera = await nekar(`delete from candidate_stage_event where candidate_id = $1::uuid`, [id]);
  ok("och inte att radera", radera !== null, radera ? "" : "SLAPPTES IGENOM");
}

rubrik("K27: inget personnummer, inte heller i en intervjuanteckning");

{
  const id = await nyKandidat();
  for (const [vad, text] of [
    ["med bindestreck", "kandidaten heter 850101-1234"],
    ["utan bindestreck", "198501011234 star i cv:t"],
    ["med plus", "850101+1234"],
  ]) {
    const svar = await nekar(`update candidate set notes = $2 where id = $1::uuid`, [id, text]);
    ok(`anteckning ${vad} nekas`, svar !== null, svar ? "" : "SLAPPTES IGENOM");
  }

  const vanlig = await nekar(
    `update candidate set notes = $2 where id = $1::uuid`,
    [id, "Bra på invändningar. Nås på 070-123 45 67."],
  );
  ok("en vanlig anteckning gar igenom", vanlig === null, vanlig ?? "");

  const scorecard = await nekar(
    `insert into interview_scorecard (candidate_id, stage, interviewer_id, recommendation, concerns)
     values ($1::uuid, 'screening', $2::uuid, 'maybe', 'sa 850101-1234 i telefon')`,
    [id, chef.id],
  );
  ok("och inte i en scorecard heller", scorecard !== null, scorecard ? "" : "SLAPPTES IGENOM");
}

rubrik("AC-7.8: ingen gallringsfrist ar seedad, sa ingen frist satts");

{
  const { rows: [policy] } = await db.query(`select purge_after_days from recruitment_policy where id`);
  ok("purge_after_days ar null tills nagon bestamt", policy.purge_after_days === null,
    String(policy.purge_after_days));

  const id = await nyKandidat();
  await db.query(`update candidate set stage = 'rejected' where id = $1::uuid`, [id]);
  const { rows: [k1] } = await db.query(`select gdpr_purge_at, closed_at from candidate where id = $1::uuid`, [id]);
  ok("avslaget satter closed_at", k1.closed_at !== null);
  // En pahittad frist raderar personuppgifter enligt en gissning och SER UT att
  // uppfylla kravet. Samma linje som E6.2.
  ok("men ingen gallringsfrist", k1.gdpr_purge_at === null, String(k1.gdpr_purge_at));

  // Med en frist satt ska den daremot verkstallas.
  await db.query(`update recruitment_policy set purge_after_days = 30 where id`);
  const id2 = await nyKandidat();
  await db.query(`update candidate set stage = 'rejected' where id = $1::uuid`, [id2]);
  const { rows: [k2] } = await db.query(`select gdpr_purge_at from candidate where id = $1::uuid`, [id2]);
  ok("med en frist satt fylls gdpr_purge_at i", k2.gdpr_purge_at !== null);

  // AC-7.8: talangpoolen undantas.
  const id3 = await nyKandidat();
  await db.query(
    `update candidate set talent_pool = true, talent_pool_consent = now() where id = $1::uuid`, [id3]);
  await db.query(`update candidate set stage = 'rejected' where id = $1::uuid`, [id3]);
  const { rows: [k3] } = await db.query(`select gdpr_purge_at from candidate where id = $1::uuid`, [id3]);
  ok("talangpoolen undantas fran gallringen", k3.gdpr_purge_at === null, String(k3.gdpr_purge_at));

  const utanSamtycke = await nekar(
    `update candidate set talent_pool = true, talent_pool_consent = null where id = $1::uuid`, [id3]);
  ok("och ett samtycke utan datum ar inget samtycke", utanSamtycke !== null,
    utanSamtycke ? "" : "SLAPPTES IGENOM");

  await db.query(`update recruitment_policy set purge_after_days = null where id`);
}

await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov föll.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
