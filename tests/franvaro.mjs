#!/usr/bin/env node
/**
 * E7 / M3 regelmotorn. Ren logik, ingen databas, ingen klocka.
 *
 *   node --experimental-strip-types tests/franvaro.mjs
 *
 * Provet skickar in sina egna regler. Det speglar hur modulen ska fungera i
 * drift: reglerna kommer ur tabeller (E7.15), och motorn ska ge samma svar
 * oavsett vilka tal den far. Ett prov som laste seed-varden ur databasen hade
 * slutat prova motorn och borjat prova seeden.
 */
import {
  antalDagar,
  aterinsjuknande,
  boreskalera,
  dagarMellan,
  dagarna,
  datumPlus,
  femarsvarning,
  franvarominuter,
  iHuvudsemesterfonstret,
  omfattning,
  periodtext,
  provaRegler,
  reglerFor,
  saldoFor,
  saldotArGammalt,
  semesteraret,
  semesteraretsEtikett,
  sjukfrister,
  upprepadKorttid,
  varstaBemanningsdag,
} from "../src/lib/franvaro.ts";
import { ical } from "../src/lib/ical.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// Semesterlagens miniminiva, samma varden som seedas i 0019.
const REGLER = {
  vacation_year_start_month: 4,
  vacation_year_start_day: 1,
  main_vacation_start_month: 6,
  main_vacation_start_day: 1,
  main_vacation_end_month: 8,
  main_vacation_end_day: 31,
  main_vacation_notice_days: 60,
  saved_days_max_years: 5,
  balance_stale_days: 45,
  sick_certificate_day: 8,
  sick_fk_day: 15,
  sick_return_plan_day: 30,
  sick_confirm_hours: 48,
  relapse_days: 5,
  repeat_sick_count: 6,
  repeat_sick_months: 12,
  unregistered_reminder_hours: 24,
};

const SEMESTER = {
  id: "vacation",
  label: "Semester",
  sort: 1,
  notice_days: 14,
  max_consecutive_days: null,
  waiting_days: 0,
  approval_level: "manager",
  uses_balance: true,
  counts_in_staffing: true,
  allows_part_day: true,
  requestable: true,
  active: true,
};

const VAB = { ...SEMESTER, id: "vab", label: "Vård av sjukt barn", notice_days: 0, uses_balance: false, counts_in_staffing: false };

const grund = (over = {}) => ({
  typ: SEMESTER,
  regler: REGLER,
  idag: "2026-09-01",
  sparrperioder: [],
  teamId: null,
  saldon: [],
  egnaPerioder: [],
  andrasPerioder: [],
  tak: null,
  raknasIBemanning: new Set(["vacation", "parental", "unpaid_leave", "comp_leave"]),
  ...over,
});

const ansokan = (over = {}) => ({
  employee_id: "mig",
  type_id: "vacation",
  starts_on: "2026-10-05",
  ends_on: "2026-10-09",
  part_day_minutes: null,
  ...over,
});

const koder = (b) => b.map((x) => x.kod).sort();

// -----------------------------------------------------------------------------
rubrik("Datumräkningen");

ok("antalDagar räknar båda ändarna", antalDagar("2026-10-05", "2026-10-09") === 5);
ok("en endagsledighet är 1 dag", antalDagar("2026-10-05", "2026-10-05") === 1);
ok("dagarMellan är 0 för samma dag", dagarMellan("2026-10-05", "2026-10-05") === 0);
ok("dagarna ger varje dag", dagarna("2026-10-05", "2026-10-07").join(",") === "2026-10-05,2026-10-06,2026-10-07");
ok("datumPlus över månadsskifte", datumPlus("2026-10-31", 1) === "2026-11-01");
ok("datumPlus över årsskifte", datumPlus("2026-12-31", 1) === "2027-01-01");
ok("datumPlus över skottdag", datumPlus("2028-02-28", 1) === "2028-02-29");
// Sommartid far inte kunna tappa eller lagga till en dag. Sista sondagen i mars
// och oktober ar 23 respektive 25 timmar i svensk tid; rakningen sker i UTC.
ok("sommartidens start tappar ingen dag", antalDagar("2027-03-27", "2027-03-29") === 3);
ok("vintertidens start lägger inte till en dag", antalDagar("2027-10-30", "2027-11-01") === 3);

// -----------------------------------------------------------------------------
rubrik("Semesteråret och huvudsemesterfönstret");

ok("mars hör till föregående semesterår", semesteraret("2027-03-15", REGLER).start === "2026-04-01");
ok("april börjar ett nytt", semesteraret("2027-04-01", REGLER).start === "2027-04-01");
ok("semesteråret slutar 31 mars", semesteraret("2026-09-01", REGLER).slut === "2027-03-31");
ok("etiketten blir 2026/27", semesteraretsEtikett("2026-09-01", REGLER) === "2026/27");
ok(
  "kalenderår ger en enda siffra",
  semesteraretsEtikett("2026-09-01", { ...REGLER, vacation_year_start_month: 1 }) === "2026",
);
ok("1 juni ligger i fönstret", iHuvudsemesterfonstret("2026-06-01", REGLER));
ok("31 augusti ligger i fönstret", iHuvudsemesterfonstret("2026-08-31", REGLER));
ok("1 september gör det inte", !iHuvudsemesterfonstret("2026-09-01", REGLER));
// Ett fonster over arsskiftet ar inte hypotetiskt: E7.15 sager att fonstret ar
// konfigurerbart, och en organisation med sommaruppehall i januari finns.
ok(
  "ett fönster över årsskiftet vänds rätt",
  iHuvudsemesterfonstret("2027-01-10", { ...REGLER, main_vacation_start_month: 12, main_vacation_end_month: 1, main_vacation_end_day: 31 }),
);

// -----------------------------------------------------------------------------
rubrik("Ansökningsfristen");

ok("34 dagar i förväg bryter ingen regel", provaRegler(ansokan(), grund()).length === 0);
ok(
  "en vecka i förväg bryter fristen",
  koder(provaRegler(ansokan({ starts_on: "2026-09-07", ends_on: "2026-09-11" }), grund())).includes("frist"),
);
ok(
  "typ med frist 0 klagar inte på samma dag",
  provaRegler(
    ansokan({ type_id: "vab", starts_on: "2026-09-01", ends_on: "2026-09-01" }),
    grund({ typ: VAB }),
  ).length === 0,
);
ok(
  "VAB bakåt i tiden går igenom, men syns",
  koder(
    provaRegler(ansokan({ type_id: "vab", starts_on: "2026-08-28", ends_on: "2026-08-28" }), grund({ typ: VAB })),
  ).join() === "bakat",
);
// Maj och inte augusti: augusti ligger i huvudsemesterfonstret, och da kommer
// det brottet med ocksa. Provet galler fristen.
ok(
  "semester bakåt i tiden bryter fristen, inte 'bakat'",
  koder(provaRegler(ansokan({ starts_on: "2026-05-20", ends_on: "2026-05-21" }), grund())).join() === "frist",
);
ok(
  "en försenad ansökan i huvudsemesterfönstret bryter båda fristerna",
  koder(provaRegler(ansokan({ starts_on: "2026-08-20", ends_on: "2026-08-21" }), grund())).join() ===
    "frist,huvudsemester",
);

// -----------------------------------------------------------------------------
rubrik("Huvudsemestern har sin egen frist (11 § semesterlagen)");

ok(
  "juli-semester 34 dagar i förväg bryter tvåmånadersfristen",
  koder(provaRegler(ansokan({ starts_on: "2027-07-05", ends_on: "2027-07-16" }), grund({ idag: "2027-06-01" }))).includes(
    "huvudsemester",
  ),
);
ok(
  "samma vecka sökt i februari bryter ingen regel",
  provaRegler(ansokan({ starts_on: "2027-07-05", ends_on: "2027-07-16" }), grund({ idag: "2027-02-01" })).length === 0,
);
ok(
  "kompledigt i juli rör inte huvudsemesterfristen",
  !koder(
    provaRegler(
      ansokan({ type_id: "comp_leave", starts_on: "2027-07-05", ends_on: "2027-07-05" }),
      grund({ idag: "2027-06-25", typ: { ...SEMESTER, id: "comp_leave", uses_balance: false, notice_days: 7 } }),
    ),
  ).includes("huvudsemester"),
);

// -----------------------------------------------------------------------------
rubrik("Spärrperioder");

const sparr = {
  id: "s1",
  label: "Kampanjvecka 45",
  starts_on: "2026-11-02",
  ends_on: "2026-11-08",
  type_ids: [],
  team_ids: [],
};

ok(
  "en period som krockar med spärren märks",
  koder(
    provaRegler(ansokan({ starts_on: "2026-11-04", ends_on: "2026-11-06" }), grund({ sparrperioder: [sparr] })),
  ).includes("sparrperiod"),
);
ok(
  "veckan efter krockar inte",
  !koder(
    provaRegler(ansokan({ starts_on: "2026-11-09", ends_on: "2026-11-13" }), grund({ sparrperioder: [sparr] })),
  ).includes("sparrperiod"),
);
ok(
  "spärr för ett annat team gäller inte mig",
  !koder(
    provaRegler(
      ansokan({ starts_on: "2026-11-04", ends_on: "2026-11-06" }),
      grund({ sparrperioder: [{ ...sparr, team_ids: ["annat-team"] }], teamId: "mitt-team" }),
    ),
  ).includes("sparrperiod"),
);
ok(
  "spärr för mitt team gäller mig",
  koder(
    provaRegler(
      ansokan({ starts_on: "2026-11-04", ends_on: "2026-11-06" }),
      grund({ sparrperioder: [{ ...sparr, team_ids: ["mitt-team"] }], teamId: "mitt-team" }),
    ),
  ).includes("sparrperiod"),
);
ok(
  "spärr för en annan typ gäller inte",
  !koder(
    provaRegler(
      ansokan({ starts_on: "2026-11-04", ends_on: "2026-11-06" }),
      grund({ sparrperioder: [{ ...sparr, type_ids: ["unpaid_leave"] }] }),
    ),
  ).includes("sparrperiod"),
);

// -----------------------------------------------------------------------------
rubrik("Maxlängd, del av dag och egen överlappning");

ok(
  "sex dagars kompledigt mot ett tak på fem",
  koder(
    provaRegler(
      ansokan({ type_id: "comp_leave", starts_on: "2026-10-05", ends_on: "2026-10-10" }),
      grund({ typ: { ...SEMESTER, id: "comp_leave", max_consecutive_days: 5, uses_balance: false, notice_days: 7 } }),
    ),
  ).includes("maxlangd"),
);
ok(
  "del av dag på en typ som inte tillåter det",
  koder(
    provaRegler(
      ansokan({ starts_on: "2026-10-05", ends_on: "2026-10-05", part_day_minutes: 120 }),
      grund({ typ: { ...SEMESTER, allows_part_day: false } }),
    ),
  ).includes("deldag"),
);
ok(
  "egen frånvaro som krockar syns redan i formuläret",
  koder(
    provaRegler(
      ansokan(),
      grund({
        egnaPerioder: [
          { employee_id: "mig", type_id: "vab", starts_on: "2026-10-07", ends_on: "2026-10-07", part_day_minutes: null },
        ],
      }),
    ),
  ).includes("overlapp"),
);
ok(
  "en krock rapporteras en gång, inte en gång per dag",
  provaRegler(
    ansokan(),
    grund({
      egnaPerioder: [
        { employee_id: "mig", type_id: "vab", starts_on: "2026-10-06", ends_on: "2026-10-08", part_day_minutes: null },
        { employee_id: "mig", type_id: "vab", starts_on: "2026-10-09", ends_on: "2026-10-09", part_day_minutes: null },
      ],
    }),
  ).filter((b) => b.kod === "overlapp").length === 1,
);

// -----------------------------------------------------------------------------
rubrik("Bemanningstaket räknas per dag, inte per period");

const andras = (namn, fran, till, team = "mitt-team", typ = "vacation") => ({
  employee_id: namn,
  type_id: typ,
  starts_on: fran,
  ends_on: till,
  part_day_minutes: null,
  team_id: team,
});

const bemanning = grund({
  teamId: "mitt-team",
  tak: { team_id: "mitt-team", max_absent: 2 },
  andrasPerioder: [andras("a", "2026-10-07", "2026-10-07"), andras("b", "2026-10-07", "2026-10-07")],
});

ok(
  "två borta redan på onsdagen når taket",
  koder(provaRegler(ansokan(), bemanning)).includes("bemanning"),
);
ok(
  "det är onsdagen som pekas ut, inte hela veckan",
  varstaBemanningsdag(ansokan(), bemanning).datum === "2026-10-07",
);
ok(
  "en borta räcker inte till taket",
  !koder(
    provaRegler(ansokan(), { ...bemanning, andrasPerioder: [andras("a", "2026-10-07", "2026-10-07")] }),
  ).includes("bemanning"),
);
ok(
  "VAB räknas inte mot bemanningen",
  !koder(
    provaRegler(ansokan(), {
      ...bemanning,
      andrasPerioder: [andras("a", "2026-10-07", "2026-10-07", "mitt-team", "vab"), andras("b", "2026-10-07", "2026-10-07", "mitt-team", "vab")],
    }),
  ).includes("bemanning"),
);
ok(
  "ett annat teams frånvaro räknas inte mot mitt tak",
  !koder(
    provaRegler(ansokan(), {
      ...bemanning,
      andrasPerioder: [andras("a", "2026-10-07", "2026-10-07", "annat"), andras("b", "2026-10-07", "2026-10-07", "annat")],
    }),
  ).includes("bemanning"),
);
ok(
  "ett bolagstak räknar alla team",
  koder(
    provaRegler(ansokan(), {
      ...bemanning,
      tak: { team_id: null, max_absent: 2 },
      andrasPerioder: [andras("a", "2026-10-07", "2026-10-07", "annat"), andras("b", "2026-10-07", "2026-10-07", "tredje")],
    }),
  ).includes("bemanning"),
);
ok(
  "min egen redan registrerade frånvaro räknar inte mig två gånger",
  !koder(
    provaRegler(ansokan(), {
      ...bemanning,
      andrasPerioder: [andras("a", "2026-10-07", "2026-10-07"), andras("mig", "2026-10-07", "2026-10-07")],
    }),
  ).includes("bemanning"),
);

// -----------------------------------------------------------------------------
rubrik("Saldon (AC-3.5, AC-3.9)");

const saldon = [
  { type_id: "vacation", days: 12, as_of: "2026-08-01", earned_year: null },
  { type_id: "saved_vacation", days: 3, as_of: "2026-08-01", earned_year: 2021 },
  { type_id: "saved_vacation", days: 2, as_of: "2026-08-01", earned_year: 2024 },
];

ok("saldot för semester är 12", saldoFor(saldon, "vacation").days === 12);
ok("sparade dagar summeras över intjänandeår", saldoFor(saldon, "saved_vacation").days === 5);
ok("en typ utan saldo ger null", saldoFor(saldon, "parental") === null);
ok(
  "senast inmatade per år vinner",
  saldoFor(
    [
      { type_id: "vacation", days: 12, as_of: "2026-08-01", earned_year: null },
      { type_id: "vacation", days: 7, as_of: "2026-08-20", earned_year: null },
    ],
    "vacation",
  ).days === 7,
);
ok(
  "en ansökan längre än saldot märks",
  koder(provaRegler(ansokan({ ends_on: "2026-10-30" }), grund({ saldon }))).includes("saldo"),
);
ok(
  "en typ utan saldo klagar inte på saldot",
  !koder(
    provaRegler(ansokan({ type_id: "vab", starts_on: "2026-09-01", ends_on: "2026-09-30" }), grund({ typ: VAB })),
  ).includes("saldo"),
);
ok("ett saldo från augusti är färskt i september", !saldotArGammalt("2026-08-01", REGLER, "2026-09-01"));
ok("ett saldo från mars är föråldrat i september", saldotArGammalt("2026-03-01", REGLER, "2026-09-01"));

const varning = femarsvarning(saldon, REGLER, "2026-09-01");
ok("dagar från 2021 förfaller (2021 + 5 = 2026)", varning.length === 1 && varning[0].earned_year === 2021);
ok("förfallodagen är semesterårets start", varning[0].forfaller === "2026-04-01");
ok("dagar från 2024 varnas inte än", !varning.some((v) => v.earned_year === 2024));
ok(
  "sparade dagar utan känt intjänandeår varnas inte",
  femarsvarning([{ type_id: "saved_vacation", days: 4, as_of: "2026-08-01", earned_year: null }], REGLER, "2026-09-01")
    .length === 0,
);

// -----------------------------------------------------------------------------
rubrik("K37: fristerna räknas från första sjukdagen, aldrig från registreringen");

const frister = sjukfrister("2026-09-01", REGLER);
ok("dag 8 är sju dygn efter första sjukdagen", frister.find((f) => f.kind === "certificate").due_on === "2026-09-08");
ok("dag 15", frister.find((f) => f.kind === "fk_notice").due_on === "2026-09-15");
ok("dag 30", frister.find((f) => f.kind === "return_plan").due_on === "2026-09-30");
// AC-3.16 i ett enda prov: sjuk pa lordagen, ringer pa mandagen. Fristen ska
// inte ha flyttat sig tva dagar for att anmalan kom sent.
ok(
  "en anmälan som kommer två dagar sent flyttar inte dag 8",
  sjukfrister("2026-09-01", REGLER).find((f) => f.kind === "certificate").due_on === "2026-09-08",
);
ok(
  "andrade dagnummer i regelverket flyttar fristerna",
  sjukfrister("2026-09-01", { ...REGLER, sick_certificate_day: 7 }).find((f) => f.kind === "certificate").due_on ===
    "2026-09-07",
);

// -----------------------------------------------------------------------------
rubrik("Chefsbekräftelse och eskalering (AC-3.17)");

const anm = (over = {}) => ({
  id: "r1",
  employee_id: "mig",
  first_sick_day: "2026-09-01",
  registered_at: "2026-09-01T08:00:00.000Z",
  confirmed_at: null,
  escalated_at: null,
  last_sick_day: null,
  cancelled_at: null,
  ...over,
});

ok("efter 47 timmar eskalerar den inte", !boreskalera(anm(), REGLER, new Date("2026-09-03T06:00:00Z")));
ok("efter 48 timmar gör den det", boreskalera(anm(), REGLER, new Date("2026-09-03T08:00:00Z")));
ok(
  "en bekräftad anmälan eskalerar aldrig",
  !boreskalera(anm({ confirmed_at: "2026-09-01T09:00:00Z" }), REGLER, new Date("2026-09-10T08:00:00Z")),
);
ok(
  "en inställd anmälan eskalerar aldrig",
  !boreskalera(anm({ cancelled_at: "2026-09-01T09:00:00Z" }), REGLER, new Date("2026-09-10T08:00:00Z")),
);
ok(
  "en redan eskalerad eskalerar inte igen",
  !boreskalera(anm({ escalated_at: "2026-09-03T08:00:00Z" }), REGLER, new Date("2026-09-10T08:00:00Z")),
);

// -----------------------------------------------------------------------------
rubrik("Återinsjuknande inom fem dagar (AC-3.24)");

const tidigare = [anm({ id: "gammal", first_sick_day: "2026-08-20", last_sick_day: "2026-08-25" })];

ok("tre dagar senare kopplas till föregående", aterinsjuknande("2026-08-28", tidigare, REGLER)?.id === "gammal");
ok("exakt fem dagar senare kopplas också", aterinsjuknande("2026-08-30", tidigare, REGLER)?.id === "gammal");
ok("sex dagar senare är en ny period", aterinsjuknande("2026-08-31", tidigare, REGLER) === null);
ok(
  "en pågående period kopplas inte till",
  aterinsjuknande("2026-08-28", [anm({ id: "pagaende", last_sick_day: null })], REGLER) === null,
);
ok(
  "den senast avslutade väljs bland flera",
  aterinsjuknande(
    "2026-08-28",
    [
      anm({ id: "aldst", first_sick_day: "2026-08-10", last_sick_day: "2026-08-24" }),
      anm({ id: "senast", first_sick_day: "2026-08-20", last_sick_day: "2026-08-26" }),
    ],
    REGLER,
  )?.id === "senast",
);

// -----------------------------------------------------------------------------
rubrik("Upprepad korttidsfrånvaro (AC-3.25)");

const sex = Array.from({ length: 6 }, (_, i) =>
  anm({ id: `s${i}`, first_sick_day: `2026-0${i + 2}-01`, last_sick_day: `2026-0${i + 2}-02` }),
);

ok("sex tillfällen på tolv månader ger signalen", upprepadKorttid(sex, REGLER, "2026-09-01")?.antal === 6);
ok("fem gör det inte", upprepadKorttid(sex.slice(0, 5), REGLER, "2026-09-01") === null);
ok(
  "en inställd anmälan räknas inte",
  upprepadKorttid([...sex.slice(0, 5), anm({ id: "x", first_sick_day: "2026-08-01", cancelled_at: "2026-08-01T00:00:00Z" })], REGLER, "2026-09-01") ===
    null,
);
ok(
  "tillfällen äldre än fönstret räknas inte",
  upprepadKorttid(
    sex.map((s) => ({ ...s, first_sick_day: s.first_sick_day.replace("2026", "2024") })),
    REGLER,
    "2026-09-01",
  ) === null,
);

// -----------------------------------------------------------------------------
rubrik("E7.4: minuter in i lönerapporten");

// Atta timmar mandag-fredag, inget pa helgen. Sondag ar 0 i getUTCDay.
const schema = (_id, datum) => {
  const veckodag = new Date(datum + "T00:00:00Z").getUTCDay();
  return veckodag === 0 || veckodag === 6 ? 0 : 480;
};

const minuter = franvarominuter(
  [
    // Mandag 5 okt - fredag 9 okt 2026.
    { employee_id: "anna", type_id: "vacation", starts_on: "2026-10-05", ends_on: "2026-10-09", part_day_minutes: null },
    { employee_id: "anna", type_id: "sick", starts_on: "2026-10-12", ends_on: "2026-10-13", part_day_minutes: null, extent_percent: 50 },
    { employee_id: "bo", type_id: "vacation", starts_on: "2026-10-05", ends_on: "2026-10-05", part_day_minutes: 120 },
  ],
  "2026-10-01",
  "2026-10-31",
  schema,
);

ok("fem semesterdagar blir 2400 minuter", minuter.get("anna").vacation === 2400);
ok("halvtidssjukskrivning ger halva dagen", minuter.get("anna").sick === 480);
ok("del av dag räknas som sina minuter", minuter.get("bo").vacation === 120);
ok(
  "en helgdag i perioden ger inga minuter",
  franvarominuter(
    [{ employee_id: "c", type_id: "vacation", starts_on: "2026-10-10", ends_on: "2026-10-11", part_day_minutes: null }],
    "2026-10-01",
    "2026-10-31",
    schema,
  ).get("c") === undefined,
);
// 28 sep - 6 okt klipps till 1-6 okt. Torsdag, fredag, mandag, tisdag ar
// vardagar; lordag och sondag ger noll. Fyra dagar, inte nio.
ok(
  "en period som sträcker sig utanför löneperioden klipps",
  franvarominuter(
    [{ employee_id: "d", type_id: "vacation", starts_on: "2026-09-28", ends_on: "2026-10-06", part_day_minutes: null }],
    "2026-10-01",
    "2026-10-31",
    schema,
  ).get("d").vacation === 480 * 4,
);
// Det ar sa har K5 haller: modulen lamnar minuter, aldrig ett belopp och aldrig
// en semesterratt. Rader som ser ut som pengar ska inte kunna uppsta har.
ok(
  "resultatet bär bara minuter per typ",
  Object.values(minuter.get("anna")).every((v) => Number.isInteger(v)),
);

// -----------------------------------------------------------------------------
rubrik("Reglerna i klartext före inskick (AC-3.13)");

const text = reglerFor(SEMESTER, REGLER);
ok("fristen står med", text.some((t) => t.includes("14 dagar")));
ok("huvudsemesterfristen står med", text.some((t) => t.includes("60 dagar")));
ok("attestnivån står med", text.some((t) => t.includes("närmaste chef")));
ok(
  "en ändrad regel slår igenom i texten",
  reglerFor({ ...SEMESTER, notice_days: 21 }, REGLER).some((t) => t.includes("21 dagar")),
);
ok(
  "karensdagen nämns bara när typen har en",
  !text.some((t) => t.includes("karens")) &&
    reglerFor({ ...SEMESTER, waiting_days: 1 }, REGLER).some((t) => t.includes("karens")),
);

// -----------------------------------------------------------------------------
rubrik("Texter");

ok("en dag", omfattning({ starts_on: "2026-10-05", ends_on: "2026-10-05", part_day_minutes: null }) === "1 dag");
ok("fem dagar", omfattning({ starts_on: "2026-10-05", ends_on: "2026-10-09", part_day_minutes: null }) === "5 dagar");
ok("två och en halv timme", omfattning({ starts_on: "x", ends_on: "x", part_day_minutes: 150 }) === "2 tim 30 min");
ok("jämna timmar", omfattning({ starts_on: "x", ends_on: "x", part_day_minutes: 120 }) === "2 tim");
ok("samma dag", periodtext("2026-10-05", "2026-10-05") === "5 oktober 2026");
ok("samma månad", periodtext("2026-10-05", "2026-10-09") === "5–9 oktober 2026");
ok("samma år", periodtext("2026-10-28", "2026-11-03") === "28 oktober–3 november 2026");
ok("över årsskiftet", periodtext("2026-12-28", "2027-01-03") === "28 december 2026–3 januari 2027");

// -----------------------------------------------------------------------------
rubrik("E7.3: kalenderflödet läcker varken typ eller sjukdom");

const flode = ical(
  [
    { id: "abc-123", namn: "Anna Andersson", starts_on: "2026-10-05", ends_on: "2026-10-09", part_day_minutes: null },
    { id: "def-456", namn: "Bo, Bengtsson", starts_on: "2026-11-02", ends_on: "2026-11-02", part_day_minutes: 120 },
  ],
  "Ledighet — teamet",
  new Date("2026-08-20T12:00:00Z"),
);

ok("filen är ett kalenderdokument", flode.startsWith("BEGIN:VCALENDAR") && flode.trimEnd().endsWith("END:VCALENDAR"));
ok("två poster", (flode.match(/BEGIN:VEVENT/g) ?? []).length === 2);
ok("raderna avslutas med CRLF enligt RFC 5545", flode.includes("\r\n") && !/[^\r]\n/.test(flode));

// Det har ar hela sakerhetskravet, och darfor provas det som text: ordet far
// inte finnas i filen, oavsett hur den byggdes.
ok("ordet Ledig och inget annat", flode.includes("SUMMARY:Anna Andersson — Ledig"));
for (const ord of ["Semester", "Föräldraledighet", "Sjuk", "sjuk", "VAB", "Vård", "vacation", "sick", "parental"]) {
  ok(`flödet nämner aldrig "${ord}"`, !flode.includes(ord));
}

ok("komma i namnet escapas", flode.includes("SUMMARY:Bo\\, Bengtsson — Ledig"));
ok("heldagspost, inte klockslag", flode.includes("DTSTART;VALUE=DATE:20261005"));
// DTEND ar exklusiv: en ledighet till och med den 9:e slutar den 10:e.
ok("DTEND är dagen efter sista dagen", flode.includes("DTEND;VALUE=DATE:20261010"));
ok("en endagsledighet slutar dagen efter", flode.includes("DTEND;VALUE=DATE:20261103"));
ok("UID är stabil så posten inte dyker upp som ny vid varje synk", flode.includes("UID:abc-123@"));
ok("ledighet blockerar inte mötesbokning", flode.includes("TRANSP:TRANSPARENT"));
ok("flödet är enkelriktat", flode.includes("METHOD:PUBLISH") && !flode.includes("METHOD:REQUEST"));

// Ett langt namn far inte bryta formatet. Raden viks vid 75 oktetter och
// fortsattningen borjar med ett mellanslag.
const langt = ical(
  [{ id: "x", namn: "Överlångt Namnsson-Åkerström Von Bergendahl Storstrand", starts_on: "2026-10-05", ends_on: "2026-10-05", part_day_minutes: null }],
  "Ledighet",
  new Date("2026-08-20T12:00:00Z"),
);
ok(
  "långa rader viks och ingen rad överskrider 75 oktetter",
  langt.split("\r\n").every((r) => Buffer.from(r, "utf8").length <= 75),
);
ok("vikningen bevarar innehållet", langt.replace(/\r\n /g, "").includes("Överlångt Namnsson-Åkerström Von Bergendahl Storstrand — Ledig"));

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
