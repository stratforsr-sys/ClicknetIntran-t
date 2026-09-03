#!/usr/bin/env node
/**
 * Chefens dagsbild provas utan databas.
 *
 * Varje regel at bada hallen: inte bara att den franvarande syns, utan att den
 * NARVARANDE inte gor det. Och tyngdpunkten pa de tre loftena i modulens
 * huvud — att sjuk och ledig aldrig ocksa domas som sena, att del av dag inte
 * domas alls, och att ingenting alls domas nar stamplingen ar av.
 *
 *   node --experimental-strip-types tests/dagslage.mjs
 */
import { dagensLage, dagssammanfattning } from "../src/lib/dagslage.ts";
import { svenskTidpunkt } from "../src/lib/klocka.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const DATUM = "2026-09-03"; // en torsdag
const kl = (tid) => svenskTidpunkt(DATUM, tid);

const anna = { id: "a", first_name: "Anna", last_name: "Ek", team_id: "t1", start_date: "2026-01-01" };
const bo = { id: "b", first_name: "Bo", last_name: "Falk", team_id: "t1", start_date: "2026-01-01" };
const cia = { id: "c", first_name: "Cia", last_name: "Gran", team_id: "t1", start_date: "2026-01-01" };

const bolagsschema = {
  id: "s1",
  scope: "company",
  employee_id: null,
  team_id: null,
  start_time: "08:00:00",
  tol_late: 1,
  valid_from: "2026-01-01",
};

const instampling = (id, tid) => ({ employee_id: id, kind: "in", occurred_at: kl(tid).toISOString() });

// Alla varden som inte provet handlar om star har, sa att varje fall nedan
// bara behover saga det som skiljer.
const bild = (extra) =>
  dagensLage({
    personer: [anna],
    scheman: [bolagsschema],
    stamplingar: [],
    ledigheter: [],
    sjuka: [],
    typnamn: new Map([["typ-sem", "Semester"], ["typ-vab", "Vård av barn"]]),
    stampelfria: new Set(),
    datum: DATUM,
    nu: kl("08:30"),
    stamplingPa: true,
    ...extra,
  });

console.log("\n\x1b[1mSen ankomst, och gransen at bada hallen\x1b[0m");
{
  const i_tid = bild({ stamplingar: [instampling("a", "07:58")] });
  ok("den som kom i tid star inte i listan", i_tid.rader.length === 0);

  // Toleransen laggs TILL gransen, precis som i narvaro.ts.
  const pa_toleransen = bild({ stamplingar: [instampling("a", "08:01")] });
  ok("exakt pa toleransen ar i tid", pa_toleransen.rader.length === 0);

  const sen = bild({ stamplingar: [instampling("a", "08:20")] });
  ok("den som kom sent star i listan", sen.rader.length === 1);
  ok("och laget ar 'sen'", sen.rader[0]?.lage === "sen");
  ok("forseningen raknas fran schemat, inte fran toleransen",
    sen.rader[0]?.etikett === "20 min sen", sen.rader[0]?.etikett);
  ok("detaljen bar bade ankomsten och schemat",
    sen.rader[0]?.detalj.includes("08:20") && sen.rader[0]?.detalj.includes("08:00"),
    sen.rader[0]?.detalj);

  // Dagens forsta instampling avgor. Den som gar ut och in igen kommer inte
  // for sent en andra gang.
  const ater = bild({
    stamplingar: [
      instampling("a", "07:55"),
      { employee_id: "a", kind: "out", occurred_at: kl("12:00").toISOString() },
      instampling("a", "12:45"),
    ],
  });
  ok("aterkomst efter lunch ar ingen sen ankomst", ater.rader.length === 0);
}

console.log("\n\x1b[1mIngen instampling an — fragan stalls forst nar tiden passerat\x1b[0m");
{
  const fore = bild({ nu: kl("07:45") });
  ok("fore schemastarten fragas ingenting", fore.rader.length === 0);

  const pa_toleransen = bild({ nu: kl("08:01") });
  ok("exakt pa toleransen ar fortfarande i tid", pa_toleransen.rader.length === 0);

  const efter = bild({ nu: kl("08:02") });
  ok("en minut efter toleransen syns luckan", efter.rader.length === 1);
  ok("och laget ar 'ej_instamplad'", efter.rader[0]?.lage === "ej_instamplad");
  ok("texten pastar ingenting mer an att stamplingen saknas",
    efter.rader[0]?.etikett === "Inte instämplad", efter.rader[0]?.etikett);

  const utan_schema = bild({ scheman: [], nu: kl("11:00") });
  ok("utan schema for dagen bedoms ingen", utan_schema.rader.length === 0);

  const stampelfri = bild({ stampelfria: new Set(["a"]), nu: kl("11:00") });
  ok("den stampelfria rollen bedoms inte", stampelfri.rader.length === 0);

  const nyanstalld = bild({
    personer: [{ ...anna, start_date: "2026-09-10" }],
    nu: kl("11:00"),
  });
  ok("dagar fore anstallningens start bedoms inte", nyanstalld.rader.length === 0);
}

console.log("\n\x1b[1mSjuk och ledig bedoms ALDRIG som sena\x1b[0m");
{
  // Bada har schema, bada saknar instampling, klockan ar 11. Utan regeln hade
  // var och en av dem fatt tva rader — och den ena hade varit en anklagelse.
  const sjuk = bild({
    nu: kl("11:00"),
    sjuka: [
      { employee_id: "a", first_sick_day: DATUM, last_sick_day: null, extent_percent: 100, confirmed_at: null },
    ],
  });
  ok("den sjuke far en rad, inte tva", sjuk.rader.length === 1);
  ok("och den raden ar sjukraden", sjuk.rader[0]?.lage === "sjuk");
  ok("obekraftad anmalan star ut", sjuk.rader[0]?.etikett === "Obekräftad");
  ok("och tonen ar den starkaste", sjuk.rader[0]?.ton === "danger");

  const bekraftad = bild({
    nu: kl("11:00"),
    sjuka: [
      {
        employee_id: "a",
        first_sick_day: "2026-09-01",
        last_sick_day: null,
        extent_percent: 50,
        confirmed_at: kl("09:00").toISOString(),
      },
    ],
  });
  ok("bekraftad anmalan sager 'Sjuk'", bekraftad.rader[0]?.etikett === "Sjuk");
  ok("sjukdagen raknas fran forsta sjukdagen",
    bekraftad.rader[0]?.detalj.startsWith("Sjukdag 3"), bekraftad.rader[0]?.detalj);
  ok("delvis sjukskrivning visar omfattningen",
    bekraftad.rader[0]?.detalj.includes("50 %"), bekraftad.rader[0]?.detalj);

  const ledig = bild({
    nu: kl("11:00"),
    ledigheter: [
      { employee_id: "a", type_id: "typ-sem", starts_on: "2026-09-01", ends_on: "2026-09-07", part_day_minutes: null },
    ],
  });
  ok("den lediga far en rad, inte tva", ledig.rader.length === 1);
  ok("och market ar franvarotypens eget namn", ledig.rader[0]?.etikett === "Semester");

  // Del av dag sager ingenting om VILKA timmar. Da domes ingenting.
  const del = bild({
    nu: kl("11:00"),
    ledigheter: [
      { employee_id: "a", type_id: "typ-vab", starts_on: DATUM, ends_on: DATUM, part_day_minutes: 150 },
    ],
  });
  ok("del av dag ger ingen sen ankomst", del.rader.length === 1);
  ok("och sags vara just del av dagen",
    del.rader[0]?.detalj.startsWith("Del av dagen"), del.rader[0]?.detalj);

  // Sjuk vinner over ledig: den som blir sjuk pa semestern ar sjuk.
  const bade = bild({
    nu: kl("11:00"),
    sjuka: [{ employee_id: "a", first_sick_day: DATUM, last_sick_day: null, extent_percent: 100, confirmed_at: null }],
    ledigheter: [
      { employee_id: "a", type_id: "typ-sem", starts_on: DATUM, ends_on: DATUM, part_day_minutes: null },
    ],
  });
  ok("sjuk gar fore ledig nar bada galler", bade.rader.length === 1 && bade.rader[0]?.lage === "sjuk");
}

console.log("\n\x1b[1mUtan stampling finns ingen uppgift om vem som ar pa plats\x1b[0m");
{
  const av = bild({
    nu: kl("11:00"),
    stamplingPa: false,
    personer: [anna, bo],
    sjuka: [{ employee_id: "b", first_sick_day: DATUM, last_sick_day: null, extent_percent: 100, confirmed_at: null }],
  });
  ok("ingen doms som sen nar stamplingen ar av",
    av.rader.every((r) => r.lage !== "sen" && r.lage !== "ej_instamplad"));
  ok("men den registrerade franvaron star kvar", av.rader.length === 1 && av.rader[0]?.lage === "sjuk");
  ok("och kortet vet att det inte kan svara pa allt", av.senRaknad === false);
}

console.log("\n\x1b[1mOrdningen: det oppna forst, det planerade sist\x1b[0m");
{
  const alla = dagensLage({
    personer: [anna, bo, cia],
    scheman: [bolagsschema],
    stamplingar: [instampling("b", "08:40")],
    ledigheter: [
      { employee_id: "c", type_id: "typ-sem", starts_on: DATUM, ends_on: DATUM, part_day_minutes: null },
    ],
    sjuka: [],
    typnamn: new Map([["typ-sem", "Semester"]]),
    stampelfria: new Set(),
    datum: DATUM,
    nu: kl("09:00"),
    stamplingPa: true,
  });

  ok("alla tre syns", alla.rader.length === 3, String(alla.rader.length));
  ok("den som inte stamplat in star overst", alla.rader[0]?.lage === "ej_instamplad");
  ok("den sena i mitten", alla.rader[1]?.lage === "sen");
  ok("den planerade ledigheten sist", alla.rader[2]?.lage === "ledig");

  ok("sammanfattningen raknar per lage",
    dagssammanfattning(alla) === "1 inte instämplad · 1 sen · 1 ledig", dagssammanfattning(alla));
}

console.log("\n\x1b[1mTom dag\x1b[0m");
{
  const tom = bild({ stamplingar: [instampling("a", "07:50")] });
  ok("inga rader", tom.rader.length === 0);
  ok("sammanfattningen sager det rent ut",
    dagssammanfattning(tom) === "Ingen frånvaro registrerad", dagssammanfattning(tom));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller gick igenom\x1b[0m\n" : `\n\x1b[31m${fel} fallna\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
