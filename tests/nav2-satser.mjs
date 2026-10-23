#!/usr/bin/env node
/**
 * Granskningen S06 (D8): en sats får inte sluta gälla utan efterföljare, och
 * förhandsvisningen i Satser och löner räknar som servern.
 *
 * 1. `kanSluta` (src/lib/nav2/satsforma.ts): rutten /nav2/satser nekar ett
 *    slutdatum på en bärande sats (avgifterna, taket och åldersgränserna) om
 *    ingen rad med samma nyckel tar vid senast dagen efter. Utan efterföljare
 *    saknas satsen från dagen efter, och lönekostnaden fick då nedsatt avgift
 *    för alla (åldersgränsen föll tillbaka på 0).
 * 2. Klientens satsGaller/satsAvgift/satsRakna (utkastet) mot servern
 *    (`satserUrRader` + `raknaLonekostnad`), med satser som saknas.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-satser.mjs
 */
import { readFileSync } from "node:fs";
import { BARANDE, kanSluta } from "../src/lib/nav2/satsforma.ts";
import { raknaLonekostnad, satserUrRader } from "../src/lib/lonekostnad.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("kanSluta");
{
  const rad = { nyckel: "senior_age_min|", giltig_fran: "2026-01-01", giltig_till: "2026-12-31" };
  ok("gäller till 2026-12-31 utan efterföljare: nej", kanSluta(rad, [{ nyckel: "senior_age_min|", giltig_fran: "2026-01-01" }]) === false);
  ok("med en rad som börjar 2027-01-01: ja", kanSluta(rad, [{ nyckel: "senior_age_min|", giltig_fran: "2026-01-01" }, { nyckel: "senior_age_min|", giltig_fran: "2027-01-01" }]) === true);
  ok("en rad som börjar 2027-01-02 lämnar en dag utan sats: nej", kanSluta(rad, [{ nyckel: "senior_age_min|", giltig_fran: "2027-01-02" }]) === false);
  ok("en senare rad som redan börjat (2026-06-01) tar vid: ja", kanSluta(rad, [{ nyckel: "senior_age_min|", giltig_fran: "2026-06-01" }]) === true);
  ok("en rad med en annan nyckel räknas inte", kanSluta(rad, [{ nyckel: "employer_fee_standard|", giltig_fran: "2027-01-01" }]) === false);
  ok("raden själv räknas inte som efterföljare", kanSluta({ ...rad, giltig_till: "2025-12-31" }, [{ nyckel: "senior_age_min|", giltig_fran: "2026-01-01" }]) === false);
  ok("utan slutdatum: ja", kanSluta({ ...rad, giltig_till: null }, []) === true);
  ok("månadsskifte i februari", kanSluta({ nyckel: "x|", giltig_fran: "2027-01-01", giltig_till: "2028-02-28" }, [{ nyckel: "x|", giltig_fran: "2028-02-29" }]) === true);
  for (const k of ["employer_fee_standard", "senior_age_min"]) ok(`${k} är bärande`, BARANDE.has(k));
  // Granskarens fynd: Skatteverkets rättelse "Unga" (moduler/sats.js, SATSSKV) lägger in
  // employer_fee_young, young_age_min och young_age_max som gäller till 2027-09-30, utan
  // efterföljare, eftersom nedsättningen är tillfällig. Den måste gå igenom. Saknas
  // spannet, taket eller den nedsatta avgiften blir det full avgift (null-regeln).
  for (const k of ["employer_fee_young", "young_age_min", "young_age_max", "employer_fee_reduced", "employer_fee_reduced_cap", "no_fee_age_min"]) {
    ok(`${k} får sluta utan efterföljare (Skatteverkets regel för unga och null-regeln)`, !BARANDE.has(k));
  }
}

rubrik("Förhandsvisningen räknar som servern");
{
  const html = readFileSync(new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
  const plock = (re) => { const m = re.exec(html); if (!m) throw new Error("hittar inte " + re); return m[0]; };
  const kod = [
    plock(/function satsRaderPa\(datum\)\{[^\n]*/),
    plock(/function satsRadFor\(kind, applies, datum\)\{[^\n]*/),
    plock(/function satsGaller\(datum\)\{[\s\S]*?\n\}/),
    plock(/const satsAlder = [^\n]*/),
    plock(/function satsAvgift\(alder, s\)\{[\s\S]*?\n\}/),
    plock(/function satsRakna\(u, s\)\{[\s\S]*?\n\}/),
    plock(/function satsManaderI\(start, slut\)\{[\s\S]*?\n\}/),
  ].join("\n");
  const S = { sats: { rader: [] } };
  const klient = Function("S", "satsSt", "satsKr", `${kod}\nreturn {satsGaller, satsRakna};`)(S, () => {}, (v) => `${Math.round(v)} kr`);
  const r = (kind, value, valid_from = "2026-01-01", valid_to = null) => ({ kind, applies_to: null, value, valid_from, valid_to });
  const bas = [r("employer_fee_standard", 31.42), r("employer_fee_reduced", 10.21), r("employer_fee_reduced_cap", 25000), r("young_age_min", 19), r("young_age_max", 23), r("senior_age_min", 67)];
  const fall = {
    alla: bas,
    "utan senior_age_min": bas.filter((x) => x.kind !== "senior_age_min"),
    "senior_age_min slutade 2026-12-31": [...bas.filter((x) => x.kind !== "senior_age_min"), r("senior_age_min", 67, "2026-01-01", "2026-12-31")],
    "utan taket": bas.filter((x) => x.kind !== "employer_fee_reduced_cap"),
    "utan den nedsatta avgiften": bas.filter((x) => x.kind !== "employer_fee_reduced"),
    "utan ungdomsspannet": bas.filter((x) => !x.kind.startsWith("young_age")),
    "taket 0": [...bas.filter((x) => x.kind !== "employer_fee_reduced_cap"), r("employer_fee_reduced_cap", 0)],
    "med Skatteverkets sats för unga": [...bas, r("employer_fee_young", 20.81)],
  };
  let lika = 0, olika = 0;
  const exempel = [];
  for (const [namn, rader] of Object.entries(fall)) {
    S.sats.rader = rader;
    for (const fodd of [null, 1940, 1956, 1966, 1986, 2003, 2006, 2010]) {
      for (const lon of [18000, 30000, 52000]) {
        const u = { manadslon: lon, fodelsear: fodd, periodStart: "2027-01-01", periodSlut: "2027-01-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null };
        const server = raknaLonekostnad(u, satserUrRader(rader, "2027-01-01"));
        const k = klient.satsRakna(u, klient.satsGaller("2027-01-01"));
        if (Math.abs(Math.round(k.total * 100) / 100 - server.totalkostnad) < 0.011) lika++;
        else { olika++; if (exempel.length < 4) exempel.push(`${namn}, född ${fodd}, ${lon} kr: server ${server.totalkostnad}, förhandsvisning ${Math.round(k.total * 100) / 100}`); }
      }
    }
  }
  ok(`förhandsvisningen och servern ger samma lönekostnad (${lika} lika, ${olika} olika)`, olika === 0, exempel.join(" | "));
  S.sats.rader = fall["utan senior_age_min"];
  const k70 = klient.satsRakna({ manadslon: 30000, fodelsear: 1956, periodStart: "2027-01-01", periodSlut: "2027-01-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null }, klient.satsGaller("2027-01-01"));
  ok("förhandsvisningen: 70-åringen utan åldersgräns har full avgift", k70.manader[0].grund === "full" && k70.manader[0].procent === 31.42);
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
