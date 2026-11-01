#!/usr/bin/env node
/**
 * Granskningen F2-18: små missbruksvägar i rutter som sparar.
 *
 *   node --experimental-strip-types tests/nav2-missbruk.mjs
 *
 * Reglerna är rena funktioner (`pushvard.ts`, `malgrupp.ts`, `tak.ts`) och
 * provas direkt. Att rutterna faktiskt använder dem provas på källtexten, eftersom
 * rutterna drar in Next och databasen: provet faller om anropet tas bort.
 * Ingen databas, inget nätverk.
 */
import { readFileSync } from "node:fs";
import { arPushtjanst } from "../src/lib/nav2/pushvard.ts";
import { mottagarenFarLasa } from "../src/lib/nav2/malgrupp.ts";
import { FRAGOR_PER_DAG, SOKMISSAR_PER_MINUT, senasteMinuten, underTak } from "../src/lib/nav2/tak.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const kalla = (sokvag) => readFileSync(new URL(`../${sokvag}`, import.meta.url), "utf8");
/** Texten mellan `case "<namn>"` och nästa `case ` på samma nivå eller `default:`. */
const fall = (src, namn) => {
  const a = src.indexOf(`case "${namn}":`);
  if (a < 0) return "";
  const rest = src.slice(a + 5);
  const b = rest.search(/\n      (case "|default:)/);
  return b < 0 ? rest : rest.slice(0, b);
};

rubrik("(c) Push-adressen: bara pushtjänsternas värdar");
ok("Chrome/Android: fcm.googleapis.com", arPushtjanst("https://fcm.googleapis.com/fcm/send/abc:def"));
ok("Firefox: updates.push.services.mozilla.com", arPushtjanst("https://updates.push.services.mozilla.com/wpush/v2/gAAAA"));
ok("Safari: web.push.apple.com", arPushtjanst("https://web.push.apple.com/QOk3"));
ok("Apple underdomän: *.push.apple.com", arPushtjanst("https://api.sandbox.push.apple.com/3/device/x"));
ok("Edge/Windows: *.notify.windows.com", arPushtjanst("https://db5p.notify.windows.com/?token=abc"));
ok("en vanlig https-adress nekas", !arPushtjanst("https://example.com/hook"));
ok("intern adress nekas", !arPushtjanst("https://169.254.169.254/latest/meta-data/"));
ok("localhost nekas", !arPushtjanst("https://localhost/push"));
ok("http nekas även mot rätt värd", !arPushtjanst("http://fcm.googleapis.com/fcm/send/x"));
ok("värdnamn som bara slutar lika nekas (fcm.googleapis.com.evil.se)", !arPushtjanst("https://fcm.googleapis.com.evil.se/x"));
ok("värdnamn med pushtjänsten som prefix nekas (evilfcm.googleapis.com)", !arPushtjanst("https://evilfcm.googleapis.com/x"));
ok("evilpush.apple.com (ingen punkt före suffixet) nekas", !arPushtjanst("https://evilpush.apple.com/x"));
ok("bara suffixet utan underdomän nekas (notify.windows.com)", !arPushtjanst("https://notify.windows.com/x"));
ok("inloggningsuppgifter i adressen nekas", !arPushtjanst("https://fcm.googleapis.com@evil.se/x") && !arPushtjanst("https://user:pw@fcm.googleapis.com/x"));
ok("annan port nekas", !arPushtjanst("https://fcm.googleapis.com:8443/x"));
ok("inte en adress alls", !arPushtjanst("fcm.googleapis.com") && !arPushtjanst("") && !arPushtjanst(null) && !arPushtjanst(42));
ok("för lång adress nekas", !arPushtjanst("https://fcm.googleapis.com/" + "a".repeat(1000)));
{
  const hem = fall(kalla("src/app/nav2/hem/route.ts"), "push");
  ok("hem/route.ts: prenumerationen prövas mot pushtjänsterna när den sparas", /arPushtjanst\(endpoint\)/.test(hem));
  const push = kalla("src/lib/nav2/push.ts");
  const skicka = push.slice(push.indexOf("export async function skickaPush"));
  ok("push.ts: skickaPush prövar adressen före fetch", skicka.indexOf("arPushtjanst(endpoint)") > 0 && skicka.indexOf("arPushtjanst(endpoint)") < skicka.indexOf("fetch(endpoint"));
}

rubrik("(a) Skicka en rutin: bara ett publicerat dokument som mottagaren själv får läsa");
{
  const kollega = { id: "k1", status: "active", team_id: "t1", roller: ["salesperson"] };
  const pub = { status: "published", audience_roles: [], audience_teams: [], audience_employees: [] };
  ok("publicerat för alla: går", mottagarenFarLasa(pub, kollega));
  ok("utkast (redaktörens): går inte", !mottagarenFarLasa({ ...pub, status: "draft" }, kollega));
  ok("arkiverat: går inte", !mottagarenFarLasa({ ...pub, status: "archived" }, kollega));
  ok("mottagaren har slutat: går inte", !mottagarenFarLasa(pub, { ...kollega, status: "offboarded" }));
  ok("roll som mottagaren har: går", mottagarenFarLasa({ ...pub, audience_roles: ["salesperson"] }, kollega));
  ok("roll som mottagaren saknar: går inte", !mottagarenFarLasa({ ...pub, audience_roles: ["sales_manager"] }, kollega));
  ok("lag som mottagaren tillhör: går", mottagarenFarLasa({ ...pub, audience_teams: ["t1"] }, kollega));
  ok("lag som mottagaren inte tillhör: går inte", !mottagarenFarLasa({ ...pub, audience_teams: ["t2"] }, kollega));
  ok("mottagare utan lag mot ett lagsatt dokument: går inte", !mottagarenFarLasa({ ...pub, audience_teams: ["t2"] }, { ...kollega, team_id: null }));
  ok("roll OCH lag måste båda stämma", !mottagarenFarLasa({ ...pub, audience_roles: ["salesperson"], audience_teams: ["t2"] }, kollega));
  ok("riktat till utvalda personer: bara de", mottagarenFarLasa({ ...pub, audience_employees: ["k1"] }, kollega) && !mottagarenFarLasa({ ...pub, audience_employees: ["k9"] }, kollega));
  ok("personlistan går före roller och lag (som matches_audience)", mottagarenFarLasa({ ...pub, audience_roles: ["sales_manager"], audience_teams: ["t2"], audience_employees: ["k1"] }, kollega));
  ok("null i målgruppskolumnerna betyder alla", mottagarenFarLasa({ status: "published", audience_roles: null, audience_teams: null, audience_employees: null }, kollega));
  const src = kalla("src/app/nav2/rutiner/route.ts");
  const skicka = fall(src, "skicka");
  ok("rutiner/route.ts: skicka kräver publicerat", /status !== "published"/.test(skicka));
  ok("rutiner/route.ts: skicka prövar mottagarens läsrätt", /mottagarenFarLasa\(d,/.test(skicka));
  ok("rutiner/route.ts: dokumentet läses med målgruppskolumnerna", /\.select\("id, slug[^"]*audience_teams, audience_employees/.test(src));
}

rubrik("(b) Beskriv vad du gjorde: bara den som får se felrapporten");
{
  const beskriv = fall(kalla("src/app/nav2/fel/route.ts"), "beskriv");
  ok("fel/route.ts: beskriv hittar raden med den inloggades RLS", /await supabaseServer\(\)\)\s*\.from\("error_report"\)/.test(beskriv));
  ok("fel/route.ts: beskriv letar inte upp raden med service role", !/db\s*\.from\("error_report"\)\s*\.select/.test(beskriv));
}

rubrik("(d) Anonyma rader: tak per minut, räknat i databasen");
{
  // En attrapp av supabase-kedjan: from().select(kol, {count, head}).gte(kol, iso)
  const attrapp = (antal, fel = null) => {
    const anrop = [];
    return {
      anrop,
      from: (t) => ({ select: (k, o) => ({ gte: async (kol, v) => { anrop.push({ t, k, o, kol, v }); return { count: antal, error: fel }; } }) }),
    };
  };
  const nu = new Date("2026-11-01T10:00:00Z");
  const dag = { tabell: "nav_question_miss", kolumn: "dag", fran: "2026-11-01" };
  const a = attrapp(FRAGOR_PER_DAG - 1);
  ok("under taket: får skriva", (await underTak(a, dag, FRAGOR_PER_DAG)) === true);
  // nav_question_miss har ingen tidpunkt (q, week, dag, occurrences): räknas på dagen.
  ok("paletten räknar dagens frågor på kolumnen dag", a.anrop[0].kol === "dag" && a.anrop[0].v === "2026-11-01" && a.anrop[0].o.head === true);
  ok("på taket: får inte skriva", (await underTak(attrapp(FRAGOR_PER_DAG), dag, FRAGOR_PER_DAG)) === false);
  const b = attrapp(500);
  ok("över taket: får inte skriva", (await underTak(b, { tabell: "document_search_miss", kolumn: "searched_at", fran: senasteMinuten(nu) }, SOKMISSAR_PER_MINUT)) === false);
  ok("sökmissarna räknas senaste minuten", b.anrop[0].kol === "searched_at" && b.anrop[0].v === "2026-11-01T09:59:00.000Z");
  ok("databasfel: stängt (statistik, hellre tappad än översvämmad)", (await underTak(attrapp(null, { message: "x" }), dag, 60)) === false);
  ok("taken", FRAGOR_PER_DAG === 1000 && SOKMISSAR_PER_MINUT === 60);
  ok("paletten räknar inte på en kolumn som saknas (first_seen)", !/first_seen/.test(kalla("src/app/nav2/paletten/route.ts")));
  const pal = fall(kalla("src/app/nav2/paletten/route.ts"), "fraga");
  ok("paletten/route.ts: fraga prövar taket före registrera_fragemiss", pal.indexOf("underTak(") > 0 && pal.indexOf("underTak(") < pal.indexOf("registrera_fragemiss"));
  ok("paletten/route.ts: över taket svarar 429", /429/.test(pal));
  const sok = fall(kalla("src/app/nav2/rutiner/route.ts"), "sok");
  ok("rutiner/route.ts: sok prövar taket före insert i document_search_miss", sok.indexOf("underTak(") > 0 && sok.indexOf("underTak(") < sok.indexOf('from("document_search_miss").insert'));
}

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
