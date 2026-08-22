#!/usr/bin/env node
/**
 * E0.6: maskeringen, sokvagen och kons ordning.
 *
 *   node --experimental-strip-types tests/fel.mjs
 *
 * Att fel roll far 0 rader provas i tests/rls.mjs mot riktiga databasen.
 * Har provas det som ar ren strangbehandling — och det ar inte en detalj:
 * hela skalet att slappa in `admin` i felkon (0026) ar att `maskera()` tar
 * bort det som gor en teknisk text till en uppgift om en manniska. Faller
 * proven nedan faller ocksa den behorigheten.
 */
import {
  MAX_MEDDELANDE,
  maskera,
  maskeraOchKlipp,
  rensaSokvag,
  rubrikFor,
  sorteraKo,
} from "../src/lib/fel.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Maskeringen tar det som pekar ut en manniska");

// Det verkliga fallet: postgres skriver ut det krockande vardet i klartext.
const pgfel =
  'duplicate key value violates unique constraint "employee_email_key"\n' +
  "DETAIL: Key (email)=(anna.andersson@clicknet.se) already exists.";
const maskerat = maskera(pgfel);
ok("e-postadressen ur ett unikhetsfel forsvinner", !maskerat.includes("anna.andersson"), maskerat);
ok("men kolumnnamnet star kvar", maskerat.includes("(email)="), maskerat);
ok("och sjalva felet gar fortfarande att lasa", maskerat.includes("unique constraint"));

ok("fri e-postadress maskeras", maskera("kunde inte skicka till zen@clicknet.se") === "kunde inte skicka till [e-post]");
ok("personnummer med bindestreck maskeras", maskera("19850101-1234") === "[personnummer]");
ok("personnummer utan sekel maskeras", maskera("850101-1234") === "[personnummer]");
ok("personnummer utan bindestreck maskeras", maskera("198501011234") === "[personnummer]");
ok("samordningsnummer med plus maskeras", maskera("850101+1234") === "[personnummer]");
ok(
  "uuid maskeras",
  maskera("employee 3f2504e0-4f89-11d3-9a0c-0305e82c3301 saknas") === "employee [id] saknas",
);
ok("flera i samma text tas alla", maskera("a@b.se och c@d.se") === "[e-post] och [e-post]");

// Fel hall att fela at: hellre maskera nagot som inte behovde det.
ok("ett ordinarie tal rors inte", maskera("timeout efter 30000 ms") === "timeout efter 30000 ms");
ok("en vanlig sokvag rors inte", maskera("GET /franvaro/attest 500") === "GET /franvaro/attest 500");

ok("null ger null", maskera(null) === null);
ok("undefined ger null", maskera(undefined) === null);
ok("tom strang ger null", maskera("") === null);

rubrik("Klippet");
const lang = "x".repeat(MAX_MEDDELANDE + 500);
const klippt = maskeraOchKlipp(lang, MAX_MEDDELANDE);
ok("lang text klipps", klippt.length < lang.length);
ok("och markeras som klippt", klippt.endsWith("(klippt)"));
ok("kort text lamnas hel", maskeraOchKlipp("kort", MAX_MEDDELANDE) === "kort");
// Ordningen ar viktig: maskera FORST, klipp sedan. Klipps texten forst kan ett
// halvt personnummer overleva klippet och slippa undan maskeringen.
ok(
  "maskeringen sker fore klippet",
  !maskeraOchKlipp("19850101-1234 " + "y".repeat(50), 20).includes("19850101"),
);

rubrik("Sokvagen");
ok("query klipps bort", rensaSokvag("/sok?q=anna") === "/sok");
ok("fragment klipps bort", rensaSokvag("/rutiner#avsnitt-3") === "/rutiner");
ok("hel adress blir en sokvag", rensaSokvag("https://clicknet-nav.vercel.app/franvaro?x=1") === "/franvaro");
ok("tom ger roten", rensaSokvag("") === "/");
ok("null ger roten", rensaSokvag(null) === "/");
ok("sokvag utan inledande snedstreck far ett", rensaSokvag("franvaro") === "/franvaro");
// Utan det har blir varje besok pa en trasig detaljsida en egen rad i kon.
ok(
  "id i sokvagen grupperas ihop",
  rensaSokvag("/arenden/3f2504e0-4f89-11d3-9a0c-0305e82c3301") === "/arenden/:id",
);
ok(
  "tva olika id ger samma sokvag",
  rensaSokvag("/arenden/3f2504e0-4f89-11d3-9a0c-0305e82c3301") ===
    rensaSokvag("/arenden/11111111-2222-3333-4444-555555555555"),
);

rubrik("Kons ordning");
const rader = [
  { id: "gammal-blockerande", status: "new", blocking: true, last_seen_at: "2026-08-01T10:00:00Z" },
  { id: "ny-vanlig", status: "new", blocking: false, last_seen_at: "2026-08-21T10:00:00Z" },
  { id: "pagaende", status: "ack", blocking: true, last_seen_at: "2026-08-22T10:00:00Z" },
  { id: "avslutad", status: "closed", blocking: true, last_seen_at: "2026-08-22T12:00:00Z" },
];
const ko = sorteraKo(rader).map((r) => r.id);
ok("oatgardade fore pagaende fore avslutade", ko[3] === "avslutad" && ko[2] === "pagaende", ko.join(" > "));
// Ett fel som stoppade nagon gar fore ett farskare som ingen hindrades av.
ok("blockerande gar fore farskt", ko[0] === "gammal-blockerande", ko.join(" > "));

rubrik("Rubriken sager nagot aven nar navet inte har texten");
ok(
  "manuell rapport visar personens egna ord",
  rubrikFor({ kind: "manual", body: "Knappen gjorde ingenting\nrad tva", message: null, digest: null, path: "/x" }) ===
    "Knappen gjorde ingenting",
);
ok(
  "automatisk rapport visar meddelandet",
  rubrikFor({ kind: "automatic", body: null, message: "TypeError: x is not a function", digest: "abc", path: "/x" }) ===
    "TypeError: x is not a function",
);
// Fallet som gor att den har funktionen finns: i produktion har klienten bara
// en digest, och raden far inte bli tom.
ok(
  "utan meddelande visas sida och felkod",
  rubrikFor({ kind: "automatic", body: null, message: null, digest: "a1b2c3d4e5", path: "/franvaro" }) ===
    "Fel på /franvaro (a1b2c3d4)",
);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
