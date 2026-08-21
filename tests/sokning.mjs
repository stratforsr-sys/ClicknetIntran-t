#!/usr/bin/env node
/**
 * E2.13: den globala sokningens strangregler.
 *
 *   node --experimental-strip-types tests/sokning.mjs
 *
 * Att fragorna ger RATT rader provas i tests/rls.mjs mot riktiga databasen —
 * det ar RLS som avgor det. Har provas att en fraga over huvud taget gar att
 * stalla utan att anvandarens text bryter sonder den.
 */
import {
  KALLOR,
  KALLA_ETIKETT,
  PER_KALLA,
  ilikeMonster,
  orMonster,
  orVillkor,
  utdrag,
} from "../src/lib/sokning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Jokertecken");
ok("vanligt ord blir ett monster", ilikeMonster("anna") === "%anna%");
// Utan escapen blir en sokning pa "50 %" en sokning pa allt.
ok("procent escapas", ilikeMonster("50 %") === "%50 \\%%");
ok("understreck escapas", ilikeMonster("a_b") === "%a\\_b%");
ok("bakstreck escapas", ilikeMonster("a\\b") === "%a\\\\b%");

rubrik("PostgREST separerar med kommatecken");
// Ett oskyddat kommatecken ger HTTP 400 och slar ut hela traffsidan — inte
// noll traffar. Provat skarpt mot API:t 2026-08-21.
ok("monstret citeras", orMonster("anna") === '"%anna%"');
ok("kommatecken hamnar inuti citaten", orMonster("a,b") === '"%a,b%"');
ok("citattecken escapas", orMonster('a"b') === '"%a\\"b%"');
ok(
  "bakstreck escapas i bada leden",
  orMonster("a\\b") === '"%a\\\\\\\\b%"',
  orMonster("a\\b"),
);

ok(
  "villkoret byggs for varje kolumn",
  orVillkor(["first_name", "last_name"], "anna") ===
    'first_name.ilike."%anna%",last_name.ilike."%anna%"',
);

rubrik("Utdraget visar varfor traffen ar en traff");
const text = "Den har rutinen handlar om mycket annat innan den kommer till lakarintyg och vad som galler kring det.";
ok("utdraget hamnar runt ordet", utdrag(text, "lakarintyg").includes("lakarintyg"));
ok("och markeras som avklippt", utdrag(text, "lakarintyg").startsWith("… "));
ok("kort text lamnas hel", utdrag("Kort text", "kort") === "Kort text");
ok("markdown-tecken stads bort", utdrag("## **Rubrik**", "rubrik") === "Rubrik");
ok("ingen text ger null", utdrag(null, "x") === null);
ok("bara markdown ger null", utdrag("###", "x") === null);
// Traffen kan sitta i en bilaga och alltsa inte i brodtexten alls. Da ska
// borjan visas i stallet for ingenting.
ok("ord som inte finns i texten ger anda borjan", utdrag("Inledning som ar lang", "bilaga").startsWith("Inledning"));

rubrik("Kallorna");
ok("varje kalla har en etikett", KALLOR.every((k) => Boolean(KALLA_ETIKETT[k])));
ok("rutiner star forst", KALLOR[0] === "rutin");
ok("taket per kalla ar litet nog att overblicka", PER_KALLA <= 8);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
