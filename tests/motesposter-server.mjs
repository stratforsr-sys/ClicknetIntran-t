#!/usr/bin/env node
/**
 * Mötesposternas läsning (Möten, uppgift 7): vyerna får aldrig kasta, stängningen måste.
 *
 *   TZ=UTC node --experimental-strip-types tests/motesposter-server.mjs
 *
 * `hamtaMotesposter` läses av byggProvision (en Promise.all utan catch som bygger hela /nav2) och av /provision.
 * Ett enda övergående läsfel fick därför ned alla vyer, medan grannen `hamtaChefsposter` ger []. Nu:
 *
 *   - UTAN klient (vyerna): ett läsfel loggas och ger [], aldrig ett kast.
 *   - MED klient (faststallPeriod): samma fel kastas. En månad som fastställs utan sina mötesrader betalar för lite.
 *
 * motesposter-server.ts bär `import "server-only"` och `@/`-vägar. Kroken nedan släpper in den utan Next, och
 * `@/lib/supabase/server` och `@/lib/auth` ersätts av attrapper. Ingen databas: klienterna är attrapper vars
 * frågor svarar per tabell.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
globalThis.__attrapper = { server: null, admin: null };
const stubb = (kod) => ({ url: "data:text/javascript," + encodeURIComponent(kod), shortCircuit: true });
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec === "@/lib/supabase/server") return stubb("export const supabaseServer = async () => globalThis.__attrapper.server; export const supabaseAdmin = () => globalThis.__attrapper.admin;");
    if (spec === "@/lib/auth") return stubb("export const fullName = (e) => `${e.first_name} ${e.last_name}`.trim();");
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

const { hamtaMotesposter } = await import("../src/lib/motesposter-server.ts");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// En attrapp vars frågekedja går att `await`:a. `svar(tabell)` ger {data, error} för tabellen.
function klient(svar) {
  const frågor = [];
  return {
    frågor,
    from(tabell) {
      frågor.push(tabell);
      const kedja = new Proxy({}, {
        get(_, namn) {
          if (namn === "then") return (ok_, nej) => Promise.resolve(svar(tabell)).then(ok_, nej);
          return () => kedja;
        },
      });
      return kedja;
    },
  };
}
const M1 = "11111111-1111-4111-8111-111111111111";
const fungerande = (extra = {}) => (tabell) => {
  if (extra[tabell]) return extra[tabell];
  const d = {
    nav_setting: [{ key: "moten.tidszon", value: "Europe/Stockholm" }],
    mote_provision: [{ mote_id: M1, employee_id: "e1", belopp: "600.00", niva: "kvalificerat", delat_med: null, manad: "2026-11-01" }],
    mote: [{ id: M1, kedja_id: "k1", mote_tid: "2026-11-11T09:00:00Z", halls_av: "e2", niva_svar: null }],
    mote_kedja: [{ id: "k1", bolag_id: "b1" }],
    mote_bolag: [{ id: "b1", namn: "Ekholm Transport" }],
    employee: [{ id: "e2", first_name: "Sara", last_name: "Lind" }],
  }[tabell] ?? [];
  return { data: d, error: null };
};
const trasig = { data: null, error: { message: "canceling statement due to statement timeout" } };

// Loggen fångas så att provet kan se att felet loggades och inte sväljs tyst.
const logg = [];
const orig = console.error;
console.error = (...a) => { logg.push(a.join(" ")); };
const tyst = async (f) => { logg.length = 0; try { return await f(); } finally { /* loggen läses av anroparen */ } };

rubrik("Vyerna (ingen klient): ett läsfel ger [] och loggas, kastar aldrig");
{
  globalThis.__attrapper = { server: klient(() => trasig), admin: klient(fungerande()) };
  let kastade = null, ut;
  try { ut = await tyst(() => hamtaMotesposter("2026-11-01")); } catch (e) { kastade = e; }
  ok("kastar inte", kastade === null, String(kastade?.message ?? ""));
  ok("ger tom lista", Array.isArray(ut) && ut.length === 0);
  ok("felet loggas, med orsaken", logg.length === 1 && /motesposter/.test(logg[0]) && /statement timeout/.test(logg[0]), logg.join(" | "));

  // Felet i berikningen (bolagsnamn m.m. läses med service role) är också ett läsfel.
  globalThis.__attrapper = { server: klient(fungerande()), admin: klient(fungerande({ mote: trasig })) };
  kastade = null;
  try { ut = await tyst(() => hamtaMotesposter("2026-11-01")); } catch (e) { kastade = e; }
  ok("fel i berikningen: kastar inte och ger []", kastade === null && Array.isArray(ut) && ut.length === 0 && logg.length === 1, logg.join(" | "));

  // Att skapa klienten kan också fela (cookies, token).
  globalThis.__attrapper = { server: null, admin: klient(fungerande()) };
  Object.defineProperty(globalThis.__attrapper, "server", { get() { throw new Error("ingen session"); } });
  kastade = null;
  try { ut = await tyst(() => hamtaMotesposter("2026-11-01")); } catch (e) { kastade = e; }
  ok("fel när klienten skapas: kastar inte", kastade === null && ut?.length === 0);
}

rubrik("Stängningen (klient skickad): samma fel kastas");
{
  globalThis.__attrapper = { server: null, admin: klient(fungerande()) };
  let kastade = null;
  try { await tyst(() => hamtaMotesposter("2026-11-01", klient(() => trasig))); } catch (e) { kastade = e; }
  ok("ett läsfel i mote_provision kastas", kastade !== null && /Mötesprovisionen kunde inte läsas/.test(kastade.message) && /statement timeout/.test(kastade.message), String(kastade?.message ?? "ingen kastades"));
  ok("och loggas inte bort som ett lyckat tomt svar", logg.length === 0);

  globalThis.__attrapper = { server: null, admin: klient(fungerande({ mote_bolag: trasig })) };
  kastade = null;
  try { await tyst(() => hamtaMotesposter("2026-11-01", klient(fungerande()))); } catch (e) { kastade = e; }
  ok("ett läsfel i berikningen kastas också", kastade !== null, String(kastade?.message ?? "ingen kastades"));
}

rubrik("Friska läsningar: samma rader åt båda hållen");
{
  globalThis.__attrapper = { server: klient(fungerande()), admin: klient(fungerande()) };
  const vy = await tyst(() => hamtaMotesposter("2026-11-01"));
  const stang = await tyst(() => hamtaMotesposter("2026-11-01", klient(fungerande())));
  const vantat = [{ mote_id: M1, employee_id: "e1", manad: "2026-11-01", belopp: 600, niva: "kvalificerat", bolag: "Ekholm Transport", dag: "2026-11-11", delat_med_namn: null }];
  ok("vyn: en mötespost med bolag, dag och belopp som tal", JSON.stringify(vy) === JSON.stringify(vantat), JSON.stringify(vy));
  ok("stängningen: samma post", JSON.stringify(stang) === JSON.stringify(vantat));
  ok("inget loggades", logg.length === 0, logg.join(" | "));
}

console.error = orig;
console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
