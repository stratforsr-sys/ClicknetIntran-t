/**
 * Bara det som brinner (beställaren 2026-11-12).
 *
 *   1. Instämplingen avslutar en sjukanmälan på heltid: sista sjukdagen blir
 *      dagen före, eller anmälan ställs in om den gjordes samma dag.
 *   2. Förslag om ogiltig frånvaro som är äldre än två veckor, eller gäller
 *      någon som slutat, stängs.
 *   3. Jobben som lade ärenden om coachning och systemguider är borta, och
 *      chefen får inte påminnelsen OCH förslaget om samma dag.
 *
 *   TZ=UTC node --experimental-strip-types tests/sjuk-instampling.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { sjukVidInstampling } from "../src/lib/sjuk-instampling.ts";
import { inaktuelltForslag } from "../src/lib/konsekvens.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const las = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const anm = (o = {}) => ({
  first_sick_day: "2026-10-30",
  last_sick_day: null,
  cancelled_at: null,
  extent_percent: 100,
  registered_at: "2026-10-30T06:10:00.000Z",
  ...o,
});

console.log("\n\x1b[1mInstämplingen avslutar sjukanmälan\x1b[0m");
{
  // Micks fall: sjuk 30 oktober, instämplad 4 november 09:36.
  const a = sjukVidInstampling(anm(), "2026-11-04T08:36:00.000Z");
  ok("en senare dag: sista sjukdagen blir dagen före", a?.typ === "avsluta" && a.sista === "2026-11-03", JSON.stringify(a));

  const b = sjukVidInstampling(anm(), "2026-10-30T12:00:00.000Z");
  ok("samma dag, efter anmälan: ställs in", b?.typ === "stall_in", JSON.stringify(b));

  const c = sjukVidInstampling(anm({ registered_at: "2026-10-30T10:00:00.000Z" }), "2026-10-30T07:00:00.000Z");
  ok("samma dag, före anmälan (gick hem sjuk): rörs inte", c === null);

  ok("deltid rörs inte", sjukVidInstampling(anm({ extent_percent: 50 }), "2026-11-04T08:36:00.000Z") === null);
  ok("inställd rörs inte", sjukVidInstampling(anm({ cancelled_at: "2026-11-01T00:00:00Z" }), "2026-11-04T08:36:00.000Z") === null);
  ok("redan avslutad före dagen rörs inte", sjukVidInstampling(anm({ last_sick_day: "2026-11-01" }), "2026-11-04T08:36:00.000Z") === null);
  ok("instämpling före första sjukdagen rörs inte", sjukVidInstampling(anm(), "2026-10-29T08:00:00.000Z") === null);

  // Anmälan lagd i efterhand, efter att personen redan var tillbaka.
  const d = sjukVidInstampling(anm({ registered_at: "2026-11-06T09:00:00.000Z" }), "2026-11-04T08:36:00.000Z");
  ok("efterhandsanmälan: dagen före instämplingen", d?.typ === "avsluta" && d.sista === "2026-11-03", JSON.stringify(d));

  // Sista dag satt till i dag, och personen stämplar in i dag.
  const e = sjukVidInstampling(anm({ last_sick_day: "2026-11-04" }), "2026-11-04T08:36:00.000Z");
  ok("sista dag i dag krymper till i går", e?.typ === "avsluta" && e.sista === "2026-11-03");

  // Svensk dag, inte UTC-dag: 23:30 svensk tid den 3:e är fortfarande den 3:e.
  const f = sjukVidInstampling(anm(), "2026-11-03T22:30:00.000Z");
  ok("dagen räknas i svensk tid", f?.typ === "avsluta" && f.sista === "2026-11-02", JSON.stringify(f));
}

console.log("\n\x1b[1mInaktuella förslag stängs\x1b[0m");
{
  const aktiv = { status: "active", end_date: null };
  ok("färskt förslag står kvar", inaktuelltForslag("2026-11-10", aktiv, "2026-10-31") === null);
  ok("äldre än fönstret stängs", inaktuelltForslag("2026-10-20", aktiv, "2026-10-31") === "äldre än två veckor");
  ok("den som slutat", inaktuelltForslag("2026-11-10", { status: "offboarded", end_date: null }, "2026-10-31") === "personen har slutat");
  ok("okänd person räknas som slutad", inaktuelltForslag("2026-11-10", undefined, "2026-10-31") === "personen har slutat");
  ok("dag efter anställningens slut", inaktuelltForslag("2026-11-10", { status: "active", end_date: "2026-11-07" }, "2026-10-31") === "efter anställningens slut");
  ok("sista anställningsdagen står kvar", inaktuelltForslag("2026-11-07", { status: "active", end_date: "2026-11-07" }, "2026-10-31") === null);
}

console.log("\n\x1b[1mJobben\x1b[0m");
{
  const natt = las("src/app/api/jobb/natt/route.ts");
  ok("nattjobbet lägger inga coachningsärenden", !natt.includes("korCoachningsjobbet"));
  ok("nattjobbet lägger inga guideärenden", !natt.includes("korGuidejobbet"));
  ok("coachningsjobbet är borttaget", !existsSync(new URL("../src/lib/jobb/coachning.ts", import.meta.url)));
  ok("guidejobbet är borttaget", !existsSync(new URL("../src/lib/jobb/guider.ts", import.meta.url)));

  const dagtid = las("src/app/api/jobb/dagtid/route.ts");
  ok("ingen daglig chefsnotis om Tid", !dagtid.includes("korTidpaminnelser"));

  const stampla = las("src/app/(app)/tid/actions.ts");
  ok("instämplingen anropar sjukregeln", stampla.includes("avslutaSjukVidInstampling(supabaseAdmin(), user.employee.id, skedde.toISOString())"));

  const franvaro = las("src/lib/jobb/franvaro.ts");
  ok("nattjobbet är skyddsnät för sjukregeln", franvaro.includes("avslutaSjukVidInstampling(db, r.employee_id, forsta.occurred_at)"));
  ok("nattjobbet stänger gamla påminnelser", franvaro.includes('.lt("work_date", dagarBakat(idag, IKAPP_DAGAR))'));

  const konsekvenser = las("src/lib/jobb/konsekvenser.ts");
  ok("förslagsmotorn stänger inaktuella förslag", konsekvenser.includes("inaktuelltForslag(String(o.occurred_on)"));

  const notiser = las("src/lib/notiser-server.ts");
  ok("klockan visar bara den egna påminnelsen", notiser.includes("if (p.employee_id !== mig) continue;"));

  const tid = las("src/app/nav2/tid/route.ts");
  ok("Rensa finns i Tid", tid.includes('case "ogiltig-rensa"'));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
