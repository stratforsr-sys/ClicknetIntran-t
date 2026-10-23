#!/usr/bin/env node
/**
 * Granskningen S10 (F1-8, F1-9): ett avslut med sista dag framåt stänger
 * inloggningen natten efter sista dagen, och checklistorna tar inga personnummer.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-anstallda-avslut.mjs
 *
 * Ingen databas: nattjobbets steg körs mot en attrapp, och `stangAnstallning`
 * byts mot en som spelar in.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const stubbar = {
  "@/lib/offboarding-server": "export async function stangAnstallning(db, aktor, id, slut) { if (id === 'kastar') throw new Error('nätfel'); globalThis.__stangda.push({ aktor, id, slut }); globalThis.__stangdaIds.add(id); return { stangda: id === 'med-arenden' ? 2 : 0, aterlamnade: 0 }; }",
  "@/lib/nav2/skrivlage": "export const SKRIVLAGE = new Proxy({}, { get: (_, k) => globalThis.__skrivlage?.[k] });",
};
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (stubbar[spec]) return { url: "data:text/javascript," + encodeURIComponent(stubbar[spec]), shortCircuit: true };
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const forma = await import("../src/lib/nav2/avslutforma.ts").catch((e) => ({ fel: e }));
rubrik("Personnummer i checklistorna (F1-9)");
ok("avslutforma.ts finns", !forma.fel, forma.fel?.code ?? "");
const har = forma.harPersonnummer ?? (() => null);
ok("ett personnummer i värdet fångas", har("Personnummer 850101-1234") === true);
ok("utan bindestreck också", har("8501011234") === true);
ok("i ett av flera fält", har("Lynes-användare", null, "ring 19850101+1234") === true);
ok("ett vanligt värde släpps igenom", har("zen@clicknet.se", "Lynes 4021", undefined) === false);

rubrik("När stängs inloggningen? (F1-8)");
const nu = forma.avslutNu ?? (() => null);
ok("sista dag i dag: nu", nu("2026-10-23", "2026-10-23") === true);
ok("sista dag i går: nu", nu("2026-10-22", "2026-10-23") === true);
ok("sista dag om en månad: inte nu", nu("2026-11-23", "2026-10-23") === false);

rubrik("Nattjobbet stänger det som passerat");
{
  const { stangPlaneradeAvslut } = await import("../src/lib/nav2/anstallda-avslut.ts");
  const personal = [
    { id: "passerad", status: "active", end_date: "2026-10-22", end_reason_by: "chef" },
    { id: "i-dag", status: "active", end_date: "2026-10-23", end_reason_by: "chef" },
    { id: "framat", status: "active", end_date: "2026-11-23", end_reason_by: "chef" },
    { id: "visstid", status: "active", end_date: "2026-10-01", end_reason_by: null },
    { id: "kastar", status: "active", end_date: "2026-10-19", end_reason_by: "chef" },
    { id: "med-arenden", status: "active", end_date: "2026-10-20", end_reason_by: "chef2" },
  ];
  const lista = new Set(["passerad", "i-dag", "framat", "med-arenden", "kastar"]);
  const skrivet = [];
  const db = {
    from(tabell) {
      const q = { tabell, filter: [], op: "select", v: null };
      const k = {
        select: () => k, update: (v) => { q.op = "update"; q.v = v; skrivet.push(q); return k; },
        eq: (a, b) => { q.filter.push(["eq", a, b]); return k; }, neq: (a, b) => { q.filter.push(["neq", a, b]); return k; },
        lt: (a, b) => { q.filter.push(["lt", a, b]); return k; }, in: (a, b) => { q.filter.push(["in", a, b]); return k; },
        not: () => k, is: () => k, maybeSingle: () => k,
        then: (res) => {
          if (q.op === "update") return Promise.resolve({ data: null, error: null }).then(res);
          if (tabell === "employee" && q.filter.some((f) => f[0] === "eq" && f[1] === "id")) { const id = q.filter.find((f) => f[1] === "id")[2]; return Promise.resolve({ data: { status: globalThis.__stangdaIds.has(id) ? "offboarded" : "active" }, error: null }).then(res); }
          if (tabell === "employee") return Promise.resolve({ data: personal.filter((p) => p.status !== "offboarded" && p.end_date && p.end_date < q.filter.find((f) => f[0] === "lt")[2]), error: null }).then(res);
          if (tabell === "offboarding_task") { const ids = q.filter.find((f) => f[0] === "in")[2]; return Promise.resolve({ data: ids.filter((i) => lista.has(i)).map((employee_id) => ({ employee_id })), error: null }).then(res); }
          return Promise.resolve({ data: [], error: null }).then(res);
        },
      };
      return k;
    },
  };
  globalThis.__skrivlage = { anstallda: false };
  globalThis.__stangda = [];
  globalThis.__stangdaIds = new Set();
  const u = await stangPlaneradeAvslut(db, "2026-10-23");
  const ids = globalThis.__stangda.map((x) => x.id).sort();
  ok("den vars sista dag passerat stängs, med den som avslutade som aktör", ids.includes("passerad") && globalThis.__stangda.find((x) => x.id === "passerad").aktor === "chef");
  ok("sista dag i dag stängs inte förrän i natt", !ids.includes("i-dag"));
  ok("framåt stängs inte", !ids.includes("framat"));
  ok("en visstid utan avslutslista rörs aldrig", !ids.includes("visstid"), ids.join(","));
  ok("slutdatumet följer med", globalThis.__stangda.find((x) => x.id === "passerad").slut === "2026-10-22");
  ok("kontopunkten bockas", skrivet.some((q) => q.tabell === "offboarding_task" && q.v.state === "done" && q.filter.some((f) => f[1] === "kind" && f[2] === "konto")));
  ok("stängda ärenden står på ärendepunkten", skrivet.some((q) => q.tabell === "offboarding_task" && /2 öppet personalärenden stängdes/.test(q.v.note ?? "")));
  ok("ett registrerat avslut stängs också när Anställda står i läsläge", ids.includes("passerad"));
  ok("ett kast för en person stoppar inte de andra", ids.includes("med-arenden") && u.fel.some((f) => /kastar: nätfel/.test(f)), JSON.stringify(u));
  ok("utfallet räknar två", u.stangda === 2, JSON.stringify(u));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
