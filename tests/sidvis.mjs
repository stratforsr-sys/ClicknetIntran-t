#!/usr/bin/env node
/**
 * Sidvis lasning och omgangar. Ingen databas.
 *
 *   node --experimental-strip-types tests/sidvis.mjs
 *
 * Supabase-API:t kapar tyst vid 1000 rader, och en IN-lista med tusen uuid ar
 * en URL pa 37 kB. Bada felen ser ut som en kortare lista, och det ar darfor de
 * provas har och inte upptacks i ett registerutdrag.
 */
import { delaUpp, iTur, lasSidvis } from "../src/lib/sidvis.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// En falsk tabell som beter sig som PostgREST: range ar inklusivt i bada
// andar, och en sida bortom slutet ar tom, inte ett fel.
const tabell = (antal) => {
  const rader = Array.from({ length: antal }, (_, i) => ({ n: i }));
  const anrop = [];
  const sida = async (fran, till) => {
    anrop.push([fran, till]);
    return { data: rader.slice(fran, till + 1), error: null };
  };
  return { sida, anrop };
};

rubrik("lasSidvis");
{
  const { sida, anrop } = tabell(2500);
  const rader = await lasSidvis(sida);
  ok("2 500 rader kommer alla", rader.length === 2500, `fick ${rader.length}`);
  ok("i ordning", rader.every((r, i) => r.n === i));
  ok("tre anrop", anrop.length === 3, JSON.stringify(anrop));
  ok("sidorna overlappar inte", JSON.stringify(anrop) === JSON.stringify([[0, 999], [1000, 1999], [2000, 2999]]));
}
{
  const { sida, anrop } = tabell(1000);
  const rader = await lasSidvis(sida);
  ok("exakt 1 000 rader ger 1 000", rader.length === 1000);
  ok("och tva anrop (den andra sidan ar tom)", anrop.length === 2);
}
{
  const { sida, anrop } = tabell(0);
  ok("en tom tabell ger en tom lista", (await lasSidvis(sida)).length === 0);
  ok("efter ett anrop", anrop.length === 1);
}
{
  const { sida, anrop } = tabell(25);
  const rader = await lasSidvis(sida, 10);
  ok("en egen sidstorlek respekteras", rader.length === 25 && anrop.length === 3);
}
{
  let kastat = null;
  try {
    await lasSidvis(async () => ({ data: null, error: { message: "permission denied" } }));
  } catch (e) {
    kastat = e;
  }
  ok("ett fel kastas, aldrig en tom lista", kastat instanceof Error && kastat.message === "permission denied");
}
{
  // Ett fel pa andra sidan far inte ge forsta sidans rader som om de vore allt.
  let n = 0;
  let kastat = null;
  try {
    await lasSidvis(async (fran, till) =>
      n++ === 0
        ? { data: Array.from({ length: till - fran + 1 }, () => ({})), error: null }
        : { data: null, error: { message: "timeout" } },
    );
  } catch (e) {
    kastat = e;
  }
  ok("ett fel pa en senare sida kastas ocksa", kastat?.message === "timeout");
}
{
  // `data: null` utan fel ar vad supabase-js ger for en tom sida ibland.
  const rader = await lasSidvis(async () => ({ data: null, error: null }));
  ok("data null utan fel ar en tom sida", Array.isArray(rader) && rader.length === 0);
}

rubrik("delaUpp");
ok("250 i omgangar om 100 ger 100, 100, 50", JSON.stringify(delaUpp(Array.from({ length: 250 }, (_, i) => i), 100).map((d) => d.length)) === "[100,100,50]");
ok("en tom lista ger inga omgangar", delaUpp([], 100).length === 0);
ok("ordningen behalls", delaUpp([1, 2, 3, 4, 5], 2).flat().join() === "1,2,3,4,5");
ok("exakt en full omgang", JSON.stringify(delaUpp([1, 2], 2)) === "[[1,2]]");

rubrik("iTur");
{
  let igang = 0, mest = 0;
  const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
  const ut = await iTur([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
    igang++; mest = Math.max(mest, igang);
    await vanta(n * 3);
    igang--;
    return n * 10;
  });
  ok("svaren kommer i listans ordning", ut.join() === "50,10,40,20,30,0,60", ut.join());
  ok("aldrig fler an tre samtidigt", mest === 3, `mest ${mest}`);
  ok("en tom lista ger en tom lista", (await iTur([], 3, async () => 1)).length === 0);
  let kastat = null;
  try { await iTur([1, 2], 2, async (n) => { if (n === 2) throw new Error("nej"); return n; }); } catch (e) { kastat = e; }
  ok("ett fel kastas vidare", kastat?.message === "nej");
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
