#!/usr/bin/env node
/**
 * M4 provas utan databas: fristen, farglaggningen, medianen och forslaget om
 * att skriva en rutin.
 *
 *   node --experimental-strip-types tests/arenden.mjs
 */
import {
  slaLage,
  frist,
  median,
  statistik,
  manaden,
  forslagOmRutin,
  ANONYMA_ARENDEN,
} from "../src/lib/arenden.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const NU = new Date("2026-08-17T12:00:00.000Z");
const timmar = (n) => new Date(NU.getTime() + n * 3600_000).toISOString();

console.log("\n\x1b[1mAC-4.2: fristen och färgen\x1b[0m");
{
  ok("fristen räknas från upplägget",
    frist(new Date("2026-08-17T12:00:00.000Z"), 48) === "2026-08-19T12:00:00.000Z");

  const langt = { due_at: timmar(40), resolved_at: null, sla_hours: 48 };
  ok("40 timmar kvar av 48 är i tid", slaLage(langt, NU) === "i_tid");

  // Varningen borjar pa sista fjardedelen: 12 timmar av 48.
  const snart = { due_at: timmar(10), resolved_at: null, sla_hours: 48 };
  ok("10 timmar kvar av 48 är snart förfallen", slaLage(snart, NU) === "snart");

  // Varningen skalar med fristen. En veckas arende varnar vid 42 timmar kvar,
  // ett dygnsarende vid sex. Ett fast antal timmar hade varit for tidigt for
  // det ena och for sent for det andra.
  const veckaTidigt = { due_at: timmar(50), resolved_at: null, sla_hours: 168 };
  ok("50 timmar kvar av en vecka är i tid", slaLage(veckaTidigt, NU) === "i_tid");

  const veckaSent = { due_at: timmar(40), resolved_at: null, sla_hours: 168 };
  ok("40 timmar kvar av en vecka varnar redan", slaLage(veckaSent, NU) === "snart");

  const dygnTidigt = { due_at: timmar(10), resolved_at: null, sla_hours: 24 };
  ok("men 10 timmar kvar av ett dygn varnar inte än", slaLage(dygnTidigt, NU) === "i_tid");

  const over = { due_at: timmar(-1), resolved_at: null, sla_hours: 48 };
  ok("passerad frist är över tiden", slaLage(over, NU) === "over");

  const klart = { due_at: timmar(-100), resolved_at: timmar(-90), sla_hours: 48 };
  ok("ett löst ärende är avslutat, inte försenat", slaLage(klart, NU) === "klart");
}

console.log("\n\x1b[1mAC-4.5: median, inte medelvärde\x1b[0m");
{
  ok("tom lista ger ingen median", median([]) === null);
  ok("udda antal tar mitten", median([1, 5, 100]) === 5);
  ok("jämnt antal tar snittet av de två i mitten", median([2, 4, 6, 8]) === 5);

  // Ett arende som lag over semestern far inte forklara alla andra.
  ok("en extrem lämnar medianen ifred", median([2, 3, 4, 5, 900]) === 4);
}

console.log("\n\x1b[1mStatistiken grupperar på det man frågar efter\x1b[0m");
{
  const a = (kategori, skapad, lost, frist_) => ({
    category: kategori,
    team_id: null,
    created_at: skapad,
    due_at: frist_,
    resolved_at: lost,
  });

  const arenden = [
    a("pay", "2026-07-01T08:00:00.000Z", "2026-07-01T12:00:00.000Z", "2026-07-03T08:00:00.000Z"),
    a("pay", "2026-07-05T08:00:00.000Z", "2026-07-07T08:00:00.000Z", "2026-07-07T08:00:00.000Z"),
    a("pay", "2026-08-01T08:00:00.000Z", "2026-08-05T08:00:00.000Z", "2026-08-03T08:00:00.000Z"),
    a("equipment", "2026-08-02T08:00:00.000Z", null, "2026-08-05T08:00:00.000Z"),
  ];

  const perKategori = statistik(arenden, (x) => x.category);
  ok("störst kategori först", perKategori[0].nyckel === "pay" && perKategori[0].antal === 3);
  ok("medianen räknas bara på lösta", perKategori[0].medianTimmar === 48,
    String(perKategori[0].medianTimmar));

  // Det tredje loste arendet passerade fristen innan det lostes. Det raknas.
  ok("ett löst men försenat ärende räknas som över tiden", perKategori[0].overTiden === 1,
    String(perKategori[0].overTiden));

  const olost = perKategori.find((r) => r.nyckel === "equipment");
  ok("en kategori utan lösta ärenden har ingen median", olost.medianTimmar === null);

  const perManad = statistik(arenden, (x) => manaden(x.created_at));
  ok("samma data går att gruppera per månad", perManad.length === 2);
}

console.log("\n\x1b[1mAC-4.7: tre liknande frågor är en rutin som saknas\x1b[0m");
{
  const f = (kategori, dagarSedan) => ({
    category: kategori,
    created_at: new Date(NU.getTime() - dagarSedan * 24 * 3600_000).toISOString(),
  });

  const tva = forslagOmRutin([f("pay", 1), f("pay", 2)], 90, NU);
  ok("två frågor ger inget förslag", tva.length === 0);

  const tre = forslagOmRutin([f("pay", 1), f("pay", 2), f("pay", 3)], 90, NU);
  ok("tre frågor ger ett förslag", tre.length === 1 && tre[0].kategori === "pay");

  const gamla = forslagOmRutin([f("pay", 1), f("pay", 200), f("pay", 300)], 90, NU);
  ok("frågor utanför fönstret räknas inte", gamla.length === 0);
}

console.log("\n\x1b[1mAC-4.6: anonyma ärenden är avstängda\x1b[0m");
{
  ok("strömbrytaren står på false tills 50 anställda", ANONYMA_ARENDEN === false);
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
