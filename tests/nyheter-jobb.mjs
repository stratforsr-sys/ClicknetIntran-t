#!/usr/bin/env node
/**
 * Nyhetsjobbet publicerar inte gamla provinlagg (granskningen H3, F2-21).
 *
 *   TZ=UTC node --experimental-strip-types tests/nyheter-jobb.mjs
 *
 * Previewen sparar i produktionens databas, men pg_cron ringer bara
 * produktionen. Ett inlagg som schemalades under provningen star darfor kvar
 * som utkast med `scheduled_at` i det forflutna, och forsta korningen efter
 * mergen hade publicerat det for alla. Jobbet tar bara det som passerat de
 * senaste 48 timmarna. En schemalaggning ar alltid en arbetsdag 07:30
 * (nyheter/route.ts), och jobbet kors var kvart vardagar, sa ett riktigt
 * inlagg ar aldrig aldre an en kvart.
 *
 * nyheter-jobb.ts bar `import "server-only"` och `@/`-vagar. Kroken nedan
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

const { attPublicera, publiceraSchemalagda } = await import("../src/lib/nav2/nyheter-jobb.ts");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const nu = new Date("2026-10-26T06:45:00Z");
const timmar = (h) => new Date(nu.getTime() - h * 3_600_000).toISOString();

rubrik("attPublicera");
ok("finns", typeof attPublicera === "function");
const rader = [
  { id: "timme", status: "draft", scheduled_at: timmar(1) },
  { id: "tre-dygn", status: "draft", scheduled_at: timmar(72) },
  { id: "utan-tid", status: "draft", scheduled_at: null },
  { id: "publicerad", status: "published", scheduled_at: timmar(1) },
  { id: "framtid", status: "draft", scheduled_at: timmar(-2) },
  { id: "just-nu", status: "draft", scheduled_at: nu.toISOString() },
  { id: "47h", status: "draft", scheduled_at: timmar(47) },
  { id: "48h", status: "draft", scheduled_at: timmar(48) },
  { id: "helgen", status: "draft", scheduled_at: new Date("2026-10-23T05:30:00Z").toISOString() },
];
const ut = typeof attPublicera === "function" ? attPublicera(rader, nu) : [];
ok("ett utkast schemalagt för en timme sedan publiceras", ut.includes("timme"));
ok("ett schemalagt för tre dygn sedan publiceras inte", !ut.includes("tre-dygn"));
ok("ett utan scheduled_at publiceras inte", !ut.includes("utan-tid"));
ok("ett redan publicerat publiceras inte igen", !ut.includes("publicerad"));
ok("ett i framtiden väntar", !ut.includes("framtid"));
ok("ett som är exakt nu publiceras", ut.includes("just-nu"));
ok("47 timmar gammalt publiceras, 48 inte", ut.includes("47h") && !ut.includes("48h"));
ok("fredag 07:30 är inte kvar på måndag (jobbet gick på fredagen)", !ut.includes("helgen"));
ok("exakt rätt urval", JSON.stringify(ut) === JSON.stringify(["timme", "just-nu", "47h"]), JSON.stringify(ut));

// En attrapp som spelar in kedjan och svarar med raderna.
function attrapp(svar, ångrade = []) {
  const logg = [];
  const db = {
    from(tabell) {
      const kedja = { tabell, steg: [] };
      logg.push(kedja);
      const p = new Proxy({}, {
        get(_, namn) {
          if (namn === "then") {
            const forst = kedja.steg[0]?.[0], id = kedja.steg.find(([n, k]) => n === "eq" && k === "id")?.[2];
            // En uppdatering med .select() svarar med raderna den traffade; en angrad schemalaggning traffas inte.
            const data = forst === "select" ? svar : forst === "update" && kedja.steg.some(([n]) => n === "select") ? (ångrade.includes(id) ? [] : [{ id }]) : null;
            return (res) => res({ data, error: null });
          }
          return (...a) => { kedja.steg.push([namn, ...a]); return p; };
        },
      });
      return p;
    },
  };
  return { db, logg };
}

rubrik("publiceraSchemalagda använder samma villkor");
const { db, logg } = attrapp(rader.filter((r) => r.status === "draft" && r.scheduled_at && r.scheduled_at <= nu.toISOString()).map((r) => ({ ...r, slug: r.id, author_id: "a", published_at: null })));
const svar = await publiceraSchemalagda(db, nu);
const las = logg.find((k) => k.tabell === "news_post" && k.steg[0][0] === "select");
const nedre = las?.steg.find(([n, k]) => n === "gt" && k === "scheduled_at");
ok("läsningen har en nedre gräns 48 h bakåt", !!nedre && nedre[2] === timmar(48), JSON.stringify(nedre));
ok("bara de tre publiceras, också om läsningen ger fler", JSON.stringify(svar?.publicerade) === JSON.stringify(["timme", "just-nu", "47h"]), JSON.stringify(svar));
const upd = logg.filter((k) => k.tabell === "news_post" && k.steg[0][0] === "update");
ok("en uppdatering per inlägg", upd.length === 3);
ok("uppdateringen kräver draft och scheduled_at (F2-21: ångrad schemaläggning publiceras inte)", upd.every((k) => k.steg.some(([n, a, b]) => n === "eq" && a === "status" && b === "draft") && k.steg.some(([n, a, b, c]) => n === "not" && a === "scheduled_at" && b === "is" && c === null)));

rubrik("Ångrad i samma ögonblick (F2-21)");
const a = attrapp(rader.filter((r) => r.id === "timme" || r.id === "47h").map((r) => ({ ...r, slug: r.id, author_id: "a", published_at: null })), ["timme"]);
const svar2 = await publiceraSchemalagda(a.db, nu);
ok("inlägget som inte längre var schemalagt räknas inte som publicerat", JSON.stringify(svar2?.publicerade) === JSON.stringify(["47h"]), JSON.stringify(svar2));
ok("och får ingen rad i händelseloggen", a.logg.filter((k) => k.tabell === "audit_log").length === 1);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
