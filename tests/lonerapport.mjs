#!/usr/bin/env node
/**
 * E4b provas utan databas: vad som blockerar en period, och att exporten
 * lyder kolumnkonfigurationen i stallet for koden.
 *
 *   node --experimental-strip-types tests/lonerapport.mjs
 */
import {
  blockeringar,
  oppnaDagar,
  csv,
  decimaltimmar,
  faltvarde,
} from "../src/lib/lonerapport.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const h = (id, kind, dag, tid, extra = {}) => ({
  id,
  employee_id: "anna",
  kind,
  occurred_at: `2026-07-${dag}T${tid}:00:00.000+02:00`,
  source: "app",
  ...extra,
});

const personal = [
  { id: "anna", namn: "Anna Andersson" },
  { id: "bertil", namn: "Bertil Bengtsson" },
];

console.log("\n\x1b[1mÖppna dagar hittas per dag, inte per period\x1b[0m");
{
  const heldag = [h("1", "in", "01", "08"), h("2", "out", "01", "17")];
  ok("en avslutad dag är inte öppen", oppnaDagar(heldag).length === 0);

  const glomd = [h("1", "in", "01", "08")];
  ok("in utan ut är öppen", oppnaDagar(glomd).join() === "2026-07-01");

  // Tva dagar dar bara den ena ar glomd. En period far inte blockeras av fel dag.
  const bada = [...heldag, h("3", "in", "02", "08")];
  ok("bara den glömda dagen listas", oppnaDagar(bada).join() === "2026-07-02");

  const rast = [
    h("1", "in", "01", "08"),
    h("2", "break_start", "01", "12"),
    h("3", "break_end", "01", "12"),
    h("4", "out", "01", "17"),
  ];
  ok("rast mitt i dagen gör den inte öppen", oppnaDagar(rast).length === 0);

  // Modulen bedomer en fardig lista. Den som anropar har redan kort gallande()
  // — sa har kommer en godkand rattelse in som EN utstampling, inte tva.
  const rattad = [h("1", "in", "01", "08"), h("3", "out", "01", "16")];
  ok("rättad utstämpling stänger dagen", oppnaDagar(rattad).length === 0);

  // Ordningen i listan far inte avgora. Tiden gor det.
  const omkastat = [h("2", "out", "01", "17"), h("1", "in", "01", "08")];
  ok("omkastad lista ger samma svar", oppnaDagar(omkastat).length === 0);
}

console.log("\n\x1b[1mAC-2.14: spärren säger vad som blockerar\x1b[0m");
{
  const rent = blockeringar({
    personal,
    handelser: [h("1", "in", "01", "08"), h("2", "out", "01", "17")],
    vantandeRattelser: [],
    oavslutadeAvvikelser: [],
  });
  ok("en ren period blockeras inte", rent.length === 0);

  const medRattelse = blockeringar({
    personal,
    handelser: [],
    vantandeRattelser: [{ employee_id: "anna", occurred_at: "2026-07-03T17:00:00.000+02:00" }],
    oavslutadeAvvikelser: [],
  });
  ok("väntande rättelse blockerar", medRattelse.length === 1);
  ok("och namnet står i texten", medRattelse[0].text.includes("Anna Andersson"));
  ok("med rätt typ", medRattelse[0].typ === "rattelse");

  const medOppen = blockeringar({
    personal,
    handelser: [h("1", "in", "04", "08")],
    vantandeRattelser: [],
    oavslutadeAvvikelser: [],
  });
  ok("öppen dag blockerar", medOppen[0].typ === "oppen_dag");
  ok("och datumet pekas ut", medOppen[0].datum === "2026-07-04");

  const medAvvikelse = blockeringar({
    personal,
    handelser: [],
    vantandeRattelser: [],
    oavslutadeAvvikelser: [{ employee_id: "bertil", work_date: "2026-07-02", kind: "missing" }],
  });
  ok("oavslutad avvikelse blockerar", medAvvikelse[0].typ === "avvikelse");
  ok("för rätt person", medAvvikelse[0].text.includes("Bertil"));

  const allt = blockeringar({
    personal,
    handelser: [h("1", "in", "09", "08")],
    vantandeRattelser: [{ employee_id: "anna", occurred_at: "2026-07-03T17:00:00.000+02:00" }],
    oavslutadeAvvikelser: [{ employee_id: "bertil", work_date: "2026-07-02", kind: "missing" }],
  });
  ok("alla tre typerna räknas", allt.length === 3);
  ok("och listan är i datumordning", allt.map((b) => b.datum).join() === "2026-07-02,2026-07-03,2026-07-09");
}

console.log("\n\x1b[1mAC-2.17: inga belopp någonstans\x1b[0m");
{
  const rad = {
    employee_number: "42",
    name: "Anna Andersson",
    email: "anna@clicknet.se",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    worked_minutes: 9600,
    break_minutes: 600,
    adjustment_minutes: -30,
    auto_closed_days: 1,
    deviation_count: 2,
  };

  const kolumner = [
    { sort: 1, header: "Namn", field: "name", active: true },
    { sort: 2, header: "Arbetad tid (tim)", field: "worked_hours", active: true },
    { sort: 3, header: "Netto (min)", field: "net_minutes", active: true },
  ];

  const ut = csv(kolumner, [rad]);
  const rader = ut.replace("﻿", "").trim().split("\r\n");

  ok("rubriken kommer ur konfigurationen", rader[0] === "Namn;Arbetad tid (tim);Netto (min)");
  ok("timmar som decimaltal", decimaltimmar(9600) === "160.00", decimaltimmar(9600));
  ok("justeringen räknas in i netto", faltvarde(rad, "net_minutes") === "9570");
  ok("raden följer kolumnordningen", rader[1] === "Anna Andersson;160.00;9570");
  ok("filen börjar med BOM för svensk Excel", ut.startsWith("﻿"));

  const omordnat = csv(
    [
      { sort: 2, header: "Namn", field: "name", active: true },
      { sort: 1, header: "Nummer", field: "employee_number", active: true },
    ],
    [rad],
  );
  ok("sort styr ordningen, inte listan", omordnat.includes("Nummer;Namn"));

  const avslaget = csv(
    [
      { sort: 1, header: "Namn", field: "name", active: true },
      { sort: 2, header: "E-post", field: "email", active: false },
    ],
    [rad],
  );
  ok("avslagen kolumn kommer inte med", !avslaget.includes("anna@clicknet.se"));

  const semikolon = csv(
    [{ sort: 1, header: "Namn", field: "name", active: true }],
    [{ ...rad, name: 'Anna "Rally" Andersson; Chef' }],
  );
  ok("semikolon i namnet bryter inte filen",
    semikolon.includes('"Anna ""Rally"" Andersson; Chef"'));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
