#!/usr/bin/env node
/**
 * Vem som slipper stampla — och att de stallen som MASTE fraga om det gor det.
 *
 * ===========================================================================
 * PROVET HAR TVA HALVOR, OCH DEN ANDRA AR DEN SOM FANGAR NASTA FEL.
 *
 * Forsta halvan provar regeln: `stampelfri()` med olika rolluppsattningar. Den
 * ar tre rader kod och hade aldrig gatt sonder av sig sjalv.
 *
 * Andra halvan laser KALLKODEN i de tva nattjobb dar en utebliven fraga inte
 * syns som ett fel utan som en anklagelse: `jobb/konsekvenser.ts` foreslar
 * ogiltig franvaro, `jobb/franvaro.ts` paminner om oregistrerad. Bada gar
 * igenom hela personalen och letar efter dagar DAR INGET HANDE, sa for den som
 * inte stamplar traffar de varje arbetsdag. Ett bortglomt filter dar ger ingen
 * krasch och inget rott prov — det ger en hog i chefens ko, och den upptacks
 * forst nar nagon undrar varfor VD har fjorton ogiltiga franvarodagar.
 *
 * En kallkodsavlasning ar trubbig och den vet det. Den kan inte se OM filtret
 * ar rakt; den ser att fragan stalls. Det ar det som glomdes, och det ar det
 * den vaktar.
 * ===========================================================================
 *
 *   node --experimental-strip-types tests/stampelfri.mjs
 */
import { readFileSync } from "node:fs";
import { STAMPELFRIA_ROLLER, stampelfri } from "../src/lib/stampelfri.ts";
import { ROLES } from "../src/lib/roles.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const las = (sokvag) => readFileSync(new URL(`../${sokvag}`, import.meta.url), "utf8");

console.log("\n\x1b[1mDe fyra rollerna, och bara de\x1b[0m");
{
  // Bestallarens besked 2026-08-28. Andras listan ska den andras HAR ocksa —
  // det ar hela poangen med att den star pa ett stalle.
  const vantade = ["ceo", "sales_manager", "finance", "project_manager"];
  ok(
    "listan ar exakt VD, saljchef, ekonomi, projektledare",
    [...STAMPELFRIA_ROLLER].sort().join(",") === [...vantade].sort().join(","),
    STAMPELFRIA_ROLLER.join(" "),
  );

  for (const roll of vantade) ok(`${roll} stamplar inte`, stampelfri([roll]));

  // De ovriga stamplar. Teamledaren ar den viktiga: hen ar chef men arbetar
  // samma pass som sitt team.
  for (const roll of ROLES.filter((r) => !vantade.includes(r))) {
    ok(`${roll} stamplar`, stampelfri([roll]) === false);
  }
}

console.log("\n\x1b[1mEn stampelfri roll racker\x1b[0m");
{
  ok("projektledare + saljare stamplar inte", stampelfri(["project_manager", "salesperson"]));
  ok("saljare + teamledare stamplar", stampelfri(["salesperson", "team_lead"]) === false);
  ok("utan roller stamplar man", stampelfri([]) === false);

  // Serversidan laser roller ur databasen. En rad darifran ar en strang, och
  // en okand strang far aldrig tolkas som en stampelfri roll.
  ok("okand roll stamplar", stampelfri(["kapten"]) === false);
  ok("null ar inte stampelfritt", stampelfri(null) === false);
  ok("undefined ar inte stampelfritt", stampelfri(undefined) === false);
}

console.log("\n\x1b[1mNattjobben fragar\x1b[0m");
{
  const konsekvenser = las("src/lib/jobb/konsekvenser.ts");
  ok(
    "forslagsmotorn hamtar de stampelfria",
    konsekvenser.includes("stampelfriaAnstallda(db)"),
  );
  ok(
    "och hoppar over dem innan den foreslar nagot",
    /if \(stampelfria\.has\(p\.id\)\) continue;/.test(konsekvenser),
  );

  const franvaro = las("src/lib/jobb/franvaro.ts");
  ok("paminnelsesteget hamtar de stampelfria", franvaro.includes("stampelfriaAnstallda(db)"));
  ok("och hoppar over dem", /if \(stampelfria\.has\(p\.id\)\)/.test(franvaro));

  // Bedomningen i tidjobbet — sen ankomst och rastavvikelser — galler den som
  // stamplar. Bokforingen star kvar; se rubriken i filen for varfor.
  const tid = las("src/lib/jobb/tid.ts");
  ok("tidjobbet hamtar de stampelfria", tid.includes("stampelfriaAnstallda(db)"));
  ok(
    "sen ankomst bedoms inte for dem",
    tid.includes("dagensSchema && !stampelfria.has(p.id)"),
  );
  ok(
    "rastavvikelser bedoms inte for dem",
    tid.includes("!rastPa || stampelfria.has(p.id)"),
  );
  ok(
    "men den glomda utstamplingen stangs anda",
    tid.includes('source: "system_auto_close"'),
  );
}

console.log("\n\x1b[1mGranssnittet frågar också\x1b[0m");
{
  const startsidan = las("src/app/(app)/page.tsx");
  ok(
    "startsidan raknar ihop modulens lage och personens roll",
    startsidan.includes("const stamplar = sparr.stampling && !stampelfri(user.roles)"),
  );
  ok(
    "och stamplingsfragan stalls bara for den som stamplar",
    /\n    stamplar\n      \? supabase\n          \.from\("time_event"\)/.test(startsidan),
  );

  const nav = las("src/components/shell/nav-items.ts");
  ok("sidopanelen fragar", nav.includes("stampelfri(user.roles)"));
  // Saljchefen och VD behaller /tid: de beslutar om rattelser respektive
  // ogiltig franvaro darifran.
  ok(
    "men behaller /tid for den som har en ko dar",
    nav.includes('canManageEmployees(user) || hasRole(user, "ceo")'),
  );

  const tidsidan = las("src/app/(app)/tid/page.tsx");
  ok("tid-sidan fragar", tidsidan.includes("stampelfri(user.roles)"));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
