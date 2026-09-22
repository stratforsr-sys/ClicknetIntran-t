#!/usr/bin/env node
/**
 * Upprepningen (0062): monstret, fonstret och tystnaden.
 *
 *   node --experimental-strip-types tests/upprepning.mjs
 *
 * INGEN DATABAS. Det ar avsikten: de tre saker som kan ga fel i en upprepning
 * ar alla rakning, och rakning ska ga att prova utan att nagon behover ett dygn
 * och en Supabase-instans.
 *
 * `fonster()` far mest utrymme, och det ar inte av karlek till datumaritmetik.
 * Den ar den enda funktionen i hela bygget som kan skriva samma uppgift tva
 * ganger — eller ateruppliva en forekomst nagon tagit bort — och bada felen ser
 * ut som slump nar de intraffar veckor senare.
 */
import {
  HORISONT_DAGAR,
  MONSTER,
  MONSTER_ETIKETT,
  VECKODAG_NAMN,
  arMonster,
  fonster,
  forekomster,
  granskaRegel,
  monstertext,
  nastaForekomst,
  normaliseraVeckodagar,
  regelUrFormular,
  serietext,
  traffar,
  tystadeForekomster,
} from "../src/lib/upprepning.ts";
import { veckodag } from "../src/lib/uppgifter.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** 2026-09-21 ar en mandag. Hela provet raknar fran den. */
const MANDAG = "2026-09-21";
const regel = (over) => ({
  monster: "veckovis",
  veckodagar: [1],
  starts_on: MANDAG,
  ends_on: null,
  ...over,
});

// -----------------------------------------------------------------------------
rubrik("Monstren ar tre, och alla tre ar namngivna");

ok("MONSTER har tre varden", MONSTER.length === 3, MONSTER.join(", "));
ok(
  "varje monster har en etikett",
  MONSTER.every((m) => typeof MONSTER_ETIKETT[m] === "string" && MONSTER_ETIKETT[m].length > 0),
);
ok("arMonster slapper igenom de tre", MONSTER.every(arMonster));
ok("arMonster avvisar manadsvis", !arMonster("manadsvis"));
ok(
  "alla sju veckodagar har ett namn",
  [1, 2, 3, 4, 5, 6, 7].every((d) => typeof VECKODAG_NAMN[d] === "string"),
);

// Grundantagandet hela provet vilar pa. Gar den har sonder ljuger alla nedan.
ok("2026-09-21 ar en mandag", veckodag(MANDAG) === 1);

// -----------------------------------------------------------------------------
rubrik("traffar() svarar pa ratt dag");

ok("dagligen traffar en sondag", traffar(regel({ monster: "dagligen", veckodagar: [] }), "2026-09-27"));
ok("vardagar traffar en fredag", traffar(regel({ monster: "vardagar", veckodagar: [] }), "2026-09-25"));
ok("vardagar traffar INTE en lordag", !traffar(regel({ monster: "vardagar", veckodagar: [] }), "2026-09-26"));
ok("vardagar traffar INTE en sondag", !traffar(regel({ monster: "vardagar", veckodagar: [] }), "2026-09-27"));
ok("veckovis {1} traffar mandagen", traffar(regel(), MANDAG));
ok("veckovis {1} traffar inte tisdagen", !traffar(regel(), "2026-09-22"));
ok("veckovis {1,4} traffar torsdagen", traffar(regel({ veckodagar: [1, 4] }), "2026-09-24"));

// -----------------------------------------------------------------------------
rubrik("forekomster() ger datumen, inklusive bada andarna");

{
  const d = forekomster(regel(), MANDAG, "2026-10-19");
  ok("fem mandagar pa fem veckor", d.length === 5, d.join(" "));
  ok("forsta ar startdagen", d[0] === MANDAG);
  ok("sista ar sista mandagen", d[4] === "2026-10-19");
  ok("alla ar mandagar", d.every((x) => veckodag(x) === 1));
}

{
  const d = forekomster(regel({ monster: "vardagar", veckodagar: [] }), MANDAG, "2026-09-27");
  ok("en vecka vardagar ger fem dagar", d.length === 5, d.join(" "));
  ok("lordagen saknas", !d.includes("2026-09-26"));
}

{
  // STARTEN GALLER AVEN NAR ANROPAREN FRAGAR TIDIGARE. Fonstret ar grovt av
  // design — den som fragar fran arsskiftet ska inte fa forekomster fore
  // seriens forsta dag bara for att regeln traffar dem.
  const d = forekomster(regel(), "2026-09-01", "2026-09-30");
  ok("inget fore starts_on", d.every((x) => x >= MANDAG), d.join(" "));
}

{
  const d = forekomster(regel({ ends_on: "2026-10-05" }), MANDAG, "2026-12-31");
  ok("inget efter ends_on", d.length === 3 && d[2] === "2026-10-05", d.join(" "));
}

ok("en regel som aldrig infaller ger tom lista", forekomster(regel({ veckodagar: [6] }), MANDAG, "2026-09-25").length === 0);

// -----------------------------------------------------------------------------
rubrik("nastaForekomst() hittar nasta for varje monster");

ok("dagligen: samma dag", nastaForekomst(regel({ monster: "dagligen", veckodagar: [] }), "2026-09-26") === "2026-09-26");
ok("vardagar: lordag ger mandag", nastaForekomst(regel({ monster: "vardagar", veckodagar: [], starts_on: "2026-09-01" }), "2026-09-26") === "2026-09-28");
ok("veckovis: tisdag ger nasta mandag", nastaForekomst(regel(), "2026-09-22") === "2026-09-28");
ok("nasta finns for varje monster", MONSTER.every((m) => nastaForekomst(regel({ monster: m, veckodagar: m === "veckovis" ? [1] : [], starts_on: "2026-09-01" }), MANDAG) !== null));
ok("null nar slutet passerats", nastaForekomst(regel({ ends_on: "2026-09-22" }), "2026-09-23") === null);

// -----------------------------------------------------------------------------
rubrik("Texterna ar svenska och sager vad regeln betyder");

ok("dagligen", monstertext(regel({ monster: "dagligen", veckodagar: [] })) === "Varje dag");
ok("vardagar", monstertext(regel({ monster: "vardagar", veckodagar: [] })) === "Varje vardag");
ok("en dag", monstertext(regel()) === "Varje måndag", monstertext(regel()));
ok(
  "tva dagar binds med och",
  monstertext(regel({ veckodagar: [1, 4] })) === "Varje måndag och torsdag",
  monstertext(regel({ veckodagar: [1, 4] })),
);
ok(
  "tre dagar far komma och och",
  monstertext(regel({ veckodagar: [1, 3, 5] })) === "Varje måndag, onsdag och fredag",
  monstertext(regel({ veckodagar: [1, 3, 5] })),
);
// Ingen engelsk bindning nagonstans — se rubriken i monstertext().
ok("aldrig ordet and", !monstertext(regel({ veckodagar: [1, 4] })).includes(" and "));
ok("serietext bar slutdatumet", serietext(regel({ ends_on: "2026-12-31" })) === "Varje måndag · till 2026-12-31");
ok("serietext utan slut ar bara monstret", serietext(regel()) === "Varje måndag");

// -----------------------------------------------------------------------------
rubrik("normaliseraVeckodagar() sorterar, avdubblar och sallar");

ok("sorterar", normaliseraVeckodagar([4, 1]).join() === "1,4");
ok("avdubblar", normaliseraVeckodagar([1, 1, 1]).join() === "1");
ok("tar stringar", normaliseraVeckodagar(["3", "1"]).join() === "1,3");
ok("kastar noll och atta", normaliseraVeckodagar([0, 8, 3]).join() === "3");
ok("kastar skrap", normaliseraVeckodagar(["mandag", null, 2]).join() === "2");

// -----------------------------------------------------------------------------
rubrik("granskaRegel() sager ifran pa manniskosprak");

ok("en giltig regel klagar inte", granskaRegel(regel()) === null);
ok("veckovis utan dagar avvisas", granskaRegel(regel({ veckodagar: [] })) !== null);
ok("dagligen MED dagar avvisas", granskaRegel(regel({ monster: "dagligen", veckodagar: [1] })) !== null);
ok("slut fore start avvisas", granskaRegel(regel({ ends_on: "2026-09-01" })) !== null);
ok("trasigt startdatum avvisas", granskaRegel(regel({ starts_on: "den 21:a" })) !== null);

/**
 * DEN VIKTIGASTE RADEN I AVSNITTET. "Varje lordag, 21 till 23 september" ar
 * giltig i varje enskilt falt och foder noll uppgifter. Utan kontrollen sparas
 * den, ser riktig ut i listan, och den som la upp den upptacker om ett halvar
 * att ingenting nagonsin hande.
 */
ok(
  "en regel som aldrig infaller avvisas",
  granskaRegel(regel({ veckodagar: [6], ends_on: "2026-09-23" })) !== null,
);
ok(
  "men en gles regel som HINNER infalla slapps igenom",
  granskaRegel(regel({ veckodagar: [6], ends_on: "2026-09-26" })) === null,
);

// -----------------------------------------------------------------------------
rubrik("fonster() foder ratt en gang och aldrig bakat");

{
  const f = fonster(regel(), MANDAG, null);
  ok("forsta fonstret borjar pa startdagen", f.fran === MANDAG);
  ok("och slutar pa horisonten", f.till === "2026-11-16", `${f.till}, horisont ${HORISONT_DAGAR} dagar`);
}

{
  // EFTERSLAPNING BOKFORS INTE. Har jobbet inte kort pa tre dygn ska de tre
  // dygnen inte komma som tre forsenade uppgifter i morgon bitti.
  const f = fonster(regel({ starts_on: "2026-08-01" }), MANDAG, null);
  ok("en gammal serie borjar foda IDAG", f.fran === MANDAG, f.fran);
}

{
  const f = fonster(regel(), MANDAG, "2026-11-16");
  ok("en fardigfodd serie ger null", f === null);
}

{
  const f = fonster(regel(), "2026-09-22", "2026-11-16");
  ok("dagen efter ger exakt en ny dag", f !== null && f.fran === "2026-11-17" && f.till === "2026-11-17", JSON.stringify(f));
}

{
  // BORTTAGNA FOREKOMSTER STANNAR BORTTAGNA. Horisonten ar redan passerad, och
  // fonstret far darfor aldrig oppna sig bakat over det som redan fotts.
  const f = fonster(regel(), MANDAG, "2026-10-01");
  ok("fran ligger efter materialized_to", f !== null && f.fran === "2026-10-02", JSON.stringify(f));
}

{
  const f = fonster(regel({ ends_on: "2026-10-05" }), MANDAG, null);
  ok("slutdatumet kapar horisonten", f !== null && f.till === "2026-10-05", JSON.stringify(f));
}

{
  // En serie som borjar INNE i fonstret oppnar pa sin egen startdag och inte
  // pa idag — annars hade forsta forekomsten hamnat fore den dag anvandaren
  // valde.
  const f = fonster(regel({ starts_on: "2026-10-12" }), MANDAG, null);
  ok("en serie som borjar senare oppnar dar", f !== null && f.fran === "2026-10-12", JSON.stringify(f));
}

{
  // Och en som borjar BORTOM horisonten far vanta. Nattjobbet provar den igen
  // varje natt, och den dag den kommer innanfor fods den.
  const f = fonster(regel({ starts_on: "2026-12-01" }), MANDAG, null);
  ok("en serie bortom horisonten ger null", f === null, `horisonten slutar ${HORISONT_DAGAR} dagar fram`);
}

// Och det som ar hela kontraktet: kor fonstret tva ganger i rad ska den andra
// korningen inte ge nagot den forsta redan gav.
{
  const forsta = fonster(regel(), MANDAG, null);
  const andra = fonster(regel(), MANDAG, forsta.till);
  ok("andra korningen samma dag ger null", andra === null);
}

// -----------------------------------------------------------------------------
rubrik("tystadeForekomster() later bara den narmaste tala");

const rad = (id, due, stangd = false, serie = "s1") => ({ id, series_id: serie, due_date: due, stangd });

{
  const t = tystadeForekomster([rad("a", "2026-09-21"), rad("b", "2026-09-28"), rad("c", "2026-10-05")]);
  ok("narmaste tiger inte", !t.has("a"));
  ok("de senare tystas", t.has("b") && t.has("c"));
}

{
  // BOCKAS DEN FORSTA AV TAR DEN ANDRA OVER. Annars hade en serie tystat sig
  // sjalv for all framtid sa snart nagon gjort forsta forekomsten.
  const t = tystadeForekomster([rad("a", "2026-09-21", true), rad("b", "2026-09-28"), rad("c", "2026-10-05")]);
  ok("en stangd rad ar inte narmast", !t.has("b"), [...t].join());
  ok("och den tredje tystas fortfarande", t.has("c"));
}

{
  const t = tystadeForekomster([rad("a", "2026-09-21")]);
  ok("en ensam forekomst tystas aldrig", t.size === 0);
}

{
  const t = tystadeForekomster([
    rad("a", "2026-09-21", false, "s1"),
    rad("b", "2026-09-28", false, "s1"),
    rad("x", "2026-09-22", false, "s2"),
    rad("y", "2026-09-29", false, "s2"),
  ]);
  ok("serier raknas var for sig", !t.has("a") && !t.has("x") && t.has("b") && t.has("y"));
}

{
  const t = tystadeForekomster([
    { id: "fri", series_id: null, due_date: "2026-09-21", stangd: false },
    { id: "fri2", series_id: null, due_date: "2026-09-22", stangd: false },
  ]);
  ok("uppgifter utan serie ror den inte", t.size === 0);
}

{
  // Ordningen i listan far inte avgora. Kommer den senaste forst ska den anda
  // tystas — annars hade sorteringen i en fraga blivit en del av regeln.
  const t = tystadeForekomster([rad("sen", "2026-10-05"), rad("tidig", "2026-09-21")]);
  ok("ordningen i listan spelar ingen roll", t.has("sen") && !t.has("tidig"));
}

// -----------------------------------------------------------------------------
rubrik("regelUrFormular() laser formularet likadant i bada modulerna");

const formular = (par) => {
  const f = new FormData();
  for (const [k, v] of par) f.append(k, v);
  return f;
};

ok("okryssad ruta ger null", regelUrFormular(formular([["monster", "veckovis"]]), MANDAG) === null);

{
  const r = regelUrFormular(
    formular([
      ["upprepas", "ja"],
      ["monster", "veckovis"],
      ["veckodag", "4"],
      ["veckodag", "1"],
    ]),
    MANDAG,
  );
  ok("kryssrutorna blir sorterade dagar", r.veckodagar.join() === "1,4", JSON.stringify(r.veckodagar));
  ok("starten faller tillbaka pa fristen", r.starts_on === MANDAG);
  ok("tomt slut blir null och inte tom strang", r.ends_on === null);
}

{
  const r = regelUrFormular(
    formular([
      ["upprepas", "ja"],
      ["monster", "vardagar"],
      // Ett kvarglomt kryss fran ett tidigare val far inte folja med: villkoret
      // `task_series_veckodagar` i 0062 hade avvisat hela raden.
      ["veckodag", "3"],
    ]),
    MANDAG,
  );
  ok("vardagar barvar inga veckodagar", r.veckodagar.length === 0);
  ok("och granskas som giltig", granskaRegel(r) === null);
}

{
  const r = regelUrFormular(
    formular([
      ["upprepas", "ja"],
      ["monster", "veckovis"],
      ["veckodag", "1"],
      ["serie_starts_on", "2026-10-01"],
      ["serie_ends_on", "2026-12-31"],
    ]),
    MANDAG,
  );
  ok("ett utskrivet startdatum vinner over fristen", r.starts_on === "2026-10-01");
  ok("slutdatumet foljer med", r.ends_on === "2026-12-31");
}

// -----------------------------------------------------------------------------
console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov foll.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
