#!/usr/bin/env node
/**
 * Sen ankomst provas utan databas. Varje regel at bada hallen: inte bara att
 * forseningen upptacks, utan att den INTE upptacks nar personen var i tid.
 *
 *   node --experimental-strip-types tests/narvaro.mjs
 */
import { senAnkomst, forsening, minutOnDagen } from "../src/lib/narvaro.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// Lokal tid, sa att provet betyder samma sak som produktionen gor.
const in_ = (tid) => ({ kind: "in", occurred_at: `2026-08-18T${tid}:00` });
const ut = (tid) => ({ kind: "out", occurred_at: `2026-08-18T${tid}:00` });

const schema = { start_time: "08:00:00", tol_late: 1, schedule_id: "s1" };

console.log("\n\x1b[1mGränsen går vid toleransen, inte före\x1b[0m");
{
  ok("i tid på minuten", senAnkomst([in_("08:00")], schema) === null);
  ok("före tiden", senAnkomst([in_("07:52")], schema) === null);

  // Toleransen laggs TILL gransen. 08:01 med en minuts tolerans ar i tid.
  ok("exakt på toleransen är i tid", senAnkomst([in_("08:01")], schema) === null);

  const sen = senAnkomst([in_("08:02")], schema);
  ok("en minut efter toleransen är sen", sen !== null);
  ok("och förseningen räknas från schemat, inte från toleransen",
    sen.minuter === 2, String(sen?.minuter));
  ok("schemat som dömde följer med", sen.schedule_id === "s1");
}

console.log("\n\x1b[1mDagens första instämpling avgör\x1b[0m");
{
  // Den som stampar ut och in igen mitt pa dagen kommer inte for sent en
  // andra gang.
  const dag = [in_("07:58"), ut("12:00"), in_("12:45")];
  ok("återkomst efter lunch räknas inte som sen ankomst", senAnkomst(dag, schema) === null);

  const senSedanUt = [in_("09:30"), ut("12:00"), in_("12:30")];
  ok("men den första gången räknas", senAnkomst(senSedanUt, schema)?.minuter === 90);

  // Ordningen i listan far inte avgora. Tiden gor det.
  ok("omkastad lista ger samma svar",
    senAnkomst([ut("12:00"), in_("09:30")], schema)?.minuter === 90);
}

console.log("\n\x1b[1mDet som inte går att veta gissas inte\x1b[0m");
{
  ok("utan schema ingen bedömning", senAnkomst([in_("11:00")], null) === null);
  ok("utan instämpling ingen bedömning", senAnkomst([ut("17:00")], schema) === null);
  ok("tom dag ger ingenting", senAnkomst([], schema) === null);
}

console.log("\n\x1b[1mToleransen är per schema\x1b[0m");
{
  const slappt = { start_time: "08:00", tol_late: 15 };
  ok("kvartens tolerans släpper igenom 08:12", senAnkomst([in_("08:12")], slappt) === null);
  ok("men inte 08:20", senAnkomst([in_("08:20")], slappt)?.minuter === 20);

  const sen = { start_time: "13:30", tol_late: 1 };
  ok("eftermiddagsschema fungerar likadant", senAnkomst([in_("13:35")], sen)?.minuter === 5);
  ok("minuter sedan midnatt", minutOnDagen("13:30") === 810);
}

console.log("\n\x1b[1mSpråket\x1b[0m");
{
  ok("under en timme", forsening(12) === "12 min");
  ok("jämn timme", forsening(60) === "1 h");
  ok("timme och minuter", forsening(95) === "1 h 35 min");
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
