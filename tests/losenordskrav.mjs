#!/usr/bin/env node
/**
 * Losenordsreglerna. Ren logik, inga beroenden.
 *
 *   node --experimental-strip-types tests/losenordskrav.mjs
 *
 * Kravet ar sedan 2026-09-02 tva rader: minst atta tecken och minst en siffra.
 * Halften av proven nedan finns darfor for att bevaka att ingenting ANNAT
 * nekas — sparrlistan, tangentbordsraderna och namnkontrollen ar borttagna med
 * flit, och ett prov som visar det gor att de inte smyger tillbaka.
 */
import { granska, bitar, styrka, MIN_TECKEN, MAX_BYTE } from "../src/lib/losenordskrav.ts";
import { nyttTillfalligtLosenord } from "../src/lib/losenord.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const nekar = (l, gammalt) => granska(l, gammalt).fel;
const slapper = (l, gammalt) => granska(l, gammalt).ok;

console.log("\n\x1b[1mLangd\x1b[0m");
{
  ok(`${MIN_TECKEN - 1} tecken nekas`, !slapper("sju1tec"), nekar("sju1tec").join(" "));
  ok("8 tecken med siffra slapper igenom", slapper("hasten12"), nekar("hasten12").join(" "));
  ok("felet sager hur manga tecken det ar",
    nekar("abc1").some((f) => f.includes("4")));

  // Bcrypt laser 72 byte. Allt darefter kastas, och da ar det inte losenordet
  // anvandaren tror sig ha satt.
  const langt = "a1" + "a".repeat(71);
  ok("73 byte nekas", !slapper(langt));
  ok("och felet forklarar varfor",
    nekar(langt).some((f) => f.includes(String(MAX_BYTE))));

  // ao/aa/oe ar tva byte styck, sa 40 tecken kan vara 80 byte.
  const svenskt = "räksmörgås-på-bryggan-i-solen-en-lördag";
  const byte = new TextEncoder().encode(svenskt).length;
  ok(`svenska tecken raknas i byte (${byte} byte av ${[...svenskt].length} tecken)`,
    byte > [...svenskt].length);
}

console.log("\n\x1b[1mSiffran\x1b[0m");
{
  ok("utan siffra nekas", !slapper("hastenochvagnen"));
  ok("felet sager att det ar siffran som saknas",
    nekar("hastenochvagnen").some((f) => f.includes("siffra")));
  ok("en enda siffra racker", slapper("hastenochvagnen1"),
    nekar("hastenochvagnen1").join(" "));
  ok("siffran far sta var som helst", slapper("h4stenochvagnen"),
    nekar("h4stenochvagnen").join(" "));
  ok("bara siffror duger", slapper("94827361"), nekar("94827361").join(" "));
}

console.log("\n\x1b[1mIngenting annat nekas\x1b[0m");
{
  // Det har ar hela poangen med andringen. Vart och ett av orden nekades av
  // den gamla regeluppsattningen; nu ska de alla ga igenom.
  const fritt = [
    ["sparrlistan ar borta", "losenord123"],
    ["arstiden gar bra", "Sommar2026!"],
    ["bolagsnamnet gar bra", "Clicknet2026"],
    ["tangentbordsraden gar bra", "qwertyui1"],
    ["upprepning gar bra", "aaaaaaa1"],
    ["eget namn gar bra", "Zenobia1"],
    ["e-postadressen gar bra", "zenobia@clicknet.se1"],
    ["mellanslag i kanten gar bra", " hasten12 "],
  ];
  for (const [namn, l] of fritt) ok(namn, slapper(l), nekar(l).join(" "));
}

console.log("\n\x1b[1mSamma som det gamla\x1b[0m");
{
  ok("byte till samma ord nekas", !slapper("valross12", "valross12"));
  ok("och felet sager varfor",
    nekar("valross12", "valross12").some((f) => f.includes("samma som det gamla")));
  ok("ett annat ord gar bra", slapper("valross12", "kajak345"));
  ok("utan kant gammalt ord galler regeln inte", slapper("valross12"));
}

console.log("\n\x1b[1mAlla fel visas, inte bara det forsta\x1b[0m");
{
  // Ett fel i taget ar en pina: man rattar langden och far da veta om siffran.
  const f = nekar("kort");
  ok("for kort OCH utan siffra ger tva fel", f.length === 2, `${f.length}: ${f.join(" | ")}`);
}

console.log("\n\x1b[1mDet tillfalliga losenordet duger som losenord\x1b[0m");
{
  // Annars vore flodet omojligt: chefen delar ut ett ord som systemet sjalv
  // skulle ha nekat. Utan siffergarantin i `nyttTillfalligtLosenord` faller
  // ungefar ett ord pa 370 har, alltsa nastan varje korning av de 500.
  let alla = true;
  const problem = [];
  for (let i = 0; i < 500; i++) {
    const l = nyttTillfalligtLosenord();
    const dom = granska(l);
    if (!dom.ok) {
      alla = false;
      problem.push(`${l}: ${dom.fel.join(" ")}`);
    }
  }
  ok("500 slumpade tillfalliga losenord klarar granskningen", alla, problem.slice(0, 3).join(" | "));
}

console.log("\n\x1b[1mStyrkematet\x1b[0m");
{
  ok("tomt ger noll bitar", bitar("") === 0);
  ok("kort ord ar svagt", styrka("hej") === "svagt", String(bitar("hej")));
  ok("tre ord ar starkt", styrka("valross-kajak-lyktstolpe") === "starkt",
    String(bitar("valross-kajak-lyktstolpe")));

  // Upprepning ska inte kopa langd. Tolv likadana tecken ar inte tolv tecken.
  ok("aaaaaaaaaaaa far farre bitar an tolv olika",
    bitar("aaaaaaaaaaaa") < bitar("bktrmvxwzqjd"),
    `${bitar("aaaaaaaaaaaa")} mot ${bitar("bktrmvxwzqjd")}`);

  // Matet DOMMER INTE. Ett ord som matet kallar svagt ska slappas igenom sa
  // lange kravet ar uppfyllt — annars har mattet blivit en regel i smyg.
  ok("ett 'svagt' ord slapps igenom anda",
    styrka("hasten12") === "svagt" && slapper("hasten12"), String(bitar("hasten12")));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
