#!/usr/bin/env node
/**
 * Losenordsreglerna. Ren logik, inga beroenden.
 *
 *   node --experimental-strip-types tests/losenordskrav.mjs
 */
import { granska, bitar, styrka, MIN_TECKEN, MAX_BYTE } from "../src/lib/losenordskrav.ts";
import { nyttTillfalligtLosenord } from "../src/lib/losenord.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const ZEN = { fornamn: "Zenobia", efternamn: "Strandberg", epost: "zenobia@clicknet.se" };
const nekar = (l, om = {}, gammalt) => granska(l, om, gammalt).fel;
const slapper = (l, om = {}, gammalt) => granska(l, om, gammalt).ok;

console.log("\n\x1b[1mLangd\x1b[0m");
{
  ok(`${MIN_TECKEN - 1} tecken nekas`, !slapper("elva-tecken"), nekar("elva-tecken").join(" "));
  ok("12 tecken slapper igenom", slapper("trapphus-vid"), nekar("trapphus-vid").join(" "));
  ok("felet sager hur manga tecken det ar",
    nekar("abc").some((f) => f.includes("3")));

  // Bcrypt laser 72 byte. Allt darefter kastas, och da ar det inte losenordet
  // anvandaren tror sig ha satt.
  const langt = "a".repeat(73);
  ok("73 byte nekas", !slapper(langt));
  ok("och felet forklarar varfor",
    nekar(langt).some((f) => f.includes(String(MAX_BYTE))));

  // ao/aa/oe ar tva byte styck. 40 tecken ar 80 byte.
  const svenskt = "räksmörgås-på-bryggan-i-solen-en-lördag";
  const byte = new TextEncoder().encode(svenskt).length;
  ok(`svenska tecken raknas i byte (${byte} byte av ${[...svenskt].length} tecken)`,
    byte > [...svenskt].length);
}

console.log("\n\x1b[1mSparrlistan\x1b[0m");
{
  ok("losenord123456 nekas", !slapper("losenord123456"));
  ok("Sommar2026!!! nekas", !slapper("Sommar2026!!!"));
  ok("Clicknet2026! nekas", !slapper("Clicknet2026!"));
  ok("felet namner ordet", nekar("Sommar2026!!!").some((f) => f.includes("sommar")));

  // Sparren tittar pa STAMMEN. Siffror pa slutet doljer ingenting.
  ok("qwertyuiopas nekas som tangentbordsrad", !slapper("qwertyuiopas"));
  ok("baklanges ocksa", !slapper("poiuytrewqas"));
  ok("men fem tecken i rad racker inte for att neka", slapper("qwertsolros-vagen"),
    nekar("qwertsolros-vagen").join(" "));

  // Korta ord nekas bara nar de ar hela losenordet, aldrig som delstrang.
  ok("hela losenordet 'test' nekas", !slapper("test"));
  ok("men 'protestera-i-regnet' slapper igenom", slapper("protestera-i-regnet"),
    nekar("protestera-i-regnet").join(" "));
  ok("och 'hostsonaten-pa-radio' ocksa", slapper("hostsonaten-pa-radio"),
    nekar("hostsonaten-pa-radio").join(" "));
}

console.log("\n\x1b[1mUpprepning och siffror\x1b[0m");
{
  ok("aaaaaaaaaaaa nekas", !slapper("aaaaaaaaaaaa"));
  ok("abababababab nekas", !slapper("abababababab"));
  ok("bara siffror nekas hur manga de an ar", !slapper("948273615048273"));
  ok("felet sager det rent ut",
    nekar("948273615048273").some((f) => f.includes("siffror")));
}

console.log("\n\x1b[1mPersonuppgifter ur profilen\x1b[0m");
{
  ok("fornamnet i losenordet nekas", !slapper("Zenobia-cyklar-hem", ZEN));
  ok("efternamnet ocksa", !slapper("Strandberg-i-regn", ZEN));
  ok("e-postens lokaldel ocksa", !slapper("zenobia-plockar-svamp", ZEN));
  ok("och domanen", !slapper("clicknet-ar-bast-har", ZEN));
  ok("felet pekar ut vilken bit som traffade",
    nekar("Zenobia-cyklar-hem", ZEN).some((f) => f.includes("zenobia")));

  // Utan profil ska samma ord ga igenom. Regeln ar personlig, inte allman.
  ok("samma ord utan profil slapper igenom", slapper("Zenobia-cyklar-hem"),
    nekar("Zenobia-cyklar-hem").join(" "));

  // Tva tecken ar for kort for att sparra pa. "Li" skulle annars ta halva
  // ordforradet med sig.
  ok("ett tvabokstavsnamn sparrar inte allt",
    slapper("blomstertid-nu-kommer", { fornamn: "Li", efternamn: "Bo" }),
    nekar("blomstertid-nu-kommer", { fornamn: "Li", efternamn: "Bo" }).join(" "));
}

console.log("\n\x1b[1mSamma som det gamla\x1b[0m");
{
  ok("byte till samma ord nekas",
    !slapper("valross-kajak-lyktstolpe", {}, "valross-kajak-lyktstolpe"));
  ok("och felet sager varfor",
    nekar("valross-kajak-lyktstolpe", {}, "valross-kajak-lyktstolpe")
      .some((f) => f.includes("samma som det gamla")));
  ok("ett annat ord gar bra", slapper("valross-kajak-lyktstolpe", {}, "nagot-helt-annat-har"));
}

console.log("\n\x1b[1mAlla fel visas, inte bara det forsta\x1b[0m");
{
  // Ett fel i taget ar en pina: man rattar langden, far veta att ordet star i
  // listan, rattar det, far veta att namnet star i det.
  const f = nekar("zenobia1", ZEN);
  ok("kort OCH personligt ger tva fel", f.length >= 2, `${f.length}: ${f.join(" | ")}`);
}

console.log("\n\x1b[1mDet tillfalliga losenordet duger som losenord\x1b[0m");
{
  // Annars vore flodet omojligt: chefen delar ut ett ord som systemet sjalv
  // skulle ha nekat.
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

  // Matet far ALDRIG anvandas till att slappa igenom. Ett starkt utseende ord
  // som star i sparrlistan ska falla anda.
  ok("ett 'starkt' ord ur sparrlistan nekas anda",
    styrka("Clicknet2026!!!") !== "svagt" && !slapper("Clicknet2026!!!"));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
