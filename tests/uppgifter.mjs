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
  delatTillMig,
  LAGESHANDELSER,
  andringstext,
  farArbeta,
  farBjudaIn,
  farGranska,
  farLamna,
  farPassa,
  farRedigera,
  farStyra,
  forsenad,
  fristtext,
  lageAv,
  mittAttGora,
  provaLaggaTill,
  provaLamnaOver,
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
ok("tolv handelsetyper", HANDELSETYPER.length === 12);

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

// B4, bestallaren 2026-11-13 ("Gor som Asana"): den som ar med far lagga till fler.
// Fore det sa provet tvartom, och skalet (kretsen ar integritetsloftet) betalas
// nu med historik och besked i stallet for med en sparr.
ok(
  "en redigerare FAR lagga till fler (B4)",
  farBjudaIn(krets({ assignee_id: "a", created_by: "b", minRoll: "redigerare" })),
);
ok("skaparen far bjuda in", farBjudaIn(krets({ assignee_id: "annan" })));

ok("bara granskaren granskar", farGranska(krets({ minRoll: "granskare" })));
ok("skaparen granskar inte av att vara skapare", !farGranska(krets()));
ok("en redigerare granskar inte", !farGranska(krets({ minRoll: "redigerare" })));
ok("den som far redigera far arbeta", farArbeta(krets()));

// =============================================================================
// Vems lista raden hamnar i.
//
// PROVEN FINNS FOR ATT HALET INTE SKA OPPNA SIG IGEN. Fran 0054 till
// 2026-09-23 fragade ingen vy efter medlemskap, sa en inbjuden uppgift syntes
// ingenstans trots att `farRedigera()` slappte in henne att arbeta i den.
// Behorigheten och listan sa alltsa olika saker om samma rad, och det var
// listan som tog fel.
// =============================================================================
rubrik("Vems lista raden hamnar i");

const st = (over = {}) => ({
  assignee_id: "jag",
  created_by: "jag",
  minRoll: null,
  lage: "ej_paborjad",
  ...over,
});

const annans = { assignee_id: "annan", created_by: "annan" };

ok("den ansvarigas egen rad ar hennes att gora", mittAttGora(st(), "jag"));
ok("en redigerare far raden i sina listor", mittAttGora(st({ ...annans, minRoll: "redigerare" }), "jag"));
ok("en visare far den INTE i sina listor", !mittAttGora(st({ ...annans, minRoll: "visare" }), "jag"));
ok("en granskare far den inte heller", !mittAttGora(st({ ...annans, minRoll: "granskare" }), "jag"));
ok("en utomstaende far ingenting", !mittAttGora(st(annans), "jag"));

// Delegeringen ska inte komma tillbaka i knat: det man lamnat ifran sig star
// i "Vantar pa andra" och ingen annanstans.
ok(
  "skaparen far inte tillbaka det hon lagt pa nagon annan",
  !mittAttGora(st({ assignee_id: "annan", created_by: "jag" }), "jag"),
);

ok("visaren hamnar i Delat med mig", delatTillMig(st({ ...annans, minRoll: "visare" }), "jag"));
ok(
  "granskaren star dar fram till inlamningen",
  delatTillMig(st({ ...annans, minRoll: "granskare" }), "jag"),
);
ok(
  "men INTE nar den lamnats in — da har hon Att granska",
  !delatTillMig(st({ ...annans, minRoll: "granskare", lage: "granskas" }), "jag"),
);
ok(
  "redigeraren star inte i Delat med mig",
  !delatTillMig(st({ ...annans, minRoll: "redigerare" }), "jag"),
);
ok("en utomstaende star inte dar", !delatTillMig(st(annans), "jag"));
ok(
  "en stangd delad uppgift faller bort",
  !delatTillMig(st({ ...annans, minRoll: "visare", lage: "klar" }), "jag"),
);

// Ingen rad far sta pa tva stallen. Det ar hela skalet att "Delat med mig" ar
// aterstoden och inte en sjunde lista over uppgifter.
for (const roll of [null, "redigerare", "visare", "granskare"]) {
  for (const lage of LAGEN) {
    for (const rad of [st({ ...annans, minRoll: roll, lage }), st({ minRoll: roll, lage })]) {
      ok(
        `ingen dubblering: ${roll ?? "ingen roll"} / ${lage}`,
        !(mittAttGora(rad, "jag") && delatTillMig(rad, "jag")),
      );
    }
  }
}

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

// =============================================================================
rubrik("Snabbinmatningen i Nav 2.0 — en rad utan dag har ingen deadline");

// Beställaren 2026-11-11: en uppgift utan deadline får aldrig stå som försenad
// och läggs inte i "Att göra i dag". 2026-11-02–11 lades raden i dag, och dagen
// efter stod den som "skulle vara klar i går".
const n = (text) => tolkaSnabbrad(text, IDAG, IDAG);
const hedboms = n("Prata med Hedboms och fixa avtal och lägg upp för ADS");
ok("utan dag blir utan deadline", hedboms.due_date === null, String(hedboms.due_date));
ok("och utan tid", hedboms.due_time === null, String(hedboms.due_time));
ok("och rubriken står kvar hel", hedboms.titel === "Prata med Hedboms och fixa avtal och lägg upp för ADS", hedboms.titel);
ok("i dag utskrivet blir i dag", n("Skriv offert i dag").due_date === IDAG);
ok("en utskriven dag går före", n("Skriv offert imorgon").due_date === "2026-09-12");
ok("nästa vecka också", n("Skriv offert nästa vecka").due_date === "2026-09-14");
ok("ett klockslag utan dag blir i dag den tiden", n("Möte 14:00").due_date === IDAG && n("Möte 14:00").due_time === "14:00");
ok("och klockslaget lämnar rubriken", n("Möte 14:00").titel === "Möte");
ok("kl 14 utan dag blir i dag klockan 14", n("Ring Kalle kl 14").due_date === IDAG && n("Ring Kalle kl 14").due_time === "14:00" && n("Ring Kalle kl 14").titel === "Ring Kalle");
ok("någon gång blir utan dag", n("Ring Nordic någon gång").due_date === null);
ok("och lämnar rubriken", n("Ring Nordic någon gång").titel === "Ring Nordic");
ok("nagon gang utan prickar", n("Ring Nordic nagon gang").due_date === null && n("Ring Nordic nagon gang").titel === "Ring Nordic");
ok("ring 20 bolag får varken dag eller tid", n("Ring 20 bolag").due_date === null && n("Ring 20 bolag").due_time === null && n("Ring 20 bolag").titel === "Ring 20 bolag");
ok("en längd är ingen deadline", n("Skriv manus 30 min").due_date === null && n("Skriv manus 30 min").estimate_minutes === 30);
ok("ett projekt är ingen deadline", n("Fixa projekten #Nav").due_date === null && n("Fixa projekten #Nav").projekt === "Nav");
// Gamla snabbraden skickar ingen dag för raden utan dag, och den lämnas som förut.
ok("utan tredje argumentet är det som förut", t("Ring Nordic någon gång").due_date === null && t("Ring Nordic någon gång").titel === "Ring Nordic någon gång");

// En tolk som tappar raden ar varre an en som inte tolkar alls.
ok(
  "allt som inte kands igen blir alltid titel",
  t("Kolla med Erik om det dar med 3 saker").titel === "Kolla med Erik om det dar med 3 saker",
);

// =============================================================================
// Regeltabellen for en delad uppgift (PROMPT.md, 2026-11-13).
//
// TABELLEN AR KONTRAKTET. Varje rad ar en handling, varje kolumn en stallning,
// och svaret star har innan nagon action fragar. Sju stallningar: den som la
// upp, den som har bollen, den som ar med, den som kan se, granskaren, den
// utanfor, och kalenderns delegat (som ska ha exakt det hen hade fore bygget).
// =============================================================================
rubrik("Regeltabellen — vem far gora vad i en delad uppgift");

const STALLNING = {
  laUpp: krets({ assignee_id: "annan" }),
  bollen: krets({ created_by: "annan" }),
  med: krets({ assignee_id: "a", created_by: "b", minRoll: "redigerare" }),
  kanSe: krets({ assignee_id: "a", created_by: "b", minRoll: "visare" }),
  granskare: krets({ assignee_id: "a", created_by: "b", minRoll: "granskare" }),
  utanfor: krets({ assignee_id: "a", created_by: "b" }),
  delegat: krets({ assignee_id: "a", created_by: "b", somDelegat: true }),
};
/** Ordningen: laUpp, bollen, med, kanSe, granskare, utanfor, delegat. */
const tabell = (namn, fn, svar) => {
  const fick = Object.values(STALLNING).map((k) => (fn(k) ? "j" : "n")).join("");
  ok(namn, fick === svar, fick === svar ? "" : `fick ${fick}, vantade ${svar}`);
};

tabell("andra, bocka, deluppgifter, forsta steget", farRedigera, "jjjnnnj");
tabell("lagga till en kollega", farBjudaIn, "jjjnnnn");
tabell("ta bort nagon annan, stryka", farStyra, "jjnnnnn");
tabell("passa bollen", farPassa, "jjjnnnj");
tabell("lamna sjalv", farLamna, "nnjjjnn");
tabell("godkanna", farGranska, "nnnnjnn");

ok(
  "den som har bollen OCH en medlemsrad lamnar inte forran hen passat",
  !farLamna(krets({ created_by: "annan", minRoll: "redigerare" })),
);
ok(
  "skaparen som gatt med (B9) kan lamna sin plats som med",
  farLamna(krets({ assignee_id: "annan", minRoll: "redigerare" })),
);

// H6: arbetsratten i en deluppgift foljer foralderns krets.
ok(
  "den som far arbeta i foraldern far bocka deluppgiften",
  farRedigera(krets({ assignee_id: "a", created_by: "a", viaForalder: true })),
);
ok(
  "men far inte lagga till folk i deluppgiften den vagen",
  !farBjudaIn(krets({ assignee_id: "a", created_by: "a", viaForalder: true })),
);
ok(
  "och inte stryka den",
  !farStyra(krets({ assignee_id: "a", created_by: "a", viaForalder: true })),
);

rubrik("Lagga till en kollega — beslutet");

const lagg = (over = {}) =>
  provaLaggaTill({
    krets: STALLNING.bollen,
    person: "simon",
    roll: "redigerare",
    befintligRoll: null,
    slutat: false,
    doldKoppling: false,
    ...over,
  });

ok("den som har bollen lagger till en kollega", lagg() === null);
ok("den som ar med lagger till en kollega (B4)", lagg({ krets: STALLNING.med }) === null);
ok("den som kan se far inte", typeof lagg({ krets: STALLNING.kanSe }) === "string");
ok("delegaten far inte", typeof lagg({ krets: STALLNING.delegat }) === "string");
ok("ingen vald", typeof lagg({ person: "" }) === "string");
ok("okand roll", typeof lagg({ roll: "chef" }) === "string");
ok("sig sjalv", typeof lagg({ person: "jag" }) === "string");
ok("den som har bollen ar redan med", typeof lagg({ krets: STALLNING.med, person: "a" }) === "string");
ok("redan med: sager det, ingen dubblett", /redan med/i.test(lagg({ befintligRoll: "redigerare" }) ?? ""));
ok("kan se lyfts till med", lagg({ befintligRoll: "visare" }) === null);
ok("en granskare kan inte ocksa vara med", /granskare/i.test(lagg({ befintligRoll: "granskare" }) ?? ""));
ok("den som slutat laggs inte till", /slutat/i.test(lagg({ slutat: true }) ?? ""));
ok("H13: dold personkoppling sparrar", /dold/i.test(lagg({ doldKoppling: true }) ?? ""));
ok("B9: skaparen far ga med nar nagon annan har bollen", lagg({ krets: STALLNING.bollen, person: "annan" }) === null);
ok("B9: skaparen lagger till SIG SJALV i det hen lagt pa nagon annan", lagg({ krets: STALLNING.laUpp, person: "jag" }) === null);
ok("men den som ar med kan inte lagga till sig en gang till", typeof lagg({ krets: STALLNING.med, person: "jag", befintligRoll: "redigerare" }) === "string");
ok("och den som har bollen ar redan inne", typeof lagg({ krets: STALLNING.bollen, person: "jag" }) === "string");
ok("den som kan se lyfter inte sig sjalv till med", typeof lagg({ krets: STALLNING.kanSe, person: "jag", befintligRoll: "visare" }) === "string");
// Rollerna Kan se och Granskare ar agarens sak: den som bara ar med delar ut plats, inte roller.
ok("den som ar med far inte dela ut granskarrollen", typeof lagg({ krets: STALLNING.med, roll: "granskare" }) === "string");
ok("agaren far", lagg({ roll: "granskare" }) === null);
ok(
  "den som ar med far inte sanka en kollega till kan se",
  typeof lagg({ krets: STALLNING.med, roll: "visare", befintligRoll: "redigerare" }) === "string",
);

rubrik("Lamna over och passa — beslutet");

const over = (o = {}) =>
  provaLamnaOver({ krets: STALLNING.bollen, till: "simon", iKretsen: false, befintligRoll: null, slutat: false, doldKoppling: false, ...o });

ok("den som har bollen lamnar over till nagon utanfor", over() === null);
ok("den som ar med passar inom kretsen", over({ krets: STALLNING.med, iKretsen: true }) === null);
ok("den som ar med lamnar over till nagon utanfor (B4 + B5)", over({ krets: STALLNING.med }) === null);
ok("till inkorgen", over({ till: null }) === null);
ok("den som kan se flyttar ingenting", typeof over({ krets: STALLNING.kanSe, iKretsen: true }) === "string");
ok("den utanfor flyttar ingenting", typeof over({ krets: STALLNING.utanfor }) === "string");
ok("delegaten lamnar over som fore bygget", over({ krets: STALLNING.delegat }) === null);
// Ett steg i en delad uppgift: den som arbetar i foraldern far ge steget till en annan dar inne...
const viaForalder = krets({ assignee_id: "a", created_by: "a", viaForalder: true });
ok("via foraldern: inom kretsen gar", over({ krets: viaForalder, iKretsen: true }) === null);
// ...men inte dra in en ny person i kretsen genom ett steg.
ok("via foraldern: inte till nagon utanfor", typeof over({ krets: viaForalder }) === "string");
ok("H13: dold personkoppling sparrar aven overlamningen", /dold/i.test(over({ doldKoppling: true }) ?? ""));
ok("den som slutat far inte bollen", /slutat/i.test(over({ slutat: true }) ?? ""));
ok("granskaren far inte bollen i det hon ska granska", /granskare/i.test(over({ befintligRoll: "granskare" }) ?? ""));
ok("den som kan se far ta emot bollen", over({ befintligRoll: "visare" }) === null);

rubrik("Handelserna som inte andrar laget");

ok("andrad och krets finns", HANDELSETYPER.includes("andrad") && HANDELSETYPER.includes("krets"));
ok("en flytt gor inte en klar uppgift ogjord", lageAv([{ type: "klar" }, { type: "andrad" }]) === "klar");
ok("att nagon laggs till avbryter inte arbetet", lageAv([{ type: "paborjad" }, { type: "krets" }]) === "pagar");
ok(
  "lageshandelserna ar de som bar ett lage",
  LAGESHANDELSER.includes("klar") && LAGESHANDELSER.includes("ateroppnad") &&
    !LAGESHANDELSER.includes("kommentar") && !LAGESHANDELSER.includes("andrad") &&
    !LAGESHANDELSER.includes("krets") && !LAGESHANDELSER.includes("tilldelad"),
);

const fore = { due_date: "2026-09-11", due_time: null, priority: 3 };
ok("ingen andring: ingen rad", andringstext(fore, { ...fore }, IDAG) === null);
ok("flytt till en dag", andringstext(fore, { ...fore, due_date: "2026-09-14" }, IDAG) === "flyttade till mån 14 sep", String(andringstext(fore, { ...fore, due_date: "2026-09-14" }, IDAG)));
ok("dagen togs bort", andringstext(fore, { ...fore, due_date: null }, IDAG) === "tog bort dagen");
ok("klockslag", andringstext(fore, { ...fore, due_time: "14:00" }, IDAG) === "satte 14:00");
ok("sekunderna fran databasen ar ingen andring", andringstext({ ...fore, due_time: "14:00:00" }, { ...fore, due_time: "14:00" }, IDAG) === null);
ok("prioritet", andringstext(fore, { ...fore, priority: 1 }, IDAG) === "satte prioritet Brådskande", String(andringstext(fore, { ...fore, priority: 1 }, IDAG)));
ok(
  "flera pa en gang blir en rad",
  andringstext(fore, { due_date: "2026-09-14", due_time: "09:30", priority: 3 }, IDAG) === "flyttade till mån 14 sep, satte 09:30",
  String(andringstext(fore, { due_date: "2026-09-14", due_time: "09:30", priority: 3 }, IDAG)),
);

rubrik("Snabbinmatningen — +namn lagger till en kollega");

ok("en kollega", t("Ring Nordic fredag +simon").med.join() === "simon" && t("Ring Nordic fredag +simon").titel === "Ring Nordic");
ok("flera", t("Ring Nordic +simon +anna").med.join() === "simon,anna");
ok("ingen: tom lista", t("Ring Nordic").med.length === 0);
ok("@ ar fortfarande den som far bollen", t("Ring Nordic @anna +simon").person === "anna" && t("Ring Nordic @anna +simon").med.join() === "simon");
ok("ett telefonnummer ar ingen kollega", t("Ring +46701234567").med.length === 0 && t("Ring +46701234567").titel === "Ring +46701234567");
ok("ett plus mitt i en mening ar ingen kollega", t("Rakna 2 + 2").med.length === 0 && t("Rakna 2+2").titel === "Rakna 2+2");
ok("samma namn tva ganger blir en", t("Ring +simon +Simon").med.length === 1);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
