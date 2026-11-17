#!/usr/bin/env node
/**
 * Hemvyn (steg 1): måttregistret. Alla tal som hemvyn visar, dömer eller låter
 * AI:n läsa går genom registret (designdokumentet 1.1).
 *
 * Underlaget är ett och samma för alla mötesmått: första möten (ny eller
 * ombokning) med mötestid i perioden och med ett utfall. Ett möte utan utfall
 * räknas inte i något mått.
 *
 *   TZ=UTC node --experimental-strip-types tests/matt.mjs
 */
import { MATT, mattMoten, bokadePerVecka } from "../src/lib/nav2/matt.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const V = { fran: "2026-11-09", till: "2026-11-15" };
const m = (id, o) => ({
  id, kedja: `k-${id}`, bokatAv: "mick", hallsAv: "edvin", bokatNar: "2026-11-05T10:00:00Z", moteTid: "2026-11-10T10:00:00Z",
  art: "ny", utfall: null, resultat: null, kalla: "dialer", bekraftatNar: null, ...o,
});
const M = [
  m("f1", { art: "uppfoljning", utfall: "hallet", moteTid: "2026-11-09T09:00:00Z" }),
  m("x1", { moteTid: "2026-11-09T10:00:00Z" }),
  m("h1", { utfall: "hallet", moteTid: "2026-11-10T10:00:00Z", bekraftatNar: "2026-11-09T12:00:00Z" }),
  m("h2", { art: "ombokning", utfall: "hallet", moteTid: "2026-11-11T10:00:00Z" }),
  m("u1", { utfall: "uteblev", moteTid: "2026-11-12T10:00:00Z" }),
  m("a1", { utfall: "avbokat", moteTid: "2026-11-13T10:00:00Z", bekraftatNar: "2026-11-12T08:00:00Z" }),
];

console.log("\n\x1b[1mMötesmåtten\x1b[0m");
lika("uteblivna", mattMoten("moten.uteblivna", M, V, null), { n: 1, av: 3, bakom: ["h1", "h2", "u1"] });
lika("hållna av alla", mattMoten("moten.hallna-av-alla", M, V, null), { n: 2, av: 4, bakom: ["h1", "h2", "u1", "a1"] });
lika("bekräftade", mattMoten("moten.bekraftade", M, V, null), { n: 2, av: 4, bakom: ["h1", "h2", "u1", "a1"] });
lika("en bekräftelse efter mötet räknas inte", mattMoten("moten.bekraftade", [m("s1", { utfall: "hallet", bekraftatNar: "2026-11-10T11:00:00Z" })], V, null).n, 0);
lika("raderna står i mötestidsordning", mattMoten("moten.uteblivna", [...M].reverse(), V, null).bakom, ["h1", "h2", "u1"]);

console.log("\n\x1b[1mPeriod och krets\x1b[0m");
lika("utanför perioden", mattMoten("moten.uteblivna", [m("g1", { utfall: "uteblev", moteTid: "2026-11-16T10:00:00Z" })], V, null).av, 0);
lika("svensk dag: 23.30 UTC på söndagen är måndag", mattMoten("moten.uteblivna", [m("n1", { utfall: "uteblev", moteTid: "2026-11-08T23:30:00Z" })], V, null).av, 1);
lika("utan period räknas allt", mattMoten("moten.uteblivna", [m("g1", { utfall: "uteblev", moteTid: "2026-12-16T10:00:00Z" })], null, null).av, 1);
lika("krets utan personen", mattMoten("moten.uteblivna", M, V, ["annan"]).av, 0);
lika("den som håller mötet äger det", mattMoten("moten.uteblivna", M, V, ["edvin"]).av, 3);
lika("den som bokade äger det också", mattMoten("moten.uteblivna", M, V, ["mick"]).av, 3);

console.log("\n\x1b[1mBokade per vecka\x1b[0m");
lika("fyra första möten bokade på en vecka", bokadePerVecka([m("b1", {}), m("b2", {}), m("b3", { art: "ombokning" }), m("b4", {}), m("b5", { art: "uppfoljning" })], { fran: "2026-11-02", till: "2026-11-08" }, null), 4);
lika("två veckor", bokadePerVecka([m("b1", {}), m("b2", {}), m("b3", {})], { fran: "2026-10-26", till: "2026-11-08" }, null), 1.5);
lika("inga bokade", bokadePerVecka([], { fran: "2026-11-02", till: "2026-11-08" }, null), 0);

console.log("\n\x1b[1mRegistret\x1b[0m");
lika("motvikten till uteblivna", MATT["moten.uteblivna"].motvikt, "moten.hallna-av-alla");
lika("bättre håll för uteblivna", MATT["moten.uteblivna"].battre, "ned");
lika("nettoorder är ett antal", MATT["order.netto"].sort, "antal");
lika("nettoorder vägs mot makulerade", MATT["order.netto"].motvikt, "order.makulerade");
lika("frasen i domen Bättre, men …", MATT["moten.hallna-av-alla"].samre, "färre möten hålls");
for (const [nyckel, x] of Object.entries(MATT)) {
  ok(`${nyckel}: nyckeln stämmer`, x.nyckel === nyckel);
  ok(`${nyckel}: har en version`, Number.isInteger(x.version) && x.version >= 1);
  ok(`${nyckel}: har en fras för när det blivit sämre`, typeof x.samre === "string" && x.samre.length > 5 && !x.samre.endsWith("."));
  ok(`${nyckel}: har en motvikt som finns`, x.motvikt !== null && x.motvikt in MATT);
  ok(`${nyckel}: säger vad det räknar och vad det inte ser`, x.text.length > 10 && x.serInte.length > 10);
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
