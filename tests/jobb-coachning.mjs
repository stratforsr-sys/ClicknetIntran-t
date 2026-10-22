#!/usr/bin/env node
/**
 * Coachningsjobbet lagger ingen uppdammd ko (granskningen H7).
 *
 *   TZ=UTC node --experimental-strip-types tests/jobb-coachning.mjs
 *
 * Nattjobbet lagger ett arende till chefen nar en coachningsuppgift ar 14
 * dagar over fristen. Pa main har steget tyst misslyckats, sa forsta natten
 * efter mergen hade allt sedan dess blivit arenden pa en gang. Och lastes
 * handelserna kapade (taket pa 1000 rader, en lang `in`-lista) blev avslutade
 * uppgifter "N dagar over fristen". Darfor:
 *
 *   - bara frister som passerades for 14 till 44 dagar sedan. Varje ny
 *     forsening passerar fonstret en gang, kon fran fore mergen aldrig.
 *   - handelserna lases i omgangar om hogst 100 uppgifter, och felar en
 *     omgang laggs inget arende alls.
 *
 * jobb/coachning.ts bar `import "server-only"` och `@/`-vagar. Kroken nedan
 * later node ladda den utan Next. Ingen databas: jobbet kors mot en
 * inspelande attrapp.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

const { inomFonstret, korCoachningsjobbet } = await import("../src/lib/jobb/coachning.ts");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const dagFore = (idag, n) => new Date(Date.parse(idag + "T12:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
const IDAG = "2026-10-26";

rubrik("inomFonstret");
ok("finns", typeof inomFonstret === "function");
const f = (n) => (typeof inomFonstret === "function" ? inomFonstret(dagFore(IDAG, n), IDAG) : undefined);
ok("20 dagar över fristen: sant", f(20) === true);
ok("50 dagar över fristen: falskt", f(50) === false);
ok("10 dagar över fristen: falskt", f(10) === false);
ok("14 dagar: sant, samma gräns som förut", f(14) === true);
ok("13 dagar: falskt", f(13) === false);
ok("44 dagar: sant, 45: falskt", f(44) === true && f(45) === false);
ok("över månadsskiftet", inomFonstret?.("2026-02-20", "2026-03-10") === true);

// En attrapp som spelar in kedjan och svarar per tabell.
function attrapp({ uppgifter, handelser = [], felIOmgang = -1 }) {
  const logg = [];
  let omgang = 0;
  const db = {
    from(tabell) {
      const kedja = { tabell, steg: [] };
      logg.push(kedja);
      const svar = () => {
        const forst = kedja.steg[0]?.[0];
        if (forst !== "select") return { data: forst === "insert" ? { id: "nytt" } : null, error: null };
        if (tabell === "coaching_task") return { data: uppgifter, error: null };
        if (tabell === "coaching_task_event") {
          const ids = kedja.steg.find(([n]) => n === "in")?.[2] ?? [];
          const nr = omgang++;
          if (nr === felIOmgang) return { data: null, error: { message: "läsfel i omgång " + nr } };
          return { data: handelser.filter((h) => ids.includes(h.task_id)), error: null };
        }
        if (tabell === "employee") return { data: uppgifter.map((u) => ({ id: u.assignee_id, first_name: "P", last_name: u.assignee_id, status: "active", manager_id: "chef" })), error: null };
        if (tabell === "employee_role") return { data: [], error: null };
        if (tabell === "case_category") return { data: { sla_hours: 72 }, error: null };
        if (tabell === "hr_case") return { data: null, error: null };
        return { data: [], error: null };
      };
      const p = new Proxy({}, {
        get(_, namn) {
          if (namn === "then") return (res, rej) => Promise.resolve(svar()).then(res, rej);
          return (...a) => { kedja.steg.push([namn, ...a]); return p; };
        },
      });
      return p;
    },
  };
  return { db, logg };
}

const uppgift = (i, dagarOver) => ({ id: `u${i}`, title: `Uppgift ${i}`, kind: "uppgift", assignee_id: `p${i}`, created_by: "chef", due_date: dagFore(IDAG, dagarOver) });
const nu = new Date(IDAG + "T02:30:00Z");

rubrik("Frågan har fönstret");
{
  const { db, logg } = attrapp({ uppgifter: [uppgift(1, 20)] });
  await korCoachningsjobbet(db, nu);
  const q = logg.find((k) => k.tabell === "coaching_task");
  ok("övre gräns: fristen för minst 14 dagar sedan", q?.steg.some(([n, k, v]) => n === "lte" && k === "due_date" && v === dagFore(IDAG, 14)), JSON.stringify(q?.steg));
  ok("nedre gräns: fristen för högst 44 dagar sedan", q?.steg.some(([n, k, v]) => n === "gte" && k === "due_date" && v === dagFore(IDAG, 44)));
}

rubrik("Uppgifter utanför fönstret blir inga ärenden, också om frågan ger dem");
{
  const { db, logg } = attrapp({ uppgifter: [uppgift(1, 20), uppgift(2, 120)] });
  const r = await korCoachningsjobbet(db, nu);
  const nya = logg.filter((k) => k.tabell === "hr_case" && k.steg[0][0] === "insert");
  ok("ett ärende, för uppgiften 20 dagar över", nya.length === 1 && String(nya[0].steg[0][1].subject).includes("coachning:u1"), JSON.stringify(r));
}

rubrik("Händelserna läses i omgångar om högst 100");
{
  const uppg = Array.from({ length: 250 }, (_, i) => uppgift(i, 20));
  // Alla klara: inga ärenden ska läggas.
  const handelser = uppg.map((u) => ({ task_id: u.id, type: "kvitterad", at: "2026-10-01T10:00:00Z" }));
  const { db, logg } = attrapp({ uppgifter: uppg, handelser });
  const r = await korCoachningsjobbet(db, nu);
  const omg = logg.filter((k) => k.tabell === "coaching_task_event");
  ok("tre omgångar för 250 uppgifter", omg.length === 3, String(omg.length));
  ok("ingen omgång över 100 id", omg.every((k) => (k.steg.find(([n]) => n === "in")?.[2] ?? []).length <= 100));
  ok("alla 250 id läses", omg.reduce((s, k) => s + (k.steg.find(([n]) => n === "in")?.[2] ?? []).length, 0) === 250);
  ok("klara uppgifter blir inga ärenden", logg.filter((k) => k.tabell === "hr_case" && k.steg[0][0] === "insert").length === 0, JSON.stringify(r));
}

rubrik("En omgång som felar: inget ärende, och steget felar");
{
  const uppg = Array.from({ length: 150 }, (_, i) => uppgift(i, 20));
  const { db, logg } = attrapp({ uppgifter: uppg, felIOmgang: 1 });
  let kastat = null;
  try { await korCoachningsjobbet(db, nu); } catch (e) { kastat = e; }
  ok("steget felar, så att nattens kvitto visar det", kastat instanceof Error && /läsfel/.test(kastat.message), String(kastat));
  ok("inget ärende lades", logg.filter((k) => k.tabell === "hr_case" && k.steg[0][0] === "insert").length === 0);
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
