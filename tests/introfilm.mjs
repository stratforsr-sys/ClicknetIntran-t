#!/usr/bin/env node
/**
 * Introfilmen i Nav 2.0 (0270). Ren logik, inga beroenden.
 *
 *   node --experimental-strip-types tests/introfilm.mjs
 *
 * Vem som får grinden (en gång per person, `varje_gang` varje besök), när
 * filmen räknas som sedd, och vad som skrivs på raden. Rutten och modulen
 * (moduler/nditf.js i utkastet) provas i webbläsaren.
 */
import assert from "node:assert/strict";
import { ADRESS_SEKUNDER, FILM, SEDD_ANDEL, arSedd, filmstorlek, introBeslut, seddRad } from "../src/lib/nav2/introfilmforma.ts";

let n = 0;
const T = { sekunder: FILM.sekunder, andel: SEDD_ANDEL, film: FILM.namn };
const prov = (namn, f) => { f(); n++; console.log("ok  " + namn); };

prov("ingen rad: grinden visas, inte sedd", () => {
  assert.deepEqual(introBeslut(null), { visa: true, sedd: false, varjeGang: false, ...T });
});
prov("sedd: ingen grind", () => {
  assert.deepEqual(introBeslut({ sedd_at: "2026-10-31T18:00:00Z", varje_gang: false }), { visa: false, sedd: true, varjeGang: false, ...T });
});
prov("varje gång, aldrig sedd: grinden, utan att få fortsätta direkt", () => {
  assert.deepEqual(introBeslut({ sedd_at: null, varje_gang: true }), { visa: true, sedd: false, varjeGang: true, ...T });
});
prov("varje gång och sedd: grinden, och får fortsätta direkt", () => {
  assert.deepEqual(introBeslut({ sedd_at: "2026-10-31T18:00:00Z", varje_gang: true }), { visa: true, sedd: true, varjeGang: true, ...T });
});
prov("varje_gang null räknas som av", () => {
  assert.equal(introBeslut({ sedd_at: "2026-10-31T18:00:00Z", varje_gang: null }).visa, false);
});

prov("sedd = minst 95 % av 178 s, aldrig mer än filmen", () => {
  const grans = FILM.sekunder * SEDD_ANDEL;
  assert.equal(grans, 169.1);
  assert.equal(arSedd(grans), true);
  assert.equal(arSedd(grans - 0.01), false);
  assert.equal(arSedd(178), true);
  assert.equal(arSedd(180), true);
  assert.equal(arSedd(180.5), false);
  for (const v of [null, undefined, "178", NaN, Infinity, -1, 0]) assert.equal(arSedd(v), false, String(v));
});

prov("storleken är stor eller liten, inget annat", () => {
  assert.equal(filmstorlek("stor"), "stor");
  assert.equal(filmstorlek("liten"), "liten");
  for (const v of [null, "", "STOR", "../x", "nycklar", "__proto__"]) assert.equal(filmstorlek(v), null, String(v));
});

prov("nycklarna ligger under nav2/introfilm/ i R2 och är mp4", () => {
  for (const k of Object.values(FILM.nycklar)) assert.match(k, /^nav2\/introfilm\/[a-z0-9-]+\.mp4$/);
});

prov("adressen lever längre än filmen med god marginal, och högst ett dygn", () => {
  assert.ok(ADRESS_SEKUNDER >= FILM.sekunder * 20);
  assert.ok(ADRESS_SEKUNDER <= 24 * 3600);
});

prov("första gången: sedd_at = nu, en gång", () => {
  assert.deepEqual(seddRad(null, "2026-10-31T18:00:00.000Z"), {
    sedd_at: "2026-10-31T18:00:00.000Z", senast_sedd_at: "2026-10-31T18:00:00.000Z", ganger: 1, film: FILM.namn, andrad_at: "2026-10-31T18:00:00.000Z",
  });
});
prov("igen: sedd_at står kvar, räknas upp, varje_gang rörs inte", () => {
  const r = seddRad({ sedd_at: "2026-10-30T08:00:00.000Z", ganger: 3 }, "2026-10-31T18:00:00.000Z");
  assert.equal(r.sedd_at, "2026-10-30T08:00:00.000Z");
  assert.equal(r.senast_sedd_at, "2026-10-31T18:00:00.000Z");
  assert.equal(r.ganger, 4);
  assert.equal("varje_gang" in r, false);
});
prov("filmens namn klarar 0270:s check", () => {
  assert.match(FILM.namn, /^[a-z0-9-]{1,40}$/);
});

console.log(`\n${n} prov gröna`);
