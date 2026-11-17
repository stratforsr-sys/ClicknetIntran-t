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
  NYTT_HOGST,
  nyhetstext,
  nyttSedanSist,
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

rubrik("Nytt sedan sist (0301) — det andra gjort efter min markering");

{
  const MIG = "m", SIMON = "s";
  const h = (typ, avId, at, note = null) => ({ typ, avId, av: avId === SIMON ? "Simon Ek" : avId === MIG ? "Zen" : "Okänd", note, at });
  const egna = [
    h("skapad", MIG, "2026-11-14T08:00:00.000Z"),
    h("kommentar", SIMON, "2026-11-14T09:00:00.000Z", "Jag ringer dem"),
    h("kommentar", MIG, "2026-11-14T10:00:00.000Z", "Bra"),
    h("andrad", SIMON, "2026-11-14T11:00:00.000Z", "flyttade till mån 16 nov"),
  ];
  const steg = [{ titel: "Hitta numret", handelser: [h("skapad", MIG, "2026-11-14T08:01:00.000Z"), h("klar", SIMON, "2026-11-14T14:02:00.000Z")] }];
  const utan = nyttSedanSist({ mig: MIG, sett: null, egna, steg });
  ok("utan markering ar allt andra gjort nytt", utan.antal === 3, JSON.stringify(utan));
  ok("nyast forst, och steget bar sin rubrik", utan.rader[0].typ === "klar" && utan.rader[0].steg === "Hitta numret" && utan.rader[1].typ === "andrad");
  ok("mina egna handelser ar aldrig nya", !utan.rader.some((r) => r.avId === MIG));
  const efter = nyttSedanSist({ mig: MIG, sett: "2026-11-14T10:30:00.000Z", egna, steg });
  ok("bara det efter markeringen", efter.antal === 2 && efter.rader.every((r) => Date.parse(r.at) > Date.parse("2026-11-14T10:30:00.000Z")));
  ok("lika med markeringen ar inte nytt", nyttSedanSist({ mig: MIG, sett: "2026-11-14T14:02:00.000Z", egna, steg }).antal === 0);
  ok("Postgres-tid med mikrosekunder jamfors som tid, inte som text", nyttSedanSist({ mig: MIG, sett: "2026-11-14T14:01:59.999999+00:00", egna, steg }).antal === 1);
  ok("en handelse utan person raknas inte", nyttSedanSist({ mig: MIG, sett: null, egna: [h("skapad", null, "2026-11-14T08:00:00.000Z")], steg: [] }).antal === 0);
  const manga = Array.from({ length: 9 }, (_, i) => h("kommentar", SIMON, `2026-11-14T1${i}:00:00.000Z`, `nr ${i}`));
  const m = nyttSedanSist({ mig: MIG, sett: null, egna: manga, steg: [] });
  ok(`hogst ${NYTT_HOGST} rader, men antalet ar alla`, m.rader.length === NYTT_HOGST && m.antal === 9 && m.rader[0].note === "nr 8");
}

{
  const t = (typ, note = null, steg = null, mig = "Zen") => nyhetstext({ typ, note, steg }, mig);
  ok("bockade ett steg", t("klar", null, "Hitta numret").text === "bockade" && t("klar", null, "Hitta numret").objekt === "Hitta numret");
  ok("bockade av uppgiften", t("klar").text === "bockade av uppgiften" && t("klar").objekt === null);
  ok("bockade ur ett steg", t("ateroppnad", null, "Hitta numret").text === "bockade ur");
  ok("la till ett steg", t("skapad", null, "Ring") .text === "la till steget");
  ok("kommentaren ar objektet", t("kommentar", "Jag ringer dem").text === "skrev" && t("kommentar", "Jag ringer dem").objekt === "Jag ringer dem");
  ok("en lang kommentar kortas med en ellips", t("kommentar", "x".repeat(200)).objekt.length === 90 && t("kommentar", "x".repeat(200)).objekt.endsWith("…"));
  ok("passade till mig blir till dig", t("tilldelad", "passade till Zen").text === "passade till dig", t("tilldelad", "passade till Zen").text);
  ok("passade till en annan star kvar", t("tilldelad", "passade till Simon Ek").text === "passade till Simon Ek");
  ok("la till mig blir la till dig", t("krets", "la till Carl Erikson", null, "Carl Erikson").text === "la till dig");
  ok("som granskare foljer med", t("krets", "la till Carl Erikson som granskare", null, "Carl Erikson").text === "la till dig som granskare");
  ok("tog bort mig", t("krets", "tog bort Carl Erikson", null, "Carl Erikson").text === "tog bort dig");
  ok("ett namn som borjar likadant ar inte mitt", t("krets", "la till Carl Eriksonsson", null, "Carl Erikson").text === "la till Carl Eriksonsson");
  ok("flytten ar historikens mening", t("andrad", "flyttade till mån 16 nov").text === "flyttade till mån 16 nov");
  ok("tecken i namnet ar inget monster", t("krets", "la till A.B (x)", null, "A.B (x)").text === "la till dig");
}

// =============================================================================
// Rutten /nav2/uppgifter: Min dag (task_day) och tidsuppskattningen
// =============================================================================
//
// Rutten körs på riktigt. Inloggningen, databasen och repots actions är attrapper (samma mönster som
// tests/forslag-rutt.mjs). Attrappen för task_day håller 0092:s regler: nyckeln (person, dag) och checken att en
// rad har planned_at eller closed_at. Det är den checken som gjorde att en oplanerad avslutad dag inte gick att öppna.
{
  const { registerHooks } = await import("node:module");
  const { existsSync } = await import("node:fs");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { join } = await import("node:path");
  const rot = join(fileURLToPath(import.meta.url), "..", "..");
  const stubb = (kod) => ({ url: "data:text/javascript," + encodeURIComponent(kod), shortCircuit: true });
  const ACTIONS = ["andraProjekt", "andraUppgift", "arkiveraProjekt", "ateroppna", "avbryt", "avslutaSerie", "bjudIn", "bjudInProjekt", "koppla", "lamnaUppgift", "markeraProjektchattLast", "skapaProjekt", "skrivProjektmeddelande", "taBortKoppling", "taBortProjektmedlem", "bocka", "godkann", "kommentera", "paborja", "planera", "returnera", "sattForstaSteg", "skapaUppgift", "taBortMedlem", "tilldela"];
  // Varje action bokför sitt formulär och svarar som repots actions gör (UppgiftState).
  const actionStubb = (namn) => namn.map((n) => `export const ${n} = async (_p, f) => { (globalThis.__upg.anrop ??= []).push({ namn: ${JSON.stringify(n)}, falt: Object.fromEntries(f.entries()) }); return { ok: "Planerad." }; };`).join("\n");
  registerHooks({
    resolve(spec, ctx, nasta) {
      if (spec === "server-only") return stubb("");
      if (spec === "next/server") return stubb("export const NextResponse = { json: (d, i) => new Response(JSON.stringify(d), { status: i?.status ?? 200, headers: { 'content-type': 'application/json' } }) };");
      if (spec === "next/cache") return stubb("export const revalidatePath = () => {}; export const revalidateTag = () => {};");
      if (spec === "@/lib/auth") return stubb("export const getCurrentUser = async () => globalThis.__upg.user; export const fullName = (p) => `${p.first_name} ${p.last_name}`;");
      if (spec === "@/lib/supabase/server") return stubb("export const supabaseServer = async () => globalThis.__upg.db; export const supabaseAdmin = () => globalThis.__upg.db;");
      if (spec === "@/lib/notishandelse-server") return stubb("export const notifiera = async () => {};");
      if (spec === "@/app/(app)/uppgifter/actions") return stubb(actionStubb(ACTIONS));
      if (spec === "@/app/(app)/uppgifter/mallar/actions") return stubb(actionStubb(["andraUppgiftsmall", "anvandUppgiftsmall", "arkiveraUppgiftsmall", "skapaUppgiftsmall"]));
      if (spec === "@/app/(app)/uppgifter/genomgang/actions") return stubb(actionStubb(["slutforGenomgang"]));
      if (spec.startsWith("@/")) {
        const bas = join(rot, "src", spec.slice(2));
        const fil = [".ts", ".tsx", "/index.ts"].map((x) => bas + x).find((x) => existsSync(x)) ?? bas + ".ts";
        return { url: pathToFileURL(fil).href, shortCircuit: true };
      }
      if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
        const fil = [".ts", ".tsx", "/index.ts"].map((x) => fileURLToPath(new URL(spec, ctx.parentURL)) + x).find((x) => existsSync(x));
        if (fil) return { url: pathToFileURL(fil).href, shortCircuit: true };
      }
      return nasta(spec, ctx);
    },
  });

  /**
   * supabase-js i liten skala: select, eq, is, maybeSingle, update, delete, insert och upsert, svaret som { data, error }.
   * `.select()` efter en skrivning ger de rader som träffades, som supabase-js (Prefer: return=representation).
   * `tabeller["<tabell>!efterLas"]`: körs en gång när första läsningen av tabellen är klar, som en annan flik som hinner
   * skriva mellan rutans läsning och dess skrivning.
   */
  function attrapp(tabeller) {
    const skrivningar = [];
    const from = (t) => {
      let op = "select", varde = null, enda = false, konflikt = null, valj = false;
      const filter = [];
      const rader = () => (tabeller[t] ??= []);
      const traffar = () => rader().filter((r) => filter.every((f) => f(r)));
      const giltig = (r) => t !== "task_day" || r.planned_at != null || r.closed_at != null;
      const kor = () => {
        if (op === "select") {
          if (tabeller[`${t}!lasfel`]) return { data: null, error: { message: tabeller[`${t}!lasfel`] } };
          const d = traffar().map((r) => ({ ...r }));
          const efter = tabeller[`${t}!efterLas`];
          if (efter) { delete tabeller[`${t}!efterLas`]; efter(tabeller); }
          return enda ? { data: d[0] ?? null, error: null } : { data: d, error: null };
        }
        skrivningar.push({ op, t, varde });
        if (tabeller[`${t}!fel`]) return { data: null, error: { message: tabeller[`${t}!fel`] } };
        if (op === "update") {
          const efter = traffar().map((r) => ({ r, ny: { ...r, ...varde } }));
          if (!efter.every((x) => giltig(x.ny))) return { data: null, error: { code: "23514", message: "task_day_check" } };
          for (const x of efter) Object.assign(x.r, varde);
          return { data: valj ? efter.map((x) => ({ ...x.r })) : null, error: null };
        }
        if (op === "delete") {
          const bort = new Set(traffar());
          tabeller[t] = rader().filter((r) => !bort.has(r));
          return { data: valj ? [...bort] : null, error: null };
        }
        const nyckel = (r) => (konflikt ?? "employee_id,dag").split(",").map((k) => r[k]).join("|");
        const fanns = rader().find((r) => nyckel(r) === nyckel(varde));
        if (fanns && op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        const ny = fanns ? { ...fanns, ...varde } : { planned_at: null, closed_at: null, ...varde };
        if (!giltig(ny)) return { data: null, error: { code: "23514", message: "task_day_check" } };
        if (fanns) Object.assign(fanns, varde);
        else rader().push(ny);
        return { data: null, error: null };
      };
      const q = {
        select: () => { if (op !== "select") valj = true; return q; },
        eq: (k, v) => { filter.push((r) => r[k] === v); return q; },
        is: (k, v) => { filter.push((r) => (r[k] ?? null) === v); return q; },
        not: (k, _o, v) => { filter.push((r) => (r[k] ?? null) !== v); return q; },
        update: (v) => { op = "update"; varde = v; return q; },
        delete: () => { op = "delete"; return q; },
        insert: (v) => { op = "insert"; varde = v; return q; },
        upsert: (v, o) => { op = "upsert"; varde = v; konflikt = o?.onConflict ?? null; return q; },
        maybeSingle: () => { enda = true; return Promise.resolve(kor()); },
        then: (a, b) => Promise.resolve(kor()).then(a, b),
      };
      return q;
    };
    return { skrivningar, from };
  }

  const { svensktDatum } = await import("../src/lib/klocka.ts");
  const { POST } = await import("../src/app/nav2/uppgifter/route.ts");
  const JAG = "a0000000-0000-4000-8000-000000000001", ANNAN = "a0000000-0000-4000-8000-000000000002";
  const UPPG = "b0000000-0000-4000-8000-000000000001", UTAN = "b0000000-0000-4000-8000-000000000002";
  const idag = svensktDatum();
  const anropa = async (kropp, tabeller) => {
    const db = attrapp(tabeller);
    globalThis.__upg = { db, user: { employee: { id: JAG, first_name: "Prov", last_name: "Person" }, roles: ["salesperson"], permissions: [] }, anrop: [] };
    const res = await POST(new Request("https://nav.test/nav2/uppgifter", { method: "POST", headers: { origin: "https://nav.test", "content-type": "application/json" }, body: JSON.stringify(kropp) }));
    return { status: res.status, data: await res.json(), db, tabeller, anrop: globalThis.__upg.anrop };
  };
  const minDag = (t) => (t.task_day ?? []).find((r) => r.employee_id === JAG && r.dag === idag) ?? null;
  const annansDag = { employee_id: ANNAN, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" };

  rubrik("Min dag: Öppna dagen igen gör det den säger (urtavlan-3)");
  {
    const r = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" }, { ...annansDag }] });
    ok("en dag som avslutades utan plan går att öppna: raden tas bort, dagen är som innan", r.status === 200 && r.data.ok === "Dagen är öppen igen." && minDag(r.tabeller) === null, JSON.stringify(r.data));
    ok("en annans dag rörs inte", r.tabeller.task_day.some((x) => x.employee_id === ANNAN && x.closed_at), JSON.stringify(r.tabeller.task_day));
    const p = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: "2026-11-17T07:30:00Z", closed_at: "2026-11-17T16:00:00Z" }] });
    ok("en planerad och avslutad dag öppnas, och planen står kvar", p.data.ok === "Dagen är öppen igen." && minDag(p.tabeller)?.closed_at === null && minDag(p.tabeller)?.planned_at === "2026-11-17T07:30:00Z", JSON.stringify(minDag(p.tabeller)));
    const o = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: "2026-11-17T07:30:00Z", closed_at: null }] });
    ok("en dag som inte är avslutad: svaret säger det, och ingenting skrivs", o.status === 200 && o.data.ok === "Dagen var inte avslutad." && o.db.skrivningar.length === 0, JSON.stringify(o.data));
    const ingen = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [] });
    ok("ingen rad alls: samma ärliga svar", ingen.data.ok === "Dagen var inte avslutad." && ingen.db.skrivningar.length === 0, JSON.stringify(ingen.data));
    const fel = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" }], "task_day!fel": "nere" });
    ok("skrivningen faller: 500 och fel, inte 'öppen igen'", fel.status === 500 && fel.data.fel === "Dagen gick inte att öppna. Försök igen." && !fel.data.ok, JSON.stringify(fel.data));
    const lasfel = await anropa({ handling: "dag", vad: "oppna" }, { task_day: [], "task_day!lasfel": "nere" });
    ok("läsningen faller: 500 och fel", lasfel.status === 500 && lasfel.data.fel === "Dagen gick inte att läsa. Försök igen.", JSON.stringify(lasfel.data));
    // Två flikar: rutan läser en oplanerad avslutad dag, och en annan flik planerar dagen innan borttagningen. Då tar
    // borttagningen (planned_at is null) ingen rad. Förut svarade rutan ändå "Dagen är öppen igen." och closed_at stod kvar.
    const P = "2026-11-17T08:00:00Z";
    const kapp = await anropa({ handling: "dag", vad: "oppna" }, {
      task_day: [{ employee_id: JAG, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" }],
      "task_day!efterLas": (t) => { t.task_day.find((r) => r.employee_id === JAG).planned_at = P; },
    });
    ok("en annan flik planerar mellan läsningen och borttagningen: dagen öppnas ändå, och planen står kvar", kapp.status === 200 && kapp.data.ok === "Dagen är öppen igen." && minDag(kapp.tabeller)?.closed_at === null && minDag(kapp.tabeller)?.planned_at === P, JSON.stringify({ svar: kapp.data, rad: minDag(kapp.tabeller) }));
    // En annan flik hann öppna den oplanerade dagen först (raden är borta): dagen är öppen, och inget fel.
    const redan = await anropa({ handling: "dag", vad: "oppna" }, {
      task_day: [{ employee_id: JAG, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" }],
      "task_day!efterLas": (t) => { t.task_day = t.task_day.filter((r) => r.employee_id !== JAG); },
    });
    ok("en annan flik öppnade dagen först: 200, ingen rad, och dagen är öppen", redan.status === 200 && redan.data.ok === "Dagen är öppen igen." && minDag(redan.tabeller) === null, JSON.stringify(redan.data));
  }

  rubrik("Rutten: en kropp som inte är ett objekt");
  {
    for (const kropp of [null, [], "dag", 5]) {
      const r = await anropa(kropp, { task_day: [] });
      ok(`${JSON.stringify(kropp)}: 400 Ogiltig begäran., inget skrivs`, r.status === 400 && r.data.fel === "Ogiltig begäran." && r.db.skrivningar.length === 0, JSON.stringify({ status: r.status, data: r.data }));
    }
  }

  rubrik("Min dag: planera och avsluta skriver bara sin kolumn");
  {
    const a = await anropa({ handling: "dag", vad: "avsluta" }, { task_day: [] });
    ok("avsluta en oplanerad dag: en rad med bara closed_at", a.data.ok === "Dagen är avslutad. Ha en bra kväll." && minDag(a.tabeller)?.closed_at && minDag(a.tabeller)?.planned_at === null, JSON.stringify(minDag(a.tabeller)));
    const ap = await anropa({ handling: "dag", vad: "avsluta" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: "2026-11-17T07:30:00Z", closed_at: null }] });
    ok("avsluta en planerad dag: planen står kvar", minDag(ap.tabeller)?.planned_at === "2026-11-17T07:30:00Z" && !!minDag(ap.tabeller)?.closed_at, JSON.stringify(minDag(ap.tabeller)));
    const pl = await anropa({ handling: "dag", vad: "planera" }, { task_day: [] });
    ok("planera: en rad med planned_at", pl.data.ok === "Dagen är planerad." && !!minDag(pl.tabeller)?.planned_at && minDag(pl.tabeller)?.closed_at === null, JSON.stringify(minDag(pl.tabeller)));
    const tva = await anropa({ handling: "dag", vad: "avsluta" }, { task_day: [{ employee_id: JAG, dag: idag, planned_at: null, closed_at: "2026-11-17T16:00:00Z" }] });
    ok("avsluta två gånger (dubbelklick) krockar inte på nyckeln", tva.status === 200 && tva.tabeller.task_day.length === 1, JSON.stringify(tva.data));
    const fel = await anropa({ handling: "dag", vad: "avsluta" }, { task_day: [], "task_day!fel": "nere" });
    ok("skrivningen faller: 500 och fel, inte 'avslutad'", fel.status === 500 && fel.data.fel === "Dagen gick inte att avsluta. Försök igen.", JSON.stringify(fel.data));
    const okand = await anropa({ handling: "dag", vad: "radera" }, { task_day: [] });
    ok("en okänd handling: 400, inget skrivs", okand.status === 400 && okand.db.skrivningar.length === 0);
  }

  rubrik("Tidsuppskattningen: planera med est, utan att röra dag och tid");
  {
    const task = (id, o = {}) => ({ id, title: "Ring tillbaka", priority: 2, description_md: null, due_date: "2026-11-20", due_time: "09:00", starts_on: null, estimate_minutes: null, project_id: null, assignee_id: JAG, created_by: JAG, ...o });
    const r = await anropa({ handling: "planera", id: UPPG, est: 30 }, { task: [task(UPPG)] });
    const f = r.anrop.find((x) => x.namn === "planera")?.falt;
    ok("est: 30 går till repots planera som estimate_minutes, och dag och tid är de som redan gäller", r.status === 200 && f?.estimate_minutes === "30" && f?.due_date === "2026-11-20" && f?.due_time === "09:00" && f?.id === UPPG, JSON.stringify({ svar: r.data, falt: f }));
    const n = await anropa({ handling: "planera", id: UPPG, est: null }, { task: [task(UPPG, { estimate_minutes: 45 })] });
    // Repots planera läser `minuter ? Number(minuter) : null`: ett tomt fält är ingen uppskattning.
    ok("est: null tar bort uppskattningen (tomt fält till planera)", n.anrop.find((x) => x.namn === "planera")?.falt?.estimate_minutes === "", JSON.stringify(n.anrop));
    const u = await anropa({ handling: "planera", id: UTAN, est: 15 }, { task: [task(UTAN, { due_date: null, due_time: null })] });
    const fu = u.anrop.find((x) => x.namn === "planera")?.falt;
    ok("en uppgift utan dag får uppskattningen och förblir utan dag", fu?.estimate_minutes === "15" && !("due_date" in fu && fu.due_date), JSON.stringify(fu));
    const borta = await anropa({ handling: "planera", id: UPPG, est: 30 }, { task: [] });
    ok("en uppgift den inloggade inte ser (RLS): 404, planera anropas inte", borta.status === 404 && borta.anrop.length === 0, JSON.stringify(borta.data));

    // Kvittot säger det som ändrades. Repots "Datumet togs bort." gäller datumet, och ingen dag togs bort här.
    ok("bara uppskattningen, uppgiften har en dag: 'Uppskattningen är sparad.'", r.data.ok === "Uppskattningen är sparad." && r.data.id === null, JSON.stringify(r.data));
    ok("bara uppskattningen, uppgiften saknar dag: 'Uppskattningen är sparad.', aldrig 'Datumet togs bort.'", u.status === 200 && u.data.ok === "Uppskattningen är sparad.", JSON.stringify(u.data));
    ok("est: null: 'Uppskattningen är borttagen.'", n.status === 200 && n.data.ok === "Uppskattningen är borttagen.", JSON.stringify(n.data));
    const medDag = await anropa({ handling: "planera", id: UPPG, dag: "2026-11-21", est: 30 }, { task: [task(UPPG)] });
    ok("med dag: repots kvitto som förut ('Planerad.')", medDag.status === 200 && medDag.data.ok === "Planerad." && medDag.anrop.find((x) => x.namn === "planera")?.falt?.due_date === "2026-11-21", JSON.stringify(medDag.data));
    const somText = await anropa({ handling: "planera", id: UPPG, est: "45" }, { task: [task(UPPG)] });
    ok("ett tal som text ('45') godtas, som förut", somText.status === 200 && somText.anrop.find((x) => x.namn === "planera")?.falt?.estimate_minutes === "45", JSON.stringify(somText.data));
    // En uppskattning som inte är hela minuter 1–1440 (0054) nekas. Förut blev "abc" NaN, och uppskattningen togs bort i tysthet.
    for (const est of ["abc", 0, -15, 1441, 30.5, true, {}]) {
      const x = await anropa({ handling: "planera", id: UPPG, est }, { task: [task(UPPG, { estimate_minutes: 45 })] });
      ok(`est ${JSON.stringify(est)}: 400 Okänd uppskattning., planera anropas inte`, x.status === 400 && x.data.fel === "Okänd uppskattning." && x.anrop.length === 0, JSON.stringify(x.data));
    }
  }
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
