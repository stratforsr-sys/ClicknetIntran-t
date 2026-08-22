#!/usr/bin/env node
/**
 * E9.1: renderingen av en avtalsmall.
 *
 *   node --experimental-strip-types tests/avtal.mjs
 *
 * Att fel roll far 0 rader provas i tests/rls.mjs. Har provas det som avgor om
 * ett dokument gar att skriva under: att en platshallare aldrig kan bli en tom
 * rad i ett anstallningsavtal.
 */
import {
  VARIABELNYCKLAR,
  AvtalsfelError,
  hittaPlatshallare,
  okandaPlatshallare,
  rendera,
  serUtSomPersonnummer,
  tillSlug,
  trasigaKlamrar,
} from "../src/lib/avtal.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const kastar = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

rubrik("Platshallare hittas");
ok("en enkel nyckel hittas", hittaPlatshallare("Hej {{fornamn}}")[0] === "fornamn");
ok("mellanslag inuti klamrarna tillats", hittaPlatshallare("{{ fornamn }}")[0] === "fornamn");
ok("versaler normaliseras", hittaPlatshallare("{{Fornamn}}")[0] === "fornamn");
ok(
  "samma nyckel tva ganger raknas en gang",
  hittaPlatshallare("{{fornamn}} och {{fornamn}}").length === 1,
);
ok("text utan platshallare ger tom lista", hittaPlatshallare("Vanlig text").length === 0);

rubrik("Okanda och trasiga falt stoppas nar mallen sparas");
ok("okand nyckel hittas", okandaPlatshallare("{{lon}}")[0] === "lon");
ok("kand nyckel slapps igenom", okandaPlatshallare("{{manadslon}}").length === 0);
// Fallet som annars star kvar ordagrant i det underskrivna dokumentet.
ok("halv klammer upptacks", trasigaKlamrar("{{manadslon}") === true);
ok("hel klammer ar inte trasig", trasigaKlamrar("{{manadslon}}") === false);
ok("text utan klamrar ar inte trasig", trasigaKlamrar("vanlig text") === false);

rubrik("Renderingen byter ut varden");
const mall = "# Avtal\n\n{{fornamn}} {{efternamn}} anstalls som {{befattning}}.\nLon: {{manadslon}} kr.";
const varden = {
  fornamn: "Anna",
  efternamn: "Andersson",
  befattning: "Säljare",
  manadslon: "32000",
};
const ut = rendera(mall, varden);
ok("namnet hamnar i texten", ut.includes("Anna Andersson"));
ok("lonen hamnar i texten", ut.includes("32000 kr"));
ok("inga klamrar star kvar", !ut.includes("{{"), ut);
ok("mellanslag i vardet trimmas", rendera("{{befattning}}", { befattning: "  Säljare  " }) === "Säljare");
ok(
  "samma nyckel byts ut pa alla stallen",
  rendera("{{fornamn}} och {{fornamn}}", { fornamn: "Anna" }) === "Anna och Anna",
);

rubrik("EN OFYLLD PLATSHALLARE RENDERAS ALDRIG SOM TOMT");
// Hela skalet att src/lib/avtal.ts finns. Ett avtal dar lonen blev en tom rad
// ar ett dokument som gar att skriva under.
{
  const e = kastar(() => rendera(mall, { ...varden, manadslon: "" }));
  ok("tomt varde kastar", e instanceof AvtalsfelError);
  ok("och sager vilket falt som saknas", e?.saknade?.includes("manadslon"), String(e?.saknade));
}
{
  const e = kastar(() => rendera(mall, { ...varden, manadslon: "   " }));
  ok("bara mellanslag raknas som tomt", e instanceof AvtalsfelError);
}
{
  const e = kastar(() => rendera(mall, { fornamn: "Anna" }));
  ok("flera saknade falt listas alla", (e?.saknade?.length ?? 0) === 3, String(e?.saknade));
}
{
  const e = kastar(() => rendera("{{lon}}", { lon: "32000" }));
  ok("en okand nyckel renderas inte ens med ett varde", e instanceof AvtalsfelError);
  ok("och pekas ut som okand", e?.okanda?.includes("lon"));
}
// Ett medvetet tomt varde skrivs som ett streck. Skillnaden mellan "inte
// ifyllt" och "galler inte" ska finnas i datan.
ok(
  "ett streck ar ett giltigt varde",
  rendera("{{provanstallning}}", { provanstallning: "-" }) === "-",
);

rubrik("Personnummer");
ok("personnummer med sekel kanns igen", serUtSomPersonnummer("19850101-1234"));
ok("utan sekel kanns igen", serUtSomPersonnummer("850101-1234"));
ok("utan bindestreck kanns igen", serUtSomPersonnummer("198501011234"));
ok("mitt i en mening kanns igen", serUtSomPersonnummer("Anna, 850101-1234, anstalls"));
ok("ett vanligt belopp ar inget personnummer", !serUtSomPersonnummer("32000"));
ok("ett datum ar inget personnummer", !serUtSomPersonnummer("2026-08-22"));

rubrik("Faltlistan");
ok("uppsagningstid finns som falt (E7.16)", VARIABELNYCKLAR.includes("uppsagningstid"));
// Skulle nagon lagga till det som variabel faller provet, och samtalet om
// K27-linjen tas medvetet i stallet for av misstag.
ok("det finns inget falt for personnummer", !VARIABELNYCKLAR.some((n) => n.includes("personnummer")));
ok("inga dubbletter i listan", new Set(VARIABELNYCKLAR).size === VARIABELNYCKLAR.length);

rubrik("Slug");
ok("rubriken blir en adress", tillSlug("Anställningsavtal, tillsvidare") === "anstallningsavtal-tillsvidare");
ok("tom rubrik ger ett varde anda", tillSlug("") === "mall");

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
