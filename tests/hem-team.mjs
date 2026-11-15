#!/usr/bin/env node
/**
 * Hemvyn (steg 2): talen i Teamet i månaden (hemforma.ts). Ren del, ingen databas.
 *
 * Kortets stora tal är det säkra: nettoorder (samma `nettoAntal` som provisionens trappa) mot summan av
 * personernas mål. Väntande order står som antal, makulerade bredvid. Saknar någon ett mål sägs det.
 *
 *   TZ=UTC node --experimental-strip-types tests/hem-team.mjs
 */
import { teamTal, dagstalPerManad, blevPerManad, teamPersoner, taktKrets } from "../src/lib/nav2/hemforma.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const A = "a", B = "b", C = "c", UTE = "ute";
let lopnr = 0;
const order = (salj, dag, o = {}) => ({
  id: `o${++lopnr}`, salesperson_id: salj, status: "signerad", signed_on: dag, period_month: `${dag.slice(0, 7)}-01`,
  cancelled_on: null, cancel_period_month: null, ...o,
});
const makulerad = (salj, dag, makDag) => order(salj, dag, { status: "makulerad", cancelled_on: makDag, cancel_period_month: `${makDag.slice(0, 7)}-01` });

const ORDER = [
  order(A, "2026-11-03"), order(A, "2026-11-10"), order(B, "2026-11-12", { status: "betald" }),
  order(B, "2026-11-13", { status: "inskickad" }),           // väntar på godkännande
  order(C, "2026-11-13", { status: "utkast" }),              // ett utkast räknas aldrig
  makulerad(A, "2026-10-05", "2026-11-04"),                  // signerad i oktober, makulerad i november
  makulerad(B, "2026-11-05", "2026-11-06"),                  // signerad och makulerad i november
  order(UTE, "2026-11-09"),                                  // någon utanför kretsen
  order(A, "2026-10-20"),                                    // förra månaden
];
const MAL = [{ employee_id: A, target_orders: 10 }, { employee_id: C, target_orders: 6 }, { employee_id: UTE, target_orders: 99 }];

console.log("\n\x1b[1mTeamets tal i månaden\x1b[0m");
{
  const t = teamTal(ORDER, MAL, [A, B, C], "2026-11");
  lika("netto: signerade i månaden minus makulerade i månaden", t.netto, 2);   // A 2 + B 1 betald + B 1 (signerad, sedan makulerad) = 4, minus 2 makulerade
  lika("väntande: inskickade, inte utkast", t.vantar, 1);
  lika("makulerade i månaden, oavsett när de signerades", t.makulerade, 2);
  lika("målet är summan av kretsens mål", t.mal, 16);
  lika("B har order men inget mål", t.utanMal, 1);
}
lika("hela företaget (krets null) räknar alla", teamTal(ORDER, MAL, null, "2026-11"), { netto: 3, vantar: 1, makulerade: 2, mal: 115, utanMal: 1 });
lika("ingen har ett mål: inget mål, och ingen saknar något", teamTal(ORDER, [], [A, B, C], "2026-11"), { netto: 2, vantar: 1, makulerade: 2, mal: null, utanMal: 0 });
lika("ett mål utan antal order räknas inte", teamTal(ORDER, [{ employee_id: A, target_orders: null }], [A, B], "2026-11").mal, null);
lika("en månad utan order", teamTal(ORDER, MAL, [A, B, C], "2026-12"), { netto: 0, vantar: 0, makulerade: 0, mal: 16, utanMal: 0 });
lika("fler makulerade än signerade ger ett negativt netto", teamTal([makulerad(A, "2026-09-01", "2026-11-02")], [], [A], "2026-11").netto, -1);
lika("en tom krets har ingenting", teamTal(ORDER, MAL, [], "2026-11"), { netto: 0, vantar: 0, makulerade: 0, mal: null, utanMal: 0 });

console.log("\n\x1b[1mDagstalen bakom taktens facit\x1b[0m");
{
  const d = dagstalPerManad(ORDER, [A, B, C]);
  lika("november: plus på signeringsdagen, minus på makuleringsdagen", d["2026-11"], { "2026-11-03": 1, "2026-11-10": 1, "2026-11-12": 1, "2026-11-04": -1, "2026-11-05": 1, "2026-11-06": -1 });
  lika("oktober: den senare makulerade ordern räknas den dag den signerades", d["2026-10"], { "2026-10-05": 1, "2026-10-20": 1 });
  lika("utkast och inskickade ger inga dagstal", Object.values(d["2026-11"]).reduce((s, n) => s + n, 0), 2);
  lika("månadens slutliga netto, per månad", blevPerManad(ORDER, [A, B, C], ["2026-10", "2026-11"]), { "2026-10": 2, "2026-11": 2 });
}

console.log("\n\x1b[1mEn rad per person\x1b[0m");
{
  const TZ = "Europe/Stockholm";
  const mote = (id, o) => ({ id, kedja: `k${id}`, bokatAv: A, hallsAv: B, bokatNar: "2026-11-02T09:00:00Z", moteTid: "2026-11-10T09:00:00Z", art: "ny", utfall: null, resultat: null, kalla: "x", ...o });
  const moten = [
    mote("m1", { utfall: "hallet" }), mote("m2", { utfall: "uteblev" }), mote("m3", { utfall: "avbokat" }), mote("m4", {}),
    mote("m5", { art: "uppfoljning", utfall: "hallet" }),                              // uppföljningsmöten räknas inte
    mote("m6", { bokatNar: "2026-10-28T09:00:00Z", utfall: "hallet" }),                // bokat i oktober, hållet i november
    mote("m7", { bokatNar: "2026-11-30T23:30:00Z", moteTid: "2026-12-03T09:00:00Z" }), // bokat 1 dec svensk tid
    mote("m8", { bokatAv: C, hallsAv: C, utfall: "hallet" }),
  ];
  const p = teamPersoner([{ id: B, namn: "Bea" }, { id: A, namn: "Åke" }, { id: C, namn: "Carl" }, { id: "d", namn: "Disa" }], moten, ORDER, "2026-11", TZ);
  lika("i bokstavsordning, svensk sortering", p.map((x) => x.namn), ["Bea", "Carl", "Disa", "Åke"]);
  lika("Åke bokade fyra första möten i november", p.find((x) => x.id === A), { id: A, namn: "Åke", bokade: 4, hallna: 0, uteblivna: 0, order: 1 });
  lika("Bea höll två och ett uteblev (avbokade och möten utan utfall räknas inte)", p.find((x) => x.id === B), { id: B, namn: "Bea", bokade: 0, hallna: 2, uteblivna: 1, order: 1 });
  lika("Carl bokade och höll sitt eget", p.find((x) => x.id === C), { id: C, namn: "Carl", bokade: 1, hallna: 1, uteblivna: 0, order: 0 });
  lika("den som inte gjort något står med nollor", p.find((x) => x.id === "d"), { id: "d", namn: "Disa", bokade: 0, hallna: 0, uteblivna: 0, order: 0 });
}

console.log("\n\x1b[1mVilken sparad takt som hör till läsaren\x1b[0m");
lika("den som ser alla läser takten för alla", taktKrets(null, "lag-1"), "alla");
lika("teamledaren läser sitt lags takt", taktKrets(["a", "b"], "lag-1"), "lag-1");
lika("utan lag finns ingen sparad takt", taktKrets(["a", "b"], null), null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
