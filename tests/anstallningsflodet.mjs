#!/usr/bin/env node
/**
 * E10.9: anstallningsflodet, och de fyra sparrarna som ar hela poangen.
 *
 *   node --experimental-strip-types tests/anstallningsflodet.mjs
 *
 * Tva halvor. Forst checklistelogiken, sedan databasen — och den andra halvan
 * ar den viktiga: sparrarna ligger i triggrar och index, inte i en if-sats i en
 * knapp, sa de maste provas dar.
 *
 * De fyra:
 *
 *   1. `hired` nekas utan `hired_employee_id`     (0030, AC-7.9)
 *   2. `hired` gar bara fran `offer`              (0030, AC-7.3)
 *   3. tva kandidater kan inte peka pa samma anstalld (0033)
 *   4. kopplingen gar inte att peka om             (0033)
 *
 * Och undantaget som gor att nummer 4 inte faller sonder: `on delete set null`
 * MASTE fa nolla kopplingen, annars dor `delete from employee` — samma falla
 * som `file_object` gick i 0023.
 *
 * Kraver DATABASE_URL.
 */
import pg from "pg";
import { checklista, klart } from "../src/lib/onboarding.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ---------------------------------------------------------------------------
// Checklistan
// ---------------------------------------------------------------------------

rubrik("Checklistan bokfor det som redan ar gjort, men som KLART");

{
  const utan = checklista(false, 0);
  const med = checklista(true, 3);

  ok("kontot, rutinerna och kurserna fods avbockade",
    utan.filter((p) => p.automatisk).length === 3);
  // En lista dar tre av tolv redan ar utforda men star som oppna lar
  // anvandaren att bocka av utan att lasa.
  ok("och ingenting annat gor det",
    utan.filter((p) => p.automatisk).length === med.filter((p) => p.automatisk).length);

  ok("utan avtal star punkten som en att-gora",
    utan.some((p) => p.label.includes("upprättat") && !p.automatisk));
  ok("med avtal pekar den pa utkastet i stallet",
    med.some((p) => p.label.includes("utkast") && !p.automatisk));
  ok("och listan ar lika lang i bada fallen", utan.length === med.length);

  ok("antalet kurser skrivs ut nar det finns nagra",
    med.some((p) => p.label.includes("(3 st)")));
  ok("men inte som noll nar det inte gor det",
    !utan.some((p) => p.label.includes("(0")));
}

rubrik("Klart-raknaren raknar hoppade punkter som avklarade");

{
  // En hoppad punkt ar hanterad — motiveringen ar kvittensen. Rakandes den som
  // oppen hade listan aldrig blivit fardig.
  const r = klart([{ state: "done" }, { state: "skipped" }, { state: "open" }]);
  ok("tva av tre", r.avklarade === 2 && r.av === 3);
  ok("en tom lista ar noll av noll", klart([]).av === 0);
}

// ---------------------------------------------------------------------------
// Databasen
// ---------------------------------------------------------------------------

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const MARK = "anstalltest-";
const stad = async () => {
  await db.query(`delete from candidate where email like $1`, [MARK + "%"]);
  await db.query(`delete from employee where email like $1`, [MARK + "%"]);
};
await stad();

const nyAnstalld = async (suffix) => {
  const { rows: [e] } = await db.query(
    `insert into employee (email, first_name, last_name, status, employment_type)
     values ($1, 'Ny', 'Anstalld', 'onboarding', 'permanent') returning id`,
    [`${MARK}${suffix}@clicknet.se`],
  );
  return e.id;
};

const nyKandidat = async (stage = "offer") => {
  const { rows: [c] } = await db.query(
    `insert into candidate (first_name, last_name, email, source_slug, stage)
     values ('Kim', 'Sokande', $1, 'linkedin', $2) returning id`,
    [`${MARK}${Math.random().toString(36).slice(2, 10)}@example.com`, stage],
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

const chef = await nyAnstalld("chef");

rubrik("AC-7.9: sparren som fanns redan i 0030");

{
  const id = await nyKandidat("offer");

  const utan = await nekar(`update candidate set stage = 'hired' where id = $1::uuid`, [id]);
  ok("hired nekas utan en employee-rad att peka pa", utan !== null,
    utan ? "" : "slapptes igenom");

  const anst = await nyAnstalld("a1");
  const med = await nekar(
    `update candidate set stage = 'hired', hired_employee_id = $2::uuid where id = $1::uuid`,
    [id, anst],
  );
  ok("men gar igenom nar bada skrivs i SAMMA update", med === null, med ?? "");

  const { rows: [k] } = await db.query(
    `select stage, closed_at, hired_employee_id from candidate where id = $1::uuid`, [id]);
  ok("kandidaten ar stangd", k.closed_at !== null);
  ok("och pekar pa ratt person", k.hired_employee_id === anst);
}

rubrik("0033: en anstalld ar resultatet av HOGST en rekrytering");

{
  const anst = await nyAnstalld("a2");
  const forsta = await nyKandidat("offer");
  await db.query(
    `update candidate set stage = 'hired', hired_employee_id = $2::uuid where id = $1::uuid`,
    [forsta, anst],
  );

  // Ett dubbelklick pa Anstall ar den vanligaste vagen hit, och foljden ar att
  // trattrapporten raknar en anstallning som tva.
  const andra = await nyKandidat("offer");
  const svar = await nekar(
    `update candidate set stage = 'hired', hired_employee_id = $2::uuid where id = $1::uuid`,
    [andra, anst],
  );
  ok("en andra kandidat kan inte peka pa samma anstalld", svar !== null,
    svar ? "" : "slapptes igenom");

  // Men manga kandidater FAR sta pa null samtidigt — det ar darfor indexet ar
  // partiellt.
  const tredje = await nyKandidat("screening");
  const fjarde = await nyKandidat("screening");
  ok("medan hur manga som helst far sta utan koppling",
    tredje !== null && fjarde !== null);
}

rubrik("0033: kopplingen skrivs en gang");

{
  const en = await nyAnstalld("a3");
  const tva = await nyAnstalld("a4");
  const id = await nyKandidat("offer");

  await db.query(
    `update candidate set stage = 'hired', hired_employee_id = $2::uuid where id = $1::uuid`,
    [id, en],
  );

  const svar = await nekar(
    `update candidate set hired_employee_id = $2::uuid where id = $1::uuid`, [id, tva]);
  ok("den gar inte att peka om till nagon annan", svar !== null,
    svar ? "" : "slapptes igenom");

  /**
   * UNDANTAGET. `on delete set null` kor en UPDATE pa kandidatraden, sa en
   * trigger som nekade all andring hade fallt hela raderingen — och E6.2
   * gallringsjobbet hade en dag dott pa det mitt i natten.
   */
  const raderat = await nekar(`delete from employee where id = $1::uuid`, [en]);
  ok("men en radering av personen far nolla den", raderat === null, raderat ?? "");

  const { rows: [k] } = await db.query(
    `select hired_employee_id, stage from candidate where id = $1::uuid`, [id]);
  ok("kandidatraden star kvar som historik", k !== undefined && k.stage === "hired");
  ok("utan att peka nagonstans", k.hired_employee_id === null);
}

rubrik("Checklistan i databasen: AC-1.7 galler at bada hallen");

{
  const anst = await nyAnstalld("a5");
  const punkter = checklista(false, 2);

  await db.query(
    `insert into onboarding_task (employee_id, label, sort, state, handled_by, handled_at)
     select $1::uuid, x.label, x.sort, x.state,
            case when x.state = 'done' then $2::uuid end,
            case when x.state = 'done' then now() end
       from jsonb_to_recordset($3::jsonb) as x(label text, sort int, state text)`,
    [
      anst,
      chef,
      JSON.stringify(
        punkter.map((p, i) => ({ label: p.label, sort: i, state: p.automatisk ? "done" : "open" })),
      ),
    ],
  );

  const { rows } = await db.query(
    `select state from onboarding_task where employee_id = $1::uuid`, [anst]);
  ok(`hela listan lades upp (${rows.length} punkter)`, rows.length === punkter.length);
  ok("tre av dem redan avbockade", rows.filter((r) => r.state === "done").length === 3);

  const { rows: [p] } = await db.query(
    `select id from onboarding_task where employee_id = $1::uuid and state = 'open' limit 1`, [anst]);

  const utan = await nekar(
    `update onboarding_task set state = 'skipped' where id = $1::uuid`, [p.id]);
  ok("en punkt gar inte att hoppa over utan motivering", utan !== null,
    utan ? "" : "slapptes igenom");

  const tom = await nekar(
    `update onboarding_task set state = 'skipped', skipped_reason = '   ' where id = $1::uuid`, [p.id]);
  ok("och blanktecken raknas inte som en motivering", tom !== null,
    tom ? "" : "slapptes igenom");

  const med = await nekar(
    `update onboarding_task set state = 'skipped', skipped_reason = 'Personen har egen dator'
       where id = $1::uuid`, [p.id]);
  ok("med en motivering gar det", med === null, med ?? "");

  // Checklistan foljer med personen ut. Den ar inte historik som ska sparas —
  // punkterna sager ingenting utan personen de gallde.
  await db.query(`delete from employee where id = $1::uuid`, [anst]);
  const { rows: kvar } = await db.query(
    `select id from onboarding_task where employee_id = $1::uuid`, [anst]);
  ok("och listan foljer med personen ut", kvar.length === 0);
}

await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller gick igenom.\x1b[0m" : `\n\x1b[31m${fel} fel.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
