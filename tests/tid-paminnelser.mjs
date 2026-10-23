#!/usr/bin/env node
/**
 * Chefens morgonnotis i Tid räknar inte ledig eller sjuk personal som
 * "har inte stämplat in" (granskningen D24).
 *
 *   TZ=UTC node --experimental-strip-types tests/tid-paminnelser.mjs
 *
 * Ingen databas och inga notiser: jobbet körs mot en attrapp som svarar per
 * tabell, och notismodulen byts mot en som bara spelar in.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

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

function attrapp({ ledighet = [], sjuk = [] }) {
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
          return { data: [], error: null };
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
  await korTidpaminnelser(attrapp({}), new Map(), NU);
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
    new Map(),
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
    new Map(),
    NU,
  );
  ok("alla frånvarande: ingen morgonnotis", morgon().length === 0, JSON.stringify(morgon()));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
