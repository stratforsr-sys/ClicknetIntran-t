#!/usr/bin/env node
/**
 * Chefens morgonnotis i Tid räknar inte ledig eller sjuk personal som
 * "har inte stämplat in" (granskningen D24), och ingen påminns om att stämpla
 * (beställaren 2026-11-01: "skippa påminnelse om stämpling helt och hållet").
 *
 *   TZ=UTC node --experimental-strip-types tests/tid-paminnelser.mjs
 *
 * Ingen databas och inga notiser: jobbet körs mot en attrapp som svarar per
 * tabell, och notismodulen byts mot en som bara spelar in.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const notisStubbe = `
export const skickat = globalThis.__skickat = [];
export async function medRoll() { return ["chef"]; }
export async function notifiera(h) { skickat.push(h); return true; }
export async function notifieraFlera(till, h) { for (const t of till) skickat.push({ ...h, till: t }); return till.length; }
`;
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec === "@/lib/notishandelse-server") return { url: "data:text/javascript," + encodeURIComponent(notisStubbe), shortCircuit: true };
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

const { korTidpaminnelser } = await import("../src/lib/nav2/tid-paminnelser.ts");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// Måndag 26 oktober 2026 09:00 svensk tid (vintertid, 08:00Z). Schemat börjar 08:00.
const NU = new Date("2026-10-26T08:00:00.000Z");
const IDAG = "2026-10-26";

function attrapp({ ledighet = [], sjuk = [], stamplar = [] }) {
  const personal = ["anna", "bo", "cia", "dan"].map((id) => ({ id, team_id: "t1", status: "active" }));
  const db = {
    from(tabell) {
      const steg = [];
      const svar = () => {
        const v = (n) => steg.find(([s]) => s === n);
        if (tabell === "employee") return { data: personal, error: null };
        if (tabell === "work_schedule") return { data: [{ id: "s1", scope: "company", employee_id: null, team_id: null, weekday: 1, start_time: "08:00:00", end_time: "17:00:00", valid_from: "2026-01-01" }], error: null };
        if (tabell === "time_event") {
          if (v("select")?.[2]?.head) return { count: 0, data: null, error: null };
          return { data: stamplar, error: null };
        }
        if (tabell === "attendance_incident") return { count: 0, data: null, error: null };
        if (tabell === "absence_request") {
          // Svara som databasen: bara beviljade som täcker idag.
          const status = v("eq")?.[2];
          return { data: ledighet.filter((r) => (!status || r.status === status) && r.starts_on <= IDAG && r.ends_on >= IDAG), error: null };
        }
        if (tabell === "sick_report") return { data: sjuk.filter((r) => !r.cancelled_at && r.first_sick_day <= IDAG), error: null };
        return { data: [], error: null };
      };
      const p = new Proxy({}, {
        get(_, namn) {
          if (namn === "then") return (res, rej) => Promise.resolve(svar()).then(res, rej);
          return (...a) => { steg.push([namn, ...a]); return p; };
        },
      });
      return p;
    },
  };
  return db;
}

const morgon = () => globalThis.__skickat.filter((h) => h.kalla === "tid-chef-morgon");

console.log("\n\x1b[1mMorgonnotisen: ledig och sjuk räknas inte som ej instämplade\x1b[0m");
{
  globalThis.__skickat.length = 0;
  await korTidpaminnelser(attrapp({}), NU);
  const m = morgon();
  ok("utan frånvaro: fyra har inte stämplat in", m.length === 1 && m[0].detalj === "4 har inte stämplat in", m[0]?.detalj);
}
{
  globalThis.__skickat.length = 0;
  await korTidpaminnelser(
    attrapp({
      ledighet: [
        { employee_id: "anna", status: "approved", starts_on: "2026-10-26", ends_on: "2026-10-30" },
        { employee_id: "dan", status: "submitted", starts_on: "2026-10-26", ends_on: "2026-10-26" },
      ],
      sjuk: [
        { employee_id: "bo", first_sick_day: "2026-10-23", last_sick_day: null, cancelled_at: null },
        { employee_id: "cia", first_sick_day: "2026-10-20", last_sick_day: "2026-10-23", cancelled_at: null },
      ],
    }),
    NU,
  );
  const m = morgon();
  // anna ledig (beviljad), bo sjuk utan slutdag. cia friskanmäld i fredags, dan bara ansökt.
  ok("beviljad ledighet och pågående sjukdom räknas bort: två kvar", m.length === 1 && m[0].detalj === "2 har inte stämplat in", m[0]?.detalj);
}
{
  globalThis.__skickat.length = 0;
  await korTidpaminnelser(
    attrapp({
      ledighet: ["anna", "bo"].map((employee_id) => ({ employee_id, status: "approved", starts_on: "2026-10-26", ends_on: "2026-10-26" })),
      sjuk: ["cia", "dan"].map((employee_id) => ({ employee_id, first_sick_day: "2026-10-26", last_sick_day: "2026-10-26", cancelled_at: null })),
    }),
    NU,
  );
  ok("alla frånvarande: ingen morgonnotis", morgon().length === 0, JSON.stringify(morgon()));
}

console.log("\n\x1b[1mIngen påminnelse om att stämpla\x1b[0m");
{
  // Anna stämplade in 08:00 och är kvar 17:30; schemat slutade 17:00. Förut fick
  // den som slagit på det "Du är fortfarande instämplad" efter femton minuter.
  globalThis.__skickat.length = 0;
  const kvall = new Date("2026-10-26T16:30:00.000Z");
  await korTidpaminnelser(attrapp({ stamplar: [{ id: "e1", employee_id: "anna", kind: "in", occurred_at: "2026-10-26T07:00:00.000Z", source: "web", supersedes_id: null, correction_state: null }] }), kvall);
  const till = globalThis.__skickat.filter((h) => h.till !== "chef");
  ok("ingen notis till den som är kvar efter schemat", till.length === 0, JSON.stringify(till));
  ok("ingen tid-paminnelse-ut", !globalThis.__skickat.some((h) => h.kalla === "tid-paminnelse-ut"));
}
{
  // 09:15, ingen har stämplat in: ingen får "Du har inte stämplat in".
  globalThis.__skickat.length = 0;
  await korTidpaminnelser(attrapp({}), new Date("2026-10-26T08:15:00.000Z"));
  ok("ingen påminnelse till den som inte stämplat in", !globalThis.__skickat.some((h) => h.till !== "chef"), JSON.stringify(globalThis.__skickat));
}
{
  // Repots jobb som skrev "Du har inte stämplat in" är borttaget, och ingen
  // annan fil skriver den raden. Chefens egen fråga ("Är allt okej?") är kvar.
  ok("src/lib/jobb/dagtid.ts finns inte längre", !existsSync(join(rot, "src/lib/jobb/dagtid.ts")));
  const rutt = readFileSync(join(rot, "src/app/api/jobb/dagtid/route.ts"), "utf8");
  ok("dagtidsjobbet anropar inte korDagtidsjobbet", !/korDagtidsjobbet|egnaPaminnelser/.test(rutt));
  const traffar = [];
  const ga = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) ga(p); else if (/\.(ts|tsx)$/.test(f) && /rubrik:\s*"Du har inte stämplat in"|kalla:\s*"tid-paminnelse-ut"/.test(readFileSync(p, "utf8"))) traffar.push(p.slice(rot.length + 1)); } };
  ga(join(rot, "src"));
  ok("ingen fil skriver en påminnelse om att stämpla", traffar.length === 0, traffar.join(", "));
  const html = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");
  ok("Tid visar inte kortet Påminn mig", !/\$\{t\.stamplar \? ndTidPaminnelser\(\) : ''\}/.test(html));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
