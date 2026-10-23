#!/usr/bin/env node
/**
 * Granskningen S10 (F1-11): en borttagen profilbild ligger inte kvar.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-profil-bild.mjs
 *
 * Ångra efter "Ta bort" eller ett byte gäller i tio minuter. Därefter tar
 * nattjobbet bort den förra bilden (`previous`). Ingen databas: en attrapp.
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

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const r = await import("../src/lib/nav2/profilbild.ts").catch((e) => ({ fel: e }));
rubrik("Ångra gäller i tio minuter");
ok("profilbild.ts finns", !r.fel, r.fel?.code ?? "");
const g = r.angraGaller ?? (() => null);
const nu = new Date("2026-10-23T12:00:00Z");
ok("för en minut sedan: ja", g("2026-10-23T11:59:00Z", nu) === true);
ok("för elva minuter sedan: nej", g("2026-10-23T11:49:00Z", nu) === false);
ok("utan tid: nej", g(null, nu) === false);

rubrik("Nattjobbet tar bort förra bilden");
{
  const steg = [];
  const db = { from(t) { const q = { t, v: null, f: [] }; steg.push(q); const k = { update: (v) => { q.v = v; return k; }, not: (a, b, c) => { q.f.push(["not", a, b, c]); return k; }, lt: (a, b) => { q.f.push(["lt", a, b]); return k; }, select: () => k, then: (res) => Promise.resolve({ data: [{ employee_id: "x" }], error: null }).then(res) }; return k; } };
  const n = await (r.rensaForraBilder ?? (async () => -1))(db, nu);
  const q = steg[0];
  ok("previous sätts till null", q?.t === "employee_photo" && q.v && q.v.previous === null, JSON.stringify(q));
  ok("bara där previous finns", q?.f.some((f) => f[0] === "not" && f[1] === "previous"));
  ok("bara äldre än tio minuter", q?.f.some((f) => f[0] === "lt" && f[1] === "updated_at" && f[2] === "2026-10-23T11:50:00.000Z"), JSON.stringify(q?.f));
  ok("antalet räknas", n === 1);
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
