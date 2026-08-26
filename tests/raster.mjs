#!/usr/bin/env node
/**
 * Avvikelsemotorn. Den har filen avgor om en manniska gjorde fel, sa varje
 * regel provas at bada hallen — inte bara att avvikelsen upptacks, utan att
 * den INTE upptacks nar personen foljde reglerna.
 *
 *   node --experimental-strip-types tests/raster.mjs
 */
import { avvikelser, tagnaRaster, langstaPass, gallandeSchema, schemalage, minuterFranTid } from "../src/lib/raster.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const h = (id, kind, tid) => ({ id, kind, occurred_at: `2026-08-17T${tid}:00.000+02:00`, source: "app" });
const schema = (over = {}) => [{
  id: "s1", sort: 1, window_start: "11:30", window_end: "13:00",
  duration_minutes: 30, tol_early_start: 5, tol_overrun: 5, tol_missing: 5, ...over,
}];
const typer = (a) => a.map((x) => x.kind).sort().join(",");

console.log("\n\x1b[1mUtan schema bedöms ingenting\x1b[0m");
{
  const dag = [h("1","in","08:00"), h("2","break_start","09:00"), h("3","break_end","11:00"), h("4","out","17:00")];
  ok("två timmars rast utan schema ger noll avvikelser", avvikelser(dag, []).length === 0);
}

console.log("\n\x1b[1mRast i tid och lagom lång\x1b[0m");
{
  const dag = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","break_end","12:30"), h("4","out","17:00")];
  ok("ger ingen avvikelse", avvikelser(dag, schema()).length === 0, typer(avvikelser(dag, schema())));
}

console.log("\n\x1b[1mFör tidig rast (early_start)\x1b[0m");
{
  const tidig = [h("1","in","08:00"), h("2","break_start","11:00"), h("3","break_end","11:30"), h("4","out","17:00")];
  const a = avvikelser(tidig, schema());
  ok("30 min för tidigt fångas", typer(a) === "early_start", typer(a));
  ok("och mäts i minuter", a[0]?.minutes === 30, String(a[0]?.minutes));
  ok("schemat den dömdes mot följer med", a[0]?.schedule_id === "s1");

  const inomTolerans = [h("1","in","08:00"), h("2","break_start","11:27"), h("3","break_end","11:57"), h("4","out","17:00")];
  ok("tre minuter för tidigt ryms i toleransen", avvikelser(inomTolerans, schema()).length === 0);
}

console.log("\n\x1b[1mFör lång rast (overrun)\x1b[0m");
{
  const lang = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","break_end","12:50"), h("4","out","17:00")];
  const a = avvikelser(lang, schema());
  ok("50 minuter mot schemalagda 30 fångas", typer(a) === "overrun", typer(a));
  ok("och övertrasseringen är 20 minuter", a[0]?.minutes === 20, String(a[0]?.minutes));

  const nastan = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","break_end","12:34"), h("4","out","17:00")];
  ok("fyra minuter över ryms i toleransen", avvikelser(nastan, schema()).length === 0);
}

console.log("\n\x1b[1mSen rast ger ingen avvikelse (AC-2.25)\x1b[0m");
{
  const sen = [h("1","in","08:00"), h("2","break_start","14:30"), h("3","break_end","15:00"), h("4","out","17:00")];
  ok("rast efter önskad senaste starttid är tillåten", avvikelser(sen, schema()).length === 0,
     typer(avvikelser(sen, schema())));
}

console.log("\n\x1b[1mUtebliven rast (missing)\x1b[0m");
{
  const langtPass = [h("1","in","08:00"), h("2","out","14:00")];
  const a = avvikelser(langtPass, schema());
  ok("sex timmar utan rast fångas", typer(a) === "missing", typer(a));

  const jamnt = [h("1","in","08:00"), h("2","out","13:00")];
  ok("exakt fem timmar är ingen avvikelse", avvikelser(jamnt, schema()).length === 0);

  const straxOver = [h("1","in","08:00"), h("2","out","13:04")];
  ok("fyra minuter över fem timmar ryms i toleransen", avvikelser(straxOver, schema()).length === 0);
}

console.log("\n\x1b[1mExtra rast (unscheduled)\x1b[0m");
{
  const tva = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","break_end","12:30"),
               h("4","break_start","15:00"), h("5","break_end","15:15"), h("6","out","17:00")];
  const a = avvikelser(tva, schema());
  ok("andra rasten utan schemarad fångas", a.some((x) => x.kind === "unscheduled"), typer(a));

  const tvaSchemalagda = [...schema(), { id: "s2", sort: 2, window_start: "14:30", window_end: "15:30",
    duration_minutes: 15, tol_early_start: 5, tol_overrun: 5, tol_missing: 5 }];
  ok("med två schemalagda raster är den inte extra", avvikelser(tva, tvaSchemalagda).length === 0,
     typer(avvikelser(tva, tvaSchemalagda)));
}

console.log("\n\x1b[1mRasterna som togs\x1b[0m");
{
  const dag = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","break_end","12:30"), h("4","out","17:00")];
  ok("ett par hittas", tagnaRaster(dag).length === 1);
  const glomt = [h("1","in","08:00"), h("2","break_start","12:00"), h("3","out","17:00")];
  ok("rast som aldrig avslutades stängs vid utstämpling", tagnaRaster(glomt)[0].slut !== null);
  ok("längsta passet räknas rätt", langstaPass(dag) === 270, String(langstaPass(dag)));
}

console.log("\n\x1b[1mVilket schema som gäller\x1b[0m");
{
  const rader = [
    { scope: "company",  employee_id: null, team_id: null, valid_from: "2026-01-01", sort: 1 },
    { scope: "team",     employee_id: null, team_id: "t1", valid_from: "2026-02-01", sort: 1 },
    { scope: "employee", employee_id: "e1", team_id: null, valid_from: "2026-03-01", sort: 1 },
  ];
  ok("personens eget slår team och bolag",
    gallandeSchema(rader, "e1", "t1", "2026-08-17")[0].scope === "employee");
  ok("teamets slår bolagets",
    gallandeSchema(rader, "e2", "t1", "2026-08-17")[0].scope === "team");
  ok("bolagets gäller den utan team",
    gallandeSchema(rader, "e2", null, "2026-08-17")[0].scope === "company");

  // AC-2.35: ett schema som inte tratt i kraft an far inte doma en dag som varit.
  ok("schema som börjar senare gäller inte bakåt",
    gallandeSchema(rader, "e1", "t1", "2026-02-15")[0].scope === "team");

  const tvaVersioner = [
    { scope: "company", employee_id: null, team_id: null, valid_from: "2026-01-01", sort: 1 },
    { scope: "company", employee_id: null, team_id: null, valid_from: "2026-06-01", sort: 1 },
  ];
  ok("senaste versionen vinner inom samma nivå",
    gallandeSchema(tvaVersioner, "e1", null, "2026-08-17")[0].valid_from === "2026-06-01");
  ok("men inte för en dag före den trädde i kraft",
    gallandeSchema(tvaVersioner, "e1", null, "2026-03-01")[0].valid_from === "2026-01-01");
}

console.log("\n\x1b[1mVilken rad som galler nu, och vilka som ar historik\x1b[0m");
{
  // AC-2.35: ett schema andras aldrig, det ersatts. Listan pa /tid/schema bar
  // darfor historiken ocksa, och utan markningen ser en ersatt rad exakt ut som
  // den som galler. Den som satter rasterna hade da lagt till en rad till.
  const rad = (over) => ({
    scope: "company", employee_id: null, team_id: null, weekday: 1, sort: 1, ...over,
  });

  const gammalRad = rad({ valid_from: "2026-01-01" });
  const nyRad     = rad({ valid_from: "2026-06-01" });
  const framtida  = rad({ valid_from: "2026-12-01" });
  const annanDag  = rad({ weekday: 2, valid_from: "2026-01-01" });
  const annanRast = rad({ sort: 2, valid_from: "2026-01-01" });
  const person    = rad({ scope: "employee", employee_id: "e1", valid_from: "2026-01-01" });

  const lage = schemalage([gammalRad, nyRad, framtida, annanDag, annanRast, person], "2026-08-26");

  ok("senaste ikrafttradda raden galler", lage.get(nyRad) === "galler".replace("galler","gäller"));
  ok("den den ersatte ar historik", lage.get(gammalRad) === "ersatt");
  ok("en rad med framtida datum galler INTE an", lage.get(framtida) === "kommande",
    "annars ser en inplanerad andring ut som om den redan gallde");

  // Grupperingen ar (niva, vem, veckodag, rast nummer). Tva rader som inte ar
  // samma regel far inte konkurrera ut varandra.
  ok("en annan veckodag ar en egen regel", lage.get(annanDag) === "gäller");
  ok("rast nummer 2 ar en egen regel", lage.get(annanRast) === "gäller");
  ok("ett personschema konkurrerar inte med bolagets", lage.get(person) === "gäller",
    "de galler var sin krets — vem som slar vem ar gallandeSchema:s fraga");

  const tom = schemalage([], "2026-08-26");
  ok("tom lista ger tom karta", tom.size === 0);

  // Randen: en rad som trader i kraft I DAG galler i dag.
  const idag = rad({ valid_from: "2026-08-26" });
  ok("en rad som trader i kraft i dag galler i dag",
    schemalage([idag], "2026-08-26").get(idag) === "gäller");
}

console.log("\n\x1b[1mTidsuppslag\x1b[0m");
ok("11:30 blir 690 minuter", minuterFranTid("11:30") === 690);
ok("sekunder stör inte", minuterFranTid("11:30:00") === 690);

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
