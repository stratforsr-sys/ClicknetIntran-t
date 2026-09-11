#!/usr/bin/env node
/**
 * Uppgiftsmodulen pass 1: laget, ordningen, kretsen och snabbinmatningen.
 *
 *   node --experimental-strip-types tests/uppgifter.mjs
 *
 * Behorigheten provas mot riktiga databasen i tests/rls.mjs. TOLKEN ar det som
 * far mest utrymme har, och det ar inte av karlek till reguljara uttryck: den
 * ar den enda delen av modulen dar ett fel INTE syns. En trasig knapp marks; en
 * tolk som last "ring 20 bolag" som klockan 20 lagger tyst en frist ingen bad
 * om, och raden ser riktig ut i listan efterat.
 */
import {
  HANDELSETYPER,
  LAGEN,
  LAGE_ETIKETT,
  LAGE_TON,
  MEDLEMSROLLER,
  PRIORITETER,
  PRIORITET_ETIKETT,
  ROLL_ETIKETT,
  ROLL_FORKLARING,
  arStangd,
  dagarMellan,
  datumPlusDagar,
  farArbeta,
  farBjudaIn,
  farGranska,
  farRedigera,
  forsenad,
  fristtext,
  lageAv,
  sorteraUppgifter,
  tidstext,
  tolkaSnabbrad,
  veckodag,
  visaPrioritet,
} from "../src/lib/uppgifter.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** En fredag. Valt med flit: veckodagsproven behover en dag mitt i veckan. */
const IDAG = "2026-09-11";

const rad = (over = {}) => ({
  id: "a",
  title: "Ring Nordic",
  assignee_id: "jag",
  created_by: "jag",
  project_id: null,
  parent_id: null,
  due_date: null,
  due_time: null,
  starts_on: null,
  estimate_minutes: null,
  priority: 3,
  lage: "ej_paborjad",
  granskare: 0,
  ...over,
});

// =============================================================================
rubrik("Registren hanger ihop");

ok("fyra prioriteter", PRIORITETER.length === 4);
ok("varje prioritet har en etikett", PRIORITETER.every((p) => PRIORITET_ETIKETT[p]));
ok("bara de tva hogsta visas", visaPrioritet(1) && visaPrioritet(2) && !visaPrioritet(3) && !visaPrioritet(4));

ok("tre medlemsroller", MEDLEMSROLLER.length === 3);
ok("varje roll har etikett och forklaring", MEDLEMSROLLER.every((r) => ROLL_ETIKETT[r] && ROLL_FORKLARING[r]));

ok("sex lagen", LAGEN.length === 6);
ok("varje lage har etikett och ton", LAGEN.every((l) => LAGE_ETIKETT[l] && LAGE_TON[l]));
ok("tio handelsetyper", HANDELSETYPER.length === 10);

// =============================================================================
rubrik("Laget raknas fram ur historiken");

ok("utan handelser: ej paborjad", lageAv([]) === "ej_paborjad");
ok("skapad", lageAv([{ type: "skapad" }]) === "ej_paborjad");
ok("paborjad", lageAv([{ type: "skapad" }, { type: "paborjad" }]) === "pagar");
ok("inlamnad vantar pa granskaren", lageAv([{ type: "paborjad" }, { type: "inlamnad" }]) === "granskas");
ok("godkand ar klar", lageAv([{ type: "inlamnad" }, { type: "godkand" }]) === "klar");
ok("klar utan granskare ar ocksa klar", lageAv([{ type: "klar" }]) === "klar");
ok("returnerad oppnar igen", lageAv([{ type: "inlamnad" }, { type: "returnerad" }]) === "returnerad");
ok(
  "en andra inlamning efter retur vantar igen",
  lageAv([{ type: "inlamnad" }, { type: "returnerad" }, { type: "inlamnad" }]) === "granskas",
);
ok("ateroppnad tar tillbaka en klar", lageAv([{ type: "klar" }, { type: "ateroppnad" }]) === "ej_paborjad");
ok("avbruten", lageAv([{ type: "paborjad" }, { type: "avbruten" }]) === "avbruten");

// Det har ar sjalva skalet att loggen bar laget och inte en kolumn.
ok(
  "en kommentar pa en klar uppgift gor den inte ogjord",
  lageAv([{ type: "klar" }, { type: "kommentar" }]) === "klar",
);
ok(
  "att byta ansvarig mitt i arbetet avbryter inte det",
  lageAv([{ type: "paborjad" }, { type: "tilldelad" }]) === "pagar",
);

ok("klar och avbruten ar stangda", arStangd("klar") && arStangd("avbruten"));
ok("returnerad ar det INTE", !arStangd("returnerad"));

// =============================================================================
rubrik("Frister");

ok("utan frist ar inget forsenat", !forsenad(rad(), IDAG));
ok("gardagens frist ar forsenad", forsenad(rad({ due_date: "2026-09-10" }), IDAG));
ok("dagens frist ar det inte", !forsenad(rad({ due_date: IDAG }), IDAG));
ok(
  "en KLAR uppgift med passerad frist ar inte forsenad",
  !forsenad(rad({ due_date: "2026-09-01", lage: "klar" }), IDAG),
);

ok("idag", fristtext(IDAG, IDAG) === "Idag");
ok("i morgon", fristtext("2026-09-12", IDAG) === "I morgon");
ok("i gar", fristtext("2026-09-10", IDAG) === "I går");
ok("tre dagar sen", fristtext("2026-09-08", IDAG) === "3 dagar sen");
ok("inom veckan far veckodag", fristtext("2026-09-15", IDAG) === "tis 15 sep");
ok("langre bort far bara datum", fristtext("2026-10-20", IDAG) === "20 okt");
ok("utan frist: ingen text", fristtext(null, IDAG) === null);

ok("30 min", tidstext(30) === "30 min");
ok("en timme", tidstext(60) === "1 h");
ok("en och en halv", tidstext(90) === "1 h 30 min");
ok("noll ar ingen tid", tidstext(0) === null && tidstext(null) === null);

// =============================================================================
rubrik("Ordningen i listan");

const listan = sorteraUppgifter(
  [
    rad({ id: "senare", due_date: "2026-09-20" }),
    rad({ id: "klar", due_date: "2026-09-01", lage: "klar" }),
    rad({ id: "odaterad", priority: 1 }),
    rad({ id: "idag", due_date: IDAG }),
    rad({ id: "forsenad", due_date: "2026-09-05" }),
  ],
  IDAG,
);
ok("forsenat forst", listan[0].id === "forsenad");
ok("sedan dagens", listan[1].id === "idag");
ok("sedan kommande", listan[2].id === "senare");
ok("odaterat efter det som har en dag", listan[3].id === "odaterad");
ok("klart sist", listan[4].id === "klar");

const sammaDag = sorteraUppgifter(
  [
    rad({ id: "lag", due_date: IDAG, priority: 4 }),
    rad({ id: "hog", due_date: IDAG, priority: 1 }),
    rad({ id: "tidig", due_date: IDAG, due_time: "08:00", priority: 4 }),
  ],
  IDAG,
);
ok("klockslag gar fore prioritet samma dag", sammaDag[0].id === "tidig");
ok("prioritet skiljer resten", sammaDag[1].id === "hog");

// =============================================================================
rubrik("Kretsen");

const krets = (over = {}) => ({ mig: "jag", assignee_id: "jag", created_by: "jag", minRoll: null, ...over });

ok("skaparen far redigera", farRedigera(krets({ assignee_id: "annan" })));
ok("den ansvariga far redigera", farRedigera(krets({ created_by: "annan" })));
ok("en redigerare far redigera", farRedigera(krets({ assignee_id: "a", created_by: "b", minRoll: "redigerare" })));
ok("en visare far INTE redigera", !farRedigera(krets({ assignee_id: "a", created_by: "b", minRoll: "visare" })));
ok("en utomstaende far inte", !farRedigera(krets({ assignee_id: "a", created_by: "b" })));

ok(
  "en redigerare far INTE bjuda in fler",
  !farBjudaIn(krets({ assignee_id: "a", created_by: "b", minRoll: "redigerare" })),
);
ok("skaparen far bjuda in", farBjudaIn(krets({ assignee_id: "annan" })));

ok("bara granskaren granskar", farGranska(krets({ minRoll: "granskare" })));
ok("skaparen granskar inte av att vara skapare", !farGranska(krets()));
ok("en redigerare granskar inte", !farGranska(krets({ minRoll: "redigerare" })));
ok("den som far redigera far arbeta", farArbeta(krets()));

// =============================================================================
rubrik("Datumrakning");

ok("fredag ar dag 5", veckodag("2026-09-11") === 5);
ok("sondag ar dag 7", veckodag("2026-09-13") === 7);
ok("mandag ar dag 1", veckodag("2026-09-14") === 1);
ok("plus ett dygn", datumPlusDagar(IDAG, 1) === "2026-09-12");
ok("over manadsskiftet", datumPlusDagar("2026-09-30", 1) === "2026-10-01");
ok("over arsskiftet", datumPlusDagar("2026-12-31", 1) === "2027-01-01");
ok("bakat", datumPlusDagar("2026-03-01", -1) === "2026-02-28");
ok("mellanrum", dagarMellan("2026-09-11", "2026-09-14") === 3);

// Sommartidsskiftet: 29 mars 2026 ar en sondag med 23 timmar. Rakningen sker i
// hela kalenderdygn och far inte tappa en dag dar.
ok("over sommartidsskiftet", datumPlusDagar("2026-03-28", 2) === "2026-03-30");
ok("och tillbaka", dagarMellan("2026-03-28", "2026-03-30") === 2);

// =============================================================================
rubrik("Snabbinmatningen — det som ska kannas igen");

const t = (text) => tolkaSnabbrad(text, IDAG);

ok("bara en rubrik", t("Ring Nordic AB").titel === "Ring Nordic AB");
ok("och inget annat satts", t("Ring Nordic AB").due_date === null && t("Ring Nordic AB").priority === 3);

const full = t("Ring Nordic AB på tisdag 14:00 30 min !1 #Mässan @Anna");
ok("titeln blir det som blev over", full.titel === "Ring Nordic AB", full.titel);
ok("tisdag efter en fredag ar den 15:e", full.due_date === "2026-09-15", String(full.due_date));
ok("klockslaget", full.due_time === "14:00");
ok("langden", full.estimate_minutes === 30);
ok("prioriteten", full.priority === 1);
ok("projektet", full.projekt === "Mässan");
ok("personen", full.person === "Anna");

rubrik("Snabbinmatningen — datumen");
ok("idag", t("Skriv offert idag").due_date === IDAG);
ok("i dag sarskrivet", t("Skriv offert i dag").due_date === IDAG);
ok("imorgon", t("Skriv offert imorgon").due_date === "2026-09-12");
ok("i morgon sarskrivet", t("Skriv offert i morgon").due_date === "2026-09-12");
ok("overmorgon", t("Skriv offert övermorgon").due_date === "2026-09-13");
ok("samma veckodag som idag betyder idag", t("Skriv offert fredag").due_date === IDAG);
ok("nasta fredag ar en vecka fram", t("Skriv offert nästa fredag").due_date === "2026-09-18");
ok("pa mandag", t("Skriv offert på måndag").due_date === "2026-09-14");
ok("om tre dagar", t("Skriv offert om 3 dagar").due_date === "2026-09-14");
ok("om en vecka", t("Skriv offert om en vecka").due_date === "2026-09-18");
ok("nasta vecka blir mandagen", t("Skriv offert nästa vecka").due_date === "2026-09-14");
ok("utskrivet datum", t("Skriv offert 2026-12-01").due_date === "2026-12-01");
ok("svensk kortform dag/manad", t("Skriv offert 3/10").due_date === "2026-10-03");
ok("kortform med ar", t("Skriv offert 3/10-27").due_date === "2027-10-03");
ok("passerat datum utan ar menas nasta ar", t("Skriv offert 3/1").due_date === "2027-01-03");

rubrik("Snabbinmatningen — tiden och langden");
ok("kl utan kolon", t("Möte imorgon kl 9").due_time === "09:00");
ok("kl med punkt", t("Möte imorgon 14.30").due_time === "14:30");
ok("timmar", t("Djuparbete imorgon 2 h").estimate_minutes === 120);
ok("decimaltimmar", t("Djuparbete imorgon 1,5 h").estimate_minutes === 90);
ok("tim", t("Djuparbete imorgon 2 tim").estimate_minutes === 120);
ok("minuter utan mellanslag", t("Samtal imorgon 45min").estimate_minutes === 45);

rubrik("Snabbinmatningen — det som INTE ska kannas igen");

// Det har ar provet som funktionen finns for. Ett tal i en rubrik ar ett tal.
ok("ring 20 bolag far ingen tid", t("Ring 20 bolag").due_time === null);
ok("och ingen langd", t("Ring 20 bolag").estimate_minutes === null);
ok("och hela rubriken star kvar", t("Ring 20 bolag").titel === "Ring 20 bolag");

ok("ett klockslag utan dag blir ingen tid", t("Möte 14:00").due_time === null);
ok("men rubriken behaller det", t("Möte 14:00").titel === "Möte 14:00");

ok("okant prioritetsord lamnas i rubriken", t("Fixa !kanske").titel === "Fixa !kanske");
ok("och prioriteten star kvar pa normal", t("Fixa !kanske").priority === 3);

// "man" borjar pa "m", "mandag" pa "manda". Ingen av dem ar en enhet eller en dag.
ok("ordet man ater inte en langd", t("Ring 1 man").estimate_minutes === null);
ok("och rubriken overlever", t("Ring 1 man").titel === "Ring 1 man");
ok("ordet manus blir ingen mandag", t("Läs manus").due_date === null);

ok("tom rad ger tom titel", t("   ").titel === "");

// En tolk som tappar raden ar varre an en som inte tolkar alls.
ok(
  "allt som inte kands igen blir alltid titel",
  t("Kolla med Erik om det dar med 3 saker").titel === "Kolla med Erik om det dar med 3 saker",
);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
