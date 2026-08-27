#!/usr/bin/env node
/**
 * E0.7. Larmet nar nattjobbet inte gor sitt.
 *
 * Tva saker provas, och bada ar sadant som gor larmet varderlost om de glider:
 *
 *   1. DIGESTEN ar stabil over natter. Samma fel tva natter i rad maste ge
 *      samma digest, annars raknar `registrera_fel` aldrig upp nagot och en
 *      manads tystnad blir trettio rader i kon i stallet for en rad med
 *      siffran 30. Och tva OLIKA steg maste ge olika digest, annars grupperas
 *      ett fallet franvaro-steg ihop med ett fallet sats-steg.
 *   2. GRANSERNA i `bedomDrift`. 25 timmar ar ok, 27 ar det inte. Ligger
 *      gransen for lagt larmar navet varje natt strax fore korningen; for
 *      hogt och tystnaden blir lang.
 *
 *   node --experimental-strip-types tests/larm.mjs
 */
import {
  bedomDrift,
  DRIFT_ETIKETT,
  kvittoLarmtext,
  larmDigest,
  larmSokvag,
  MAX_TIMMAR,
  normaliseraFel,
} from "../src/lib/jobb/larm.ts";
import { rensaSokvag } from "../src/lib/fel.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mNormaliseringen\x1b[0m");
{
  ok("tom text ger tom strang", normaliseraFel("") === "");
  ok("null ger tom strang", normaliseraFel(null) === "");
  ok("undefined ger tom strang", normaliseraFel(undefined) === "");

  const medTid = normaliseraFel("timeout 2026-08-27T02:30:11.482Z mot dialern");
  ok("tidsstampel byts mot en platshallare", medTid === "timeout <tid> mot dialern", medTid);

  const medId = normaliseraFel("rad 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b saknas");
  ok("uuid byts mot en platshallare", medId === "rad <id> saknas", medId);

  const medDatum = normaliseraFel("ingen lonerad for 2026-08-26");
  ok("ett bart datum byts mot en platshallare", medDatum === "ingen lonerad for <datum>", medDatum);

  const medSiffror = normaliseraFel("hamtade 1418 rader, 3 fel");
  ok("siffergrupper byts mot en platshallare", medSiffror === "hamtade <n> rader, <n> fel", medSiffror);

  const brusigt = normaliseraFel("  fel   pa\n  raden  ");
  ok("blanktecken slas ihop och trimmas", brusigt === "fel pa raden", `"${brusigt}"`);

  const langt = normaliseraFel("a".repeat(900));
  ok("langa texter klipps", langt.length === 500, String(langt.length));
}

console.log("\n\x1b[1mDigesten ar stabil over natter\x1b[0m");
{
  // Samma bugg, tva natter. Allt som skiljer ar tidsstampeln, radens uuid och
  // antalet rader den hann med — alltsa precis det som gor att en naiv digest
  // blir ny varje natt.
  const natt1 =
    "insert misslyckades 2026-08-26T02:30:04.101Z for 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b efter 118 rader";
  const natt2 =
    "insert misslyckades 2026-08-27T02:30:09.884Z for 9e8d7c6b-5a4f-4321-9876-54321fedcba0 efter 204 rader";

  ok("samma fel tva natter i rad ger samma digest", larmDigest("satser", natt1) === larmDigest("satser", natt2), larmDigest("satser", natt1));

  // Tredje natten, samma text ord for ord. Trivialt, men det ar det fallet
  // raknaren bygger pa allra oftast.
  ok("identisk text ger identisk digest", larmDigest("satser", natt1) === larmDigest("satser", natt1));

  ok(
    "tva olika steg ger olika digest",
    larmDigest("franvaro", natt1) !== larmDigest("satser", natt1),
    `${larmDigest("franvaro", natt1)} vs ${larmDigest("satser", natt1)}`,
  );

  ok(
    "tva olika fel i samma steg ger olika digest",
    larmDigest("satser", "timeout mot databasen") !== larmDigest("satser", "kolumnen saknas"),
  );

  ok("digesten borjar med steget i klartext", larmDigest("konton", "x").startsWith("natt-konton-"), larmDigest("konton", "x"));
  ok("digesten ar aldrig tom", larmDigest("tid", null).length > 0 && larmDigest("tid", null) !== "natt-tid-");

  // Check-villkoret error_report_automatisk_har_digest nekar en automatisk rad
  // utan digest. En digest maste alltsa finnas aven for ett fel utan text.
  ok("ett fel utan text far anda en digest", /^natt-tid-[0-9a-f]{8}$/.test(larmDigest("tid", null)), larmDigest("tid", null));
  ok("hashen ar atta hexsiffror", /^natt-satser-[0-9a-f]{8}$/.test(larmDigest("satser", natt1)));
}

console.log("\n\x1b[1mSokvagen overlever rensaSokvag()\x1b[0m");
{
  ok("sokvagen bar steget", larmSokvag("satser") === "/api/jobb/natt/satser", larmSokvag("satser"));

  // FALLAN. Ett fragment hade klippts bort och alla sex steg grupperats ihop
  // pa /api/jobb/natt. Provet kor den riktiga funktionen, inte en kopia av
  // vad den tros gora.
  ok(
    "rensaSokvag lamnar den orord",
    rensaSokvag(larmSokvag("satser")) === "/api/jobb/natt/satser",
    rensaSokvag(larmSokvag("satser")),
  );
  ok(
    "medan ett fragment hade klippts bort",
    rensaSokvag("/api/jobb/natt#satser") === "/api/jobb/natt",
    rensaSokvag("/api/jobb/natt#satser"),
  );
  ok(
    "sa att tva steg halls isar",
    rensaSokvag(larmSokvag("franvaro")) !== rensaSokvag(larmSokvag("satser")),
  );
}

console.log("\n\x1b[1mGranserna i bedomDrift\x1b[0m");
{
  const nu = new Date("2026-08-27T09:00:00.000Z");
  const timmarSedan = (h) => new Date(nu.getTime() - h * 3_600_000).toISOString();

  ok("gransen ar 26 timmar", MAX_TIMMAR === 26, String(MAX_TIMMAR));

  const nyss = bedomDrift({ senaste: timmarSedan(1), nu });
  ok("en timme sedan ar ok", nyss.lage === "ok", nyss.lage);
  ok("och timmarna raknas ut", nyss.timmar === 1, String(nyss.timmar));

  const tjugofem = bedomDrift({ senaste: timmarSedan(25), nu });
  ok("25 timmar ar ok", tjugofem.lage === "ok", `${tjugofem.lage} (${tjugofem.timmar} h)`);

  const tjugosju = bedomDrift({ senaste: timmarSedan(27), nu });
  ok("27 timmar ar forsenat", tjugosju.lage === "forsenat", `${tjugosju.lage} (${tjugosju.timmar} h)`);

  // Sjalva gransen. Exakt 26 ar fortfarande ok — larmet gar forst nar den
  // passerats, alltsa 04:30 dagen efter en utebliven korning.
  ok("exakt 26 timmar ar ok", bedomDrift({ senaste: timmarSedan(26), nu }).lage === "ok");
  ok("26,5 timmar ar forsenat", bedomDrift({ senaste: timmarSedan(26.5), nu }).lage === "forsenat");

  // Ett dygn plus en halvtimme: jobbet kordes 03:00 i stallet for 02:30. Det
  // ar en forsening, inte en utebliven natt, och far inte larma.
  ok("en halvtimme forsenad korning larmar inte", bedomDrift({ senaste: timmarSedan(24.5), nu }).lage === "ok");

  ok("gransen gar att flytta i anropet", bedomDrift({ senaste: timmarSedan(10), nu, maxTimmar: 6 }).lage === "forsenat");
}

console.log("\n\x1b[1m'aldrig' ar ett eget lage\x1b[0m");
{
  const nu = new Date("2026-08-27T09:00:00.000Z");

  // I koden ser en korning som aldrig skett ut som en oandligt gammal
  // korning. For den som laser ar det tva olika besked, och de pekar pa olika
  // saker att titta pa: cron-posten respektive steget.
  for (const [namn, varde] of [["null", null], ["undefined", undefined], ["tom strang", ""]]) {
    const b = bedomDrift({ senaste: varde, nu });
    ok(`${namn} ger 'aldrig'`, b.lage === "aldrig", b.lage);
    ok(`${namn} ger inga timmar`, b.timmar === null, String(b.timmar));
  }

  const skrap = bedomDrift({ senaste: "inte ett datum", nu });
  ok("en otolkbar tidsstampel ger 'aldrig'", skrap.lage === "aldrig", skrap.lage);

  ok("'aldrig' ar inte samma sak som 'forsenat'", DRIFT_ETIKETT.aldrig !== DRIFT_ETIKETT.forsenat);
  ok("alla tre lagen har en egen text", new Set(Object.values(DRIFT_ETIKETT)).size === 3);
}

console.log("\n\x1b[1mKlockskev larmar inte\x1b[0m");
{
  const nu = new Date("2026-08-27T09:00:00.000Z");
  const framtiden = new Date(nu.getTime() + 3_600_000).toISOString();
  const b = bedomDrift({ senaste: framtiden, nu });
  // Ett kvitto i framtiden ar en klocka som gatt fel. Att larma om det hade
  // bytt ett problem mot ett annat.
  ok("ett kvitto i framtiden ar ok", b.lage === "ok", b.lage);
  ok("och ger negativa timmar", b.timmar === -1, String(b.timmar));
}

console.log("\n\x1b[1mLarmtexten om det uteblivna kvittot\x1b[0m");
{
  const nu = new Date("2026-08-27T09:00:00.000Z");
  const trettio = bedomDrift({ senaste: new Date(nu.getTime() - 30 * 3_600_000), nu });
  const femtiofyra = bedomDrift({ senaste: new Date(nu.getTime() - 54 * 3_600_000), nu });

  ok("texten bar antalet timmar", kvittoLarmtext(trettio).includes("30"), kvittoLarmtext(trettio));
  ok("tva natter ger en annan text", kvittoLarmtext(trettio) !== kvittoLarmtext(femtiofyra));

  // Och anda samma digest. Det ar hela mekanismen: fjorton natters tystnad
  // blir en rad med raknaren 14, inte fjorton rader.
  ok(
    "men samma digest",
    larmDigest("kvitto", kvittoLarmtext(trettio)) === larmDigest("kvitto", kvittoLarmtext(femtiofyra)),
    larmDigest("kvitto", kvittoLarmtext(trettio)),
  );

  // 'aldrig' ar daremot en annan sak och ska bli en egen rad i kon.
  const aldrig = bedomDrift({ senaste: null, nu });
  ok(
    "'aldrig' ger en egen digest",
    larmDigest("kvitto", kvittoLarmtext(aldrig)) !== larmDigest("kvitto", kvittoLarmtext(trettio)),
  );
  ok("och pekar pa cron-posten", kvittoLarmtext(aldrig).includes("vercel.json"), kvittoLarmtext(aldrig));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
