#!/usr/bin/env node
/**
 * Coachningsmodulen fas 1: laget, kvitteringen, paminnelsetrappan och mallarna.
 *
 *   node --experimental-strip-types tests/coachning.mjs
 *
 * Behorigheten provas mot riktiga databasen i tests/rls.mjs. Spärren som vägrar
 * en handkvittering på en självsann typ finns pa TVA stallen — triggern
 * `coaching_kvittens_vakt` i 0043 och `farKvittera()` har — och bada provas.
 */
import {
  ARENDE_EFTER_DAGAR,
  LARMGRANS_DAGAR,
  SJALVSANNA_TYPER,
  UPPGIFTSTYPER,
  TYP_KRAVER_KALLA,
  arSjalvsann,
  bevisSaknas,
  dagarKvar,
  dagarSedanCoachning,
  farAvbryta,
  farKvittera,
  forsenad,
  granskaMall,
  granskaMallpost,
  lageFor,
  laggTill,
  larmar,
  paminnelseFor,
  planera,
  sorteraLag,
} from "../src/lib/coachning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const NU = new Date("2026-09-01T12:00:00Z");
const dag = (d) => new Date(`2026-09-${String(d).padStart(2, "0")}T12:00:00Z`).toISOString();

const uppgift = (over = {}) => ({
  kind: "uppgift",
  assignee_id: "saljaren",
  partner_id: "teamledaren",
  created_by: "saljchefen",
  verify_by: "sjalv",
  evidence: "ingen",
  due_date: null,
  cancelled_at: null,
  ...over,
});

// =============================================================================
rubrik("Registret hanger ihop med databasen");

ok("sju uppgiftstyper", UPPGIFTSTYPER.length === 7);
ok("tre av dem ar sjalvsanna", SJALVSANNA_TYPER.length === 3);
ok("kurs ar sjalvsann", arSjalvsann("kurs"));
ok("rollspel_live ar det INTE", !arSjalvsann("rollspel_live"));

// Varje typ maste ha ett svar pa kallefragan, annars faller `granskaMallpost`
// tyst igenom for den typen.
ok(
  "varje typ har en post i kalleregistret",
  UPPGIFTSTYPER.every((t) => t in TYP_KRAVER_KALLA),
);

// =============================================================================
rubrik("Laget raknas fram ur historiken");

ok("utan handelser: ej paborjad", lageFor({ kind: "uppgift", handelser: [] }) === "ej_paborjad");
ok(
  "tilldelad ar inte paborjad",
  lageFor({ kind: "uppgift", handelser: [{ type: "tilldelad", at: dag(1) }] }) === "ej_paborjad",
);
ok(
  "paborjad ger pagar",
  lageFor({ kind: "uppgift", handelser: [{ type: "paborjad", at: dag(2) }] }) === "pagar",
);
ok(
  "inlamnad vantar pa kvittering",
  lageFor({ kind: "uppgift", handelser: [{ type: "inlamnad", at: dag(3) }] }) === "inlamnad",
);
ok(
  "kvitterad ger klar",
  lageFor({ kind: "uppgift", handelser: [{ type: "kvitterad", at: dag(4) }] }) === "klar",
);

// Loggen skrivs aldrig over. Den senaste raden galler, oavsett vilken ordning
// de kommer i — samma prov som rollspelet har.
ok(
  "senaste handelsen avgor aven om aldre kommer forst",
  lageFor({
    kind: "uppgift",
    handelser: [
      { type: "kvitterad", at: dag(2) },
      { type: "underkand", at: dag(5) },
    ],
  }) === "underkand",
);
ok(
  "en godkand efter en underkand galler",
  lageFor({
    kind: "uppgift",
    handelser: [
      { type: "underkand", at: dag(5) },
      { type: "kvitterad", at: dag(9) },
    ],
  }) === "klar",
);
ok(
  "avbruten slar allt",
  lageFor({
    kind: "uppgift",
    handelser: [{ type: "kvitterad", at: dag(9) }],
    cancelledAt: dag(10),
  }) === "avbruten",
);

rubrik("De sjalvsanna typerna laser sin kalla, inte loggen");

// Det har ar hela poangen med indelningen: en kvitterad-handelse pa en kurs far
// INTE gora kursen klar. Databasen vagrar rada, och rakningen ignorerar den.
ok(
  "en kurs utan certifikat ar inte klar ens med en kvitterad-handelse",
  lageFor({
    kind: "kurs",
    handelser: [{ type: "kvitterad", at: dag(9) }],
    kallanKlar: false,
  }) !== "klar",
);
ok(
  "en kurs med certifikat ar klar utan handelser",
  lageFor({ kind: "kurs", handelser: [], kallanKlar: true }) === "klar",
);
ok(
  "en pagaende kurs syns som pagaende",
  lageFor({ kind: "kurs", handelser: [{ type: "paborjad", at: dag(1) }], kallanKlar: false }) === "pagar",
);
ok(
  "en avbruten kurs ar avbruten aven om certifikatet finns",
  lageFor({ kind: "kurs", handelser: [], kallanKlar: true, cancelledAt: dag(2) }) === "avbruten",
);

// =============================================================================
rubrik("Forsening ar en andra uppgift om samma rad");

ok("utan frist aldrig forsenad", !forsenad("pagar", null, NU));
ok("frist i framtiden: inte forsenad", !forsenad("pagar", "2026-09-30", NU));
ok("frist passerad: forsenad", forsenad("pagar", "2026-08-20", NU));
ok("klar ar aldrig forsenad", !forsenad("klar", "2026-08-20", NU));
ok("avbruten ar aldrig forsenad", !forsenad("avbruten", "2026-08-20", NU));

// En uppgift kan vara BADE underkand OCH forsenad. Det ar skalet till att lage
// och forsening ar tva funktioner och inte ett sammanslaget varde.
ok("underkand OCH forsenad samtidigt", forsenad("underkand", "2026-08-20", NU));

// Fristen gar ut nar dagen ar slut. En uppgift som ska vara klar i dag far inte
// vara rod pa formiddagen.
ok("frist i dag ar inte forsenad pa formiddagen", !forsenad("pagar", "2026-09-01", NU));
ok("frist i gar ar forsenad", forsenad("pagar", "2026-08-31", NU));
ok("dagar kvar i dag ar 1, inte 0", dagarKvar("2026-09-01", NU) === 1);
ok("dagar kvar bakat blir negativt", dagarKvar("2026-08-25", NU) < 0);

// =============================================================================
rubrik("Vem far kvittera");

ok("sjalv: ansvarig far", farKvittera(uppgift({ verify_by: "sjalv" }), "saljaren", false));
ok("sjalv: ingen annan far", !farKvittera(uppgift({ verify_by: "sjalv" }), "teamledaren", false));
ok(
  "sjalv: inte ens chefen far kvittera at nagon annan",
  !farKvittera(uppgift({ verify_by: "sjalv" }), "saljchefen", true),
);
ok("motpart: motparten far", farKvittera(uppgift({ verify_by: "motpart" }), "teamledaren", false));
ok("motpart: ansvarig far inte", !farKvittera(uppgift({ verify_by: "motpart" }), "saljaren", false));
ok(
  "motpart utan motpart: ingen far",
  !farKvittera(uppgift({ verify_by: "motpart", partner_id: null }), "teamledaren", false),
);
ok("skapare: skaparen far", farKvittera(uppgift({ verify_by: "skapare" }), "saljchefen", false));
ok("chef: chefen far", farKvittera(uppgift({ verify_by: "chef" }), "vemsomhelst", true));
ok("chef: den utan chefsroll far inte", !farKvittera(uppgift({ verify_by: "chef" }), "saljaren", false));

// Sparren mot handkvittering av de sjalvsanna typerna ligger FORE
// behorighetsfragan. En chef med verify_by = 'chef' pa en kurs far anda inte.
for (const typ of SJALVSANNA_TYPER) {
  ok(
    `${typ} gar inte att kvittera for hand ens som chef`,
    !farKvittera(uppgift({ kind: typ, verify_by: "chef" }), "saljchefen", true),
  );
}

ok(
  "en avbruten uppgift kvitteras inte",
  !farKvittera(uppgift({ cancelled_at: dag(1) }), "saljaren", false),
);

rubrik("Nodutgangen: chefen far avbryta men aldrig godkanna");
ok("chefen far avbryta", farAvbryta(uppgift({ verify_by: "sjalv" }), "saljchefen", true));
ok("skaparen far avbryta", farAvbryta(uppgift({ verify_by: "sjalv" }), "saljchefen", false));
ok("ansvarig far inte avbryta sin egen", !farAvbryta(uppgift({ verify_by: "sjalv" }), "saljaren", false));
ok("en redan avbruten avbryts inte igen", !farAvbryta(uppgift({ cancelled_at: dag(1) }), "saljchefen", true));

rubrik("Beviset");
ok("inget bevis kravs", bevisSaknas("ingen", { kommentar: null, fil_id: null }) === null);
ok("kommentar kravs och saknas", bevisSaknas("kommentar", { kommentar: null, fil_id: null }) !== null);
ok("blanktecken raknas inte som kommentar", bevisSaknas("kommentar", { kommentar: "   ", fil_id: null }) !== null);
ok("kommentar finns", bevisSaknas("kommentar", { kommentar: "Gick bra", fil_id: null }) === null);
ok("fil kravs och saknas", bevisSaknas("fil", { kommentar: "text", fil_id: null }) !== null);
ok("fil finns", bevisSaknas("fil", { kommentar: null, fil_id: "f1" }) === null);

// =============================================================================
rubrik("Paminnelsetrappan 3 / 7 / 14");

const paminn = (over) =>
  paminnelseFor({ lage: "pagar", senasteRorelse: null, dueDate: null, nu: NU, ...over });

ok("fardig uppgift paminner aldrig", paminn({ lage: "klar", senasteRorelse: dag(1) }) === null);
ok("avbruten paminner aldrig", paminn({ lage: "avbruten", senasteRorelse: dag(1) }) === null);
ok("rord i gar: tyst", paminn({ senasteRorelse: "2026-08-31T12:00:00Z" }) === null);
ok("tre dygn stilla: personen", paminn({ senasteRorelse: "2026-08-29T12:00:00Z" }) === "person");
ok("sex dygn stilla: fortfarande personen", paminn({ senasteRorelse: "2026-08-26T12:00:00Z" }) === "person");
ok("sju dygn stilla: chefen", paminn({ senasteRorelse: "2026-08-25T12:00:00Z" }) === "chef");

// Overskridandet vager tyngst. En uppgift som rorde pa sig i gar men vars frist
// gick ut for tre veckor sedan ska ge ett arende, inte tystnad.
ok(
  "fjorton dagar over fristen ger arende aven om den rors",
  paminn({ senasteRorelse: "2026-08-31T12:00:00Z", dueDate: "2026-08-10" }) === "arende",
);
ok(
  "tretton dagar over fristen ar annu inte ett arende",
  paminn({ senasteRorelse: "2026-08-31T12:00:00Z", dueDate: "2026-08-20" }) !== "arende",
);
ok("gransen ar fjorton dagar", ARENDE_EFTER_DAGAR === 14);

// =============================================================================
rubrik("Lagvyn: dagar sedan coachning");

ok("aldrig coachad ger null", dagarSedanCoachning([], NU) === null);
ok("coachad i dag ger 0", dagarSedanCoachning([{ at: dag(1) }], NU) === 0);
ok("coachad for tio dagar sedan", dagarSedanCoachning([{ at: "2026-08-22T12:00:00Z" }], NU) === 10);
ok(
  "senaste raknas, inte forsta",
  dagarSedanCoachning([{ at: "2026-07-01T12:00:00Z" }, { at: "2026-08-30T12:00:00Z" }], NU) === 2,
);

ok("aldrig coachad larmar", larmar(null));
ok("trettio dagar larmar", larmar(LARMGRANS_DAGAR));
ok("tjugonio dagar larmar inte", !larmar(LARMGRANS_DAGAR - 1));

rubrik("Lagvyns ordning");
const lag = [
  { employee_id: "c", dagarSedan: 5, forsenade: 0, oppna: 2, namn: "Cecilia" },
  { employee_id: "a", dagarSedan: null, forsenade: 0, oppna: 0, namn: "Anna" },
  { employee_id: "b", dagarSedan: 40, forsenade: 2, oppna: 3, namn: "Bertil" },
  { employee_id: "d", dagarSedan: 5, forsenade: 0, oppna: 1, namn: "Ada" },
];
const sorterat = sorteraLag(lag, (r) => r.namn).map((r) => r.employee_id);
ok("forsenade forst", sorterat[0] === "b", sorterat.join(","));
ok("aldrig coachad narmast efter", sorterat[1] === "a");
ok("lika lange sedan sorteras alfabetiskt pa svenska", sorterat[2] === "d" && sorterat[3] === "c");
ok("sorteringen muterar inte in-listan", lag[0].employee_id === "c");

// =============================================================================
rubrik("Mallar: fristen ar relativ");

ok("noll dagar ger samma dag", laggTill("2026-09-01", 0) === "2026-09-01");
ok("sju dagar framat", laggTill("2026-09-01", 7) === "2026-09-08");
ok("over manadsskifte", laggTill("2026-08-28", 7) === "2026-09-04");
ok("over arsskifte", laggTill("2026-12-28", 7) === "2027-01-04");
// Datumet far inte glida en dag nar sommartiden slutar. Rakningen sker i UTC
// just for att undvika det.
ok("over sommartidens slut", laggTill("2026-10-24", 7) === "2026-10-31");

const post = (over = {}) => ({
  sort: 1,
  kind: "uppgift",
  title: "Ring tjugo bolag",
  description_md: "",
  verify_by: "sjalv",
  evidence: "ingen",
  offset_days: 0,
  course_id: null,
  module_id: null,
  document_id: null,
  focus_ids: [],
  ...over,
});

const planerat = planera(
  [post({ sort: 2, title: "Andra", offset_days: 14 }), post({ sort: 1, title: "Forsta", offset_days: 3 })],
  "2026-09-01",
);
ok("planerade poster kommer i sorteringsordning", planerat[0].title === "Forsta");
ok("forsta fristen raknas fran starten", planerat[0].due_date === "2026-09-04");
ok("andra fristen ocksa", planerat[1].due_date === "2026-09-15");

rubrik("Vad en mall inte far innehalla");
ok("post utan rubrik nekas", granskaMallpost(post({ title: "  " })) !== null);
ok("kurs utan kurs nekas", granskaMallpost(post({ kind: "kurs" })) !== null);
ok("kurs med kurs gar igenom", granskaMallpost(post({ kind: "kurs", course_id: "k1" })) === null);
ok("rollspel utan modul nekas", granskaMallpost(post({ kind: "rollspel_live" })) !== null);
ok("lasning utan dokument nekas", granskaMallpost(post({ kind: "lasning" })) !== null);

// Motparten ar okand forran mallen tillampas. Databasen nekar raden, sa den
// maste fangas har — annars faller hela tillampningen mitt i.
ok("verify_by = motpart nekas i en mall", granskaMallpost(post({ verify_by: "motpart" })) !== null);

// En sjalvsann typ med en annan kvitterare an sjalv ar en mall som lovar en
// bock som aldrig gar att satta.
ok(
  "sjalvsann typ med chefskvittering nekas",
  granskaMallpost(post({ kind: "kurs", course_id: "k1", verify_by: "chef" })) !== null,
);

ok("tom mall nekas", granskaMall([]) !== null);
ok("mall med ett fel nekas i sin helhet", granskaMall([post(), post({ kind: "kurs" })]) !== null);
ok("hel mall gar igenom", granskaMall([post(), post({ sort: 2, kind: "kurs", course_id: "k1" })]) === null);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
