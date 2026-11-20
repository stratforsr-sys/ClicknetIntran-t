#!/usr/bin/env node
/**
 * Inkio-vakten (2026-11-20): när det larmas, vad larmet säger och vilka säljare
 * som saknas i Inkio. Ren logik, inget nätverk.
 *
 *   node --experimental-strip-types tests/inkio-vakt.mjs
 *
 * Fallet är Toro Relining AB (#41): godkänd 2026-11-13 15:38 UTC, Inkio svarade
 * 422 "Välj vem som sålde affären", och felet stod kvar i sju dagar.
 */
import { attLarma, orderlarm, saknasIInkio, saljarlarm, saljarnyckel, skalOchAtgard, stockholmsTimme } from "../src/lib/crm/inkio-vakt.ts";
import { readFileSync } from "node:fs";
import { HANDELSEKALLOR } from "../src/lib/notiser.ts";

// `epost-notis.ts` och `kalender-push.ts` är server-only och går inte att importera här; listorna läses som text.
function lista(fil, namn) {
  const text = readFileSync(new URL(`../src/lib/${fil}`, import.meta.url), "utf8");
  const start = text.indexOf(`export const ${namn}`);
  const slut = text.indexOf("]", start);
  return text.slice(start, slut);
}
const MEJL = lista("epost-notis.ts", "MEJLKALLOR");
const PUSH = lista("nav2/kalender-push.ts", "PUSHKALLOR");

let fel = 0;
function ok(namn, villkor, info = "") {
  if (villkor) console.log(`  \x1b[32m✓\x1b[0m ${namn}`);
  else {
    fel++;
    console.log(`  \x1b[31m✗ ${namn}\x1b[0m ${info}`);
  }
}
function rubrik(t) {
  console.log(`\n${t}`);
}

const TIMME = 60 * 60 * 1000;

rubrik("När det larmas");
{
  const fel13 = new Date("2026-11-13T15:43:05Z");
  ok("första gången alltid, också mitt i natten", attLarma(null, new Date("2026-11-14T02:00:00Z")));
  ok("inte igen samma dygn", !attLarma(fel13, new Date(fel13.getTime() + 23 * TIMME)));
  ok("igen efter ett dygn, på dagtid", attLarma(fel13, new Date("2026-11-14T16:00:00Z")));
  ok("inte på natten fast dygnet gått", !attLarma(new Date("2026-11-13T01:00:00Z"), new Date("2026-11-14T03:00:00Z")));
  ok("kl 07 svensk tid är dagtid (06 UTC på vintern)", stockholmsTimme(new Date("2026-11-20T06:00:00Z")) === 7);
  ok("kl 19 svensk tid är inte dagtid", !attLarma(new Date("2026-11-10T00:00:00Z"), new Date("2026-11-20T18:00:00Z")));
}

rubrik("Vad larmet säger");
{
  const toro = {
    orderId: "a6ce8b2c-ce6c-4f04-9084-4165d460d609",
    ordernummer: 41,
    bolag: "Toro Relining AB",
    fel: "Inkio svarade 422 på POST /api/salesorder/create-sales-order: Välj vem som sålde affären innan ordern skickas in.",
    sedan: "2026-11-13T15:38:12.708Z",
  };
  const l = orderlarm(toro, new Date("2026-11-20T09:00:00Z"));
  ok("rubriken har kunden och ordernumret", l.rubrik === "Toro Relining AB (#41) har inte kommit in i Inkio", l.rubrik);
  ok("skälet i klartext", l.detalj.includes("säljaren finns inte i Inkio"), l.detalj);
  ok("vad man gör", l.detalj.includes("Försök igen"), l.detalj);
  ok("hur länge den legat", l.detalj.includes("6 dagar"), l.detalj);
  ok("länken går till ordern", l.href === "/order/a6ce8b2c-ce6c-4f04-9084-4165d460d609", l.href);
  ok("detaljen ryms i tabellens 300 tecken", l.detalj.length <= 300);

  const nytt = skalOchAtgard("Säljaren (fredrik@clicknet.se) finns inte bland Inkios säljare. Lägg till samma e-post som säljare i Inkio och tryck Försök igen.");
  ok("Navs egen text: namnger säljaren", nytt.skal.includes("fredrik@clicknet.se") && nytt.atgard.includes("fredrik@clicknet.se"), JSON.stringify(nytt));

  const okant = skalOchAtgard("Inkio svarade 500 på POST /api/x: Något oväntat.");
  ok("okänt fel: Inkios egen text, utan förled, ingen gissning", okant.skal === "Något oväntat.", okant.skal);
  ok("inget fel alls: säger det", skalOchAtgard(null).skal === "Inkio gav inget skäl.");

  const samma = orderlarm({ ...toro, sedan: new Date().toISOString() }, new Date());
  ok("samma dag: ingen dagräkning", !samma.detalj.includes("Har legat"), samma.detalj);
  const enDag = orderlarm({ ...toro, sedan: "2026-11-19T08:00:00Z" }, new Date("2026-11-20T09:00:00Z"));
  ok("en dag: singular", enDag.detalj.includes("1 dag."), enDag.detalj);
}

rubrik("Säljare som saknas i Inkio");
{
  const nav = [
    { id: "1", namn: "Fredrik Pernehed", epost: "fredrik@clicknet.se" },
    { id: "2", namn: "Zen", epost: "Zen@Clicknet.se " },
    { id: "3", namn: "Utan e-post", epost: "" },
  ];
  const inkio = ["zen@clicknet.se", "simon@clicknet.se"];
  const saknas = saknasIInkio(nav, inkio);
  ok("Fredrik saknas", saknas.length === 1 && saknas[0].id === "1", JSON.stringify(saknas));
  ok("skiftläge och mellanslag räknas inte", !saknas.some((s) => s.id === "2"));
  ok("tom e-post larmas inte (det går inte att matcha den)", !saknas.some((s) => s.id === "3"));
  const l = saljarlarm(saknas);
  ok("en saknad: larmet namnger säljaren och adressen", l.rubrik === "Fredrik Pernehed saknas som säljare i Inkio" && l.detalj.includes("fredrik@clicknet.se"), JSON.stringify(l));
  const fyra = [
    { id: "a", namn: "Fredrik Pernehed", epost: "fredrik@clicknet.se" },
    { id: "b", namn: "Edvin Hadzic", epost: "edvin@clicknet.se" },
    { id: "c", namn: "Mick Corneliusson", epost: "mick@clicknet.se" },
    { id: "d", namn: "Thomas", epost: "thomas@clicknet.se" },
  ];
  const l4 = saljarlarm(fyra);
  ok("fyra saknade: EN notis med alla", l4.rubrik === "4 säljare saknas i Inkio" && fyra.every((s) => l4.detalj.includes(s.epost)), JSON.stringify(l4));
  ok("fyra saknade: ryms i 300 tecken", l4.detalj.length <= 300, String(l4.detalj.length));
  ok("samma uppsättning i annan ordning: samma nyckel", saljarnyckel(fyra) === saljarnyckel([...fyra].reverse()));
  ok("en ny saknad: ny nyckel, larmas direkt", saljarnyckel(fyra) !== saljarnyckel(fyra.slice(0, 3)));
}

rubrik("Sorterna är registrerade, mejlas och kan inte felstavas");
{
  for (const k of ["inkio-order-fel", "inkio-saljare-saknas"]) {
    ok(`${k} är en känd sort`, HANDELSEKALLOR.includes(k));
    ok(`${k} mejlas`, MEJL.includes(`"${k}"`));
    ok(`${k} pushas`, PUSH.includes(`"${k}"`));
  }
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
