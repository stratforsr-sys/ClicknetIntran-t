#!/usr/bin/env node
/**
 * Säljtavlans möten (2026-11-13): vilka bokade möten som räknas, vad som firas och
 * hur stort, och att ingenting om kunden når tv:n.
 *
 *   1. ETT MÖTE RÄKNAS NÄR ETT BOLAG FÅR SITT MÖTE. Bara art 'ny', och inte om
 *      samma bolag (id, telefon, domän eller namn utan bolagsform) haft ett möte
 *      de senaste 90 dagarna. Fallen är produktionens: ORION CAR AB 5/11 och
 *      10/11, och Micks 12/11 med sex nya och en uppföljning.
 *   2. NIVÅN: tio före fem före första någonsin före dagens första före ett till.
 *      Flera möten på en gång firas en gång, med det högsta som passerats.
 *   3. MINNET: ett möte firas en gång, också över en omladdning, och ett raderat
 *      möte som väntade spelas inte.
 *   4. BILDEN ÄR DISPLAY-SÄKER: inget bolagsnamn, ingen telefon, ingen domän och
 *      inget id i JSON-strängen. En dold säljare får inget personligt.
 *   5. MÖTEN OCH ORDER BLANDAS INTE: ett möte rör varken orderna, månadens
 *      ordervärde eller topplistan, och mötenas ljud är aldrig orderns.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-moten.mjs
 */
import { DUBBLETT_DAGAR, formaMoten, forstaKandidater, motesfonsterFran, normDoman, normNamn, normTelefon, raknadeMoten } from "../src/lib/salesboard/moten.ts";
import { MOTESBOKARROLL, SALJANDE_ROLLER, motesniva, planera } from "../src/lib/salesboard/regler.ts";
import { formaOgonblick } from "../src/lib/salesboard/forma.ts";
import { normalisera, STANDARD } from "../src/lib/salesboard/installningar.ts";
import { aktuell, forlopp, motestal, visning } from "../src/app/salesboard/ko.ts";
import { MOTE_LANDAR, MOTE_LANGD, femBlock, moteLjud, orderLjud, serieLjud, tioBlock } from "../src/app/salesboard/motion/tider.ts";
import { LJUD } from "../src/app/salesboard/ljud.ts";
import { lasBild } from "../src/app/salesboard/hamtning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const avsnitt = (namn) => console.log(`\n${namn}`);
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// -----------------------------------------------------------------------------
// Raderna: produktionens möten 3–13 november 2026, med påhittade id:n
// -----------------------------------------------------------------------------

const MICK = "11111111-1111-4111-8111-111111111111";
const CARL = "22222222-2222-4222-8222-222222222222";
const ZEN = "33333333-3333-4333-8333-333333333333";
const DOLDA = "44444444-4444-4444-8444-444444444444";

let nr = 0;
/** Ett möte: bokat svensk tid "2026-11-12 09:56", av vem, vilken art, med vilket bolag. */
function mote(svensk, vem, art, bolag) {
  const [dag, kl] = svensk.split(" ");
  // November är vintertid: UTC + 1.
  const [h, m] = kl.split(":").map(Number);
  const tid = new Date(Date.parse(`${dag}T00:00:00Z`) + ((h - 1) * 60 + m) * 60_000).toISOString();
  nr++;
  return {
    id: `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`,
    bokat_av: vem,
    bokat_nar: tid,
    art,
    kedja: { bolag_id: bolag.id, bolag: { namn: bolag.namn, telefon: bolag.telefon, doman: bolag.doman ?? null } },
  };
}
const b = (id, namn, telefon, doman) => ({ id: `b0000000-0000-4000-8000-${String(id).padStart(12, "0")}`, namn, telefon, doman });

const ORION1 = b(1, "ORION CAR AB", "+46763124474", null);
const ORION2 = b(2, "ORION CAR AB", "+46722988988", null);
const NORDIC = b(3, "Nordic Grön & Markservice AB", "+46762795891", "nordicgronmark.se");

const RADER = [
  mote("2026-11-03 09:58", ZEN, "ny", b(10, "B2B Cleaning", "+46706774773", "b2bcleaning.se")),
  mote("2026-11-03 17:53", ZEN, "ny", b(11, "Göteborgs Premium Flytt", "+46722948560", "goteborgspremiumflytt.se")),
  mote("2026-11-04 14:38", MICK, "ny", NORDIC),
  mote("2026-11-05 16:11", MICK, "ny", ORION1),
  mote("2026-11-10 09:29", MICK, "ny", ORION2),
  // Micks 12/11: sex nya och en uppföljning.
  mote("2026-11-12 09:56", MICK, "ny", b(20, "KEVJO SERVICE AB", "+46730202675", "kevjo.se")),
  mote("2026-11-12 10:37", MICK, "ny", b(21, "Clean and Green Nordic AB", "+46704558979", "cleanandgreennordic.se")),
  mote("2026-11-12 11:01", MICK, "ny", b(22, "Tuvegårdens Allt i Hem AB", "+4631820088", "flyttochroj.se")),
  mote("2026-11-12 11:12", MICK, "uppfoljning", NORDIC),
  mote("2026-11-12 12:14", MICK, "ny", b(23, "PEGU Byggservice", "+46760444022", null)),
  mote("2026-11-12 16:32", MICK, "ny", b(24, "Make your dream AB", "+46723191988", "mbyggservice.se")),
  mote("2026-11-12 16:59", MICK, "ny", b(25, "Bringish AB", "+46107078430", "bringish.se")),
  // 13/11: Zens uppföljning, fem nya för Mick och Carls två första någonsin.
  mote("2026-11-13 11:04", ZEN, "uppfoljning", NORDIC),
  mote("2026-11-13 12:05", MICK, "ny", b(30, "movea clean sweden AB", "+4640444154", "moveaclean.se")),
  mote("2026-11-13 13:28", MICK, "ny", b(31, "Maya Städ", "+46766001968", null)),
  mote("2026-11-13 14:13", MICK, "ny", b(32, "S&M Flytt och städ AB", "+46701453650", null)),
  mote("2026-11-13 14:45", CARL, "ny", b(33, "Lundgrens Portservice AB", "+46706660437", null)),
  mote("2026-11-13 15:11", CARL, "ny", b(34, "AJ Lås Och Säkerhet AB", "+46791023372", null)),
  mote("2026-11-13 16:01", MICK, "ny", b(35, "Direkt Hjälpen i Skåne AB", "+46704535256", null)),
  mote("2026-11-13 16:14", MICK, "ny", b(36, "LX Städ", "+46704524878", "lxstad.se")),
];
const svDag = (iso) => new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 10);

// -----------------------------------------------------------------------------
avsnitt("Samma bolag");
// -----------------------------------------------------------------------------
ok("bolagsformen och skiftläget skiljer inte: ORION CAR AB = Orion Car", normNamn("ORION CAR AB") === normNamn("Orion Car") && normNamn("Orion Car") === "orioncar");
ok("aktiebolag och (publ) räknas inte heller", normNamn("AEOB Skogservices Aktiebolag") === normNamn("AEOB Skogservices") && normNamn("Foo AB (publ)") === "foo");
ok("skiljetecken och mellanrum räknas inte, åäö står kvar", normNamn("Gbg kulör & måleri AB") === "gbgkulörmåleri");
ok("ett för kort namn känner inte igen något", normNamn("AB") === null && normNamn("A B") === null && normNamn("") === null && normNamn(null) === null);
ok("+46 och 0 är samma nummer", normTelefon("+46 70-677 47 73") === "0706774773" && normTelefon("070-677 47 73") === "0706774773" && normTelefon("0046706774773") === "0706774773");
ok("ett göteborgsnummer i +46-form", normTelefon("+4631820088") === "031820088");
ok("för kort är inget nummer", normTelefon("123") === null && normTelefon("") === null && normTelefon(undefined) === null);
ok("domänen utan protokoll, www och sökväg", normDoman("https://www.Orion.se/om?x=1") === "orion.se" && normDoman("orion.se.") === "orion.se");
ok("en gmail-adress säger inget om bolaget", normDoman("gmail.com") === null && normDoman("hotmail.se") === null);
ok("utan punkt är det ingen domän", normDoman("orion") === null && normDoman(null) === null);

// -----------------------------------------------------------------------------
avsnitt("Vilka möten som räknas");
// -----------------------------------------------------------------------------
const raknas = raknadeMoten(RADER);
const raknadePa = (vem, dag) => RADER.filter((m) => m.bokat_av === vem && svDag(m.bokat_nar) === dag && raknas.has(m.id)).length;
const orion = RADER.filter((m) => m.kedja.bolag.namn === "ORION CAR AB");
ok("ORION CAR AB 5/11 räknas", raknas.has(orion[0].id));
ok("ORION CAR AB 10/11 räknas inte: samma namn, nytt bolag i Möten, fem dagar senare", !raknas.has(orion[1].id));
ok("Mick 12/11: sex, uppföljningen räknas inte", raknadePa(MICK, "2026-11-12") === 6, String(raknadePa(MICK, "2026-11-12")));
ok("Mick 13/11: fem", raknadePa(MICK, "2026-11-13") === 5, String(raknadePa(MICK, "2026-11-13")));
ok("Carl 13/11: två", raknadePa(CARL, "2026-11-13") === 2);
ok("Zens uppföljning 13/11 räknas inte", raknadePa(ZEN, "2026-11-13") === 0);
ok("en ombokning räknas aldrig", !raknadeMoten([mote("2026-11-13 09:00", MICK, "ombokning", b(90, "Nytt Bolag AB", "+46700000090", null))]).size);
{
  const ett = b(91, "Ett Bolag AB", "+46700000091", "ettbolag.se");
  const tva = (namn, tel, dom) => b(92, namn, tel, dom);
  const par = (andra, dagar = 30) => {
    const forsta = mote("2026-08-01 10:00", CARL, "ny", ett);
    const sen = mote("2026-08-01 10:00", MICK, "ny", andra);
    sen.bokat_nar = new Date(Date.parse(forsta.bokat_nar) + dagar * 86_400_000).toISOString();
    return raknadeMoten([forsta, sen]).has(sen.id);
  };
  ok("samma telefon i ett annat bolag är samma bolag", !par(tva("Annat Namn AB", "070-000 00 91", null)));
  ok("samma domän i ett annat bolag är samma bolag", !par(tva("Annat Namn AB", "+46700000999", "https://www.ettbolag.se/")));
  ok("samma bolag i Möten är samma bolag, vem som än bokar", !par(ett));
  ok("ett helt annat bolag räknas", par(tva("Annat Namn AB", "+46700000999", "annat.se")));
  ok(`efter ${DUBBLETT_DAGAR} dagar är det ett nytt möte`, par(ett, DUBBLETT_DAGAR + 1) && !par(ett, DUBBLETT_DAGAR));
  ok("en gmail-domän gör inte två bolag till ett", par(tva("Annat Namn AB", "+46700000999", "gmail.com")) === par(tva("Annat Namn AB", "+46700000999", null)));
}
{
  // Fönstret räknas från bolagets senaste möte: en kundrelation som träffas var sjätte vecka är en.
  const k = b(93, "Kund AB", "+46700000093", null);
  const a = mote("2026-06-01 10:00", MICK, "ny", k);
  const u = mote("2026-07-15 10:00", MICK, "uppfoljning", k);
  const c = mote("2026-09-20 10:00", MICK, "ny", k);
  ok("fönstret räknas från bolagets senaste möte, också en uppföljning", !raknadeMoten([a, u, c]).has(c.id) && raknadeMoten([a, c]).has(c.id));
}
ok("två lika tider avgörs på id, och svaret beror inte på radernas ordning", lika([...raknadeMoten([...RADER].reverse())].sort(), [...raknas].sort()));
ok("ett möte utan bokare räknas inte", !raknadeMoten([{ ...RADER[0], bokat_av: null }]).size);
ok("ett möte utan läsbar tid räknas inte", !raknadeMoten([{ ...RADER[0], bokat_nar: "inget" }]).size);
ok("ett möte utan bolag räknas (det går inte att känna igen)", raknadeMoten([{ ...RADER[0], kedja: null }]).size === 1);
ok("fönstret börjar 91 dagar före månaden", motesfonsterFran("2026-11-01") === "2026-08-02T00:00:00.000Z");

// -----------------------------------------------------------------------------
avsnitt("Bilden: mötesbokarna");
// -----------------------------------------------------------------------------
const person = (id) => ({ nyckel: `k-${id.slice(0, 4)}`, namn: id === MICK ? "Mick E." : id === CARL ? "Carl B." : id === ZEN ? "Zen A." : "En säljare", initialer: "XX", dold: id === DOLDA });
const underlag = (over = {}) => ({
  rader: RADER,
  tidigare: new Set(),
  idag: "2026-11-13",
  manad: "2026-11",
  iLaget: () => true,
  person,
  nyckel: (id) => `k-${id.slice(0, 4)}`,
  kandidater: [],
  ...over,
});
{
  const { moten, personer } = formaMoten(underlag());
  const rad = (id) => moten.bokare.find((x) => x.person === `k-${id.slice(0, 4)}`);
  ok("laget i dag: Micks fem och Carls två", moten.idag === 7, String(moten.idag));
  ok("laget i månaden: Zen 2, Mick 2 + 6 + 5, Carl 2 (ORION 10/11 räknas inte)", moten.manad === 17, String(moten.manad));
  ok("Mick: fem i dag, tretton i månaden", rad(MICK).idag === 5 && rad(MICK).manad === 13);
  ok("Zen står med: han bokade i månaden", rad(ZEN)?.manad === 2 && rad(ZEN).idag === 0);
  ok("dagens lista är det nyaste först", moten.lista[0].tid > moten.lista.at(-1).tid);
  const carls = moten.lista.filter((m) => m.person === `k-${CARL.slice(0, 4)}`).reverse();
  ok("Carls första möte är hans första någonsin, det andra inte", carls[0].forstaNagonsin && !carls[1].forstaNagonsin);
  ok("Micks möten i dag är inte hans första någonsin", moten.lista.filter((m) => m.person === `k-${MICK.slice(0, 4)}`).every((m) => !m.forstaNagonsin));
  ok("dagsantalet räknas i tidsordning: Micks sista är det femte", moten.lista[0].bokarensDagsantal === 5 && moten.lista[0].person === `k-${MICK.slice(0, 4)}`);
  ok("personerna i bilden är alla som står i listan", [MICK, CARL, ZEN].every((id) => personer.includes(id)));
  const tidigare = formaMoten(underlag({ tidigare: new Set([CARL]) }));
  ok("har Carl bokat före fönstret är det inte hans första", tidigare.moten.lista.every((m) => !m.forstaNagonsin));
  ok("forstaKandidater: Carl är ny i dag, Mick och Zen är det inte", lika(forstaKandidater(RADER, "2026-11-13"), [CARL]));
  const medRoll = formaMoten(underlag({ kandidater: [DOLDA, "55555555-5555-4555-8555-555555555555"] }));
  ok("en mötesbokare utan möten står i listan med noll", medRoll.moten.bokare.some((x) => x.person === "k-5555" && x.idag === 0 && x.manad === 0));
  ok("en dold mötesbokare står inte i listan", !medRoll.moten.bokare.some((x) => x.person === `k-${DOLDA.slice(0, 4)}`));
  const annatLag = formaMoten(underlag({ iLaget: (id) => id !== MICK }));
  ok("laget väljs: Micks möten räknas inte i ett lag utan honom", annatLag.moten.idag === 2 && !annatLag.moten.bokare.some((x) => x.person === `k-${MICK.slice(0, 4)}`));
  const dold = formaMoten(underlag({ rader: [mote("2026-11-13 10:00", DOLDA, "ny", b(95, "Dolt AB", "+46700000095", null))] }));
  ok("en dold säljares möte räknas i laget men bär inget personligt", dold.moten.idag === 1 && dold.moten.lista[0].bokarensDagsantal === 0 && !dold.moten.lista[0].forstaNagonsin && dold.moten.bokare.length === 0);
}

// -----------------------------------------------------------------------------
avsnitt("Bilden är display-säker");
// -----------------------------------------------------------------------------
{
  const pers = (id, fn, en, roller, status = "active") => ({ id, first_name: fn, last_name: en, team_id: null, status, employee_role: roller.map((role) => ({ role })) });
  const NY_BOKARE = "66666666-6666-4666-8666-666666666666";
  const rader = {
    lag: null,
    bygge: "abc",
    personer: [pers(MICK, "Mick", "Ekström", ["salesperson"]), pers(CARL, "Carl", "Berg", ["salesperson"]), pers(ZEN, "Zen", "Al", ["ceo"]), pers(NY_BOKARE, "Nora", "Ny", [MOTESBOKARROLL])],
    val: [],
    paket: [],
    manadens: [],
    senaste: [],
    statistik: null,
    handelser: [],
    moten: { rader: RADER, tidigare: [] },
    nyckel: (id) => `h${id.replace(/\D/g, "").slice(0, 10)}`,
  };
  const bild = formaOgonblick(rader, normalisera(undefined), new Date("2026-11-13T15:20:00Z"), null);
  const json = JSON.stringify(bild);
  const lackor = ["ORION", "Orion", "KEVJO", "Maya Städ", "LX Städ", "+467", "0704", "lxstad", ".se", MICK, CARL, "b0000000", "00000000-0000"].filter((x) => json.includes(x));
  ok("inget bolagsnamn, ingen telefon, ingen domän och inget id i bilden", lackor.length === 0, lackor.join(" "));
  ok("bilden bär mötena", bild.moten?.idag === 7 && bild.moten.lista.length === 7);
  ok("mötesbokaren med rollen och utan möten står i listan", bild.moten.bokare.some((x) => bild.personer[x.person]?.namn.startsWith("Nora") && x.idag === 0));
  ok("en ren mötesbokare står inte i topplistan för order", !SALJANDE_ROLLER.has(MOTESBOKARROLL) && !bild.saljare.some((x) => bild.personer[x.person]?.namn.startsWith("Nora")));
  ok("mötena rör inte orderna eller månadens ordervärde", bild.order.length === 0 && bild.manad.antal === 0 && bild.manad.varde === 0 && bild.idag.antal === 0);
  ok("lasBild tar emot en bild med möten", lasBild(JSON.parse(json)) !== null);
  const utan = formaOgonblick({ ...rader, moten: null }, normalisera(undefined), new Date("2026-11-13T15:20:00Z"), null);
  ok("utan möten (de gick inte att läsa) är fältet null, och resten är som vanligt", utan.moten === null && lasBild(JSON.parse(JSON.stringify(utan))) !== null);
  const { moten: _m, ...gammal } = utan;
  ok("en bild från ett äldre bygge, utan fältet, tas emot", lasBild(JSON.parse(JSON.stringify(gammal))) !== null);
  ok("testtyperna för mötena tas emot i bilden", formaOgonblick({ ...rader, handelser: ["mote", "moteForsta", "moteFem", "moteTio", "knuff"].map((typ, i) => ({ id: i + 1, kind: "test", payload: { typ }, created_at: "2026-11-13T15:19:00Z" })) }, normalisera(undefined), new Date("2026-11-13T15:20:00Z"), null).handelser.length === 5);
}

// -----------------------------------------------------------------------------
avsnitt("Nivån");
// -----------------------------------------------------------------------------
ok("första i dag", motesniva(0, 1, false, false) === "dagensForsta");
ok("första någonsin går före dagens första", motesniva(0, 1, true, false) === "forsta");
ok("ett till", motesniva(2, 3, false, false) === "vanlig");
ok("fem", motesniva(4, 5, false, false) === "fem");
ok("sex är ett till", motesniva(5, 6, false, false) === "vanlig");
ok("tio", motesniva(9, 10, false, false) === "tio");
ok("tre på en gång från fyra till sju är fem", motesniva(4, 7, false, false) === "fem");
ok("från fyra till elva är tio", motesniva(4, 11, false, false) === "tio");
ok("fem går före första någonsin (fem nya på en gång)", motesniva(0, 5, true, false) === "fem");
ok("en dold säljare får laget, aldrig något personligt", motesniva(4, 5, true, true) === "lag");

// -----------------------------------------------------------------------------
avsnitt("Planeringen");
// -----------------------------------------------------------------------------
const DAG = "2026-11-13";
const kl = (t) => `${DAG}T${t}Z`;
const P = {
  mick: { nyckel: "mick", namn: "Mick E.", initialer: "ME", dold: false },
  carl: { nyckel: "carl", namn: "Carl B.", initialer: "CB", dold: false },
  dold: { nyckel: "dold", namn: "En säljare", initialer: "·", dold: true },
};
const mm = (nyckel, person, tid, antal, forsta = false) => ({ nyckel, person, tid: kl(tid), dag: DAG, forstaNagonsin: forsta, bokarensDagsantal: antal });
function bild({ nu, moten = [] }) {
  const { lag, mal, tavling, ...inst } = structuredClone(STANDARD);
  const per = new Map();
  for (const m of moten) per.set(m.person, Math.max(per.get(m.person) ?? 0, m.bokarensDagsantal));
  return {
    v: 1, nu: kl(nu), bygge: "x", lag: null, skarm: null, installningar: inst,
    manad: { nyckel: "2026-11", namn: "November", antal: 3, varde: 40_000, mal: null, forvantat: null, prognos: null, dagar: { gangna: 9, totalt: 21 }, natt: null, storsta: null },
    idag: { datum: DAG, veckodag: 4, antal: 0, summa: 0, bastaDag: 0 },
    saljare: [], historik: [], order: [], personer: P, handelser: [], tavling: null, vinnare: null,
    moten: { idag: moten.length, manad: moten.length + 10, lista: [...moten].reverse(), bokare: [...per].map(([person, idag]) => ({ person, idag, manad: idag + 5 })) },
  };
}
const steg = (fore, ny, minne) => planera(fore, ny, minne ?? planera(null, fore, null).minne);
{
  const a = bild({ nu: "13:00:00", moten: [mm("m1", "mick", "11:05:00", 1), mm("m2", "mick", "12:28:00", 2), mm("m3", "mick", "12:58:00", 3)] });
  const start = planera(null, a, null);
  ok("vid start firas inget, och dagens möten är sedda", start.firanden.length === 0 && lika(start.minne.moten.sort(), ["m1", "m2", "m3"]));
  const b4 = bild({ nu: "13:14:00", moten: [...a.moten.lista.slice().reverse(), mm("m4", "mick", "13:13:00", 4)] });
  const r4 = steg(a, b4, start.minne);
  ok("ett fjärde möte är ett till", r4.firanden.length === 1 && r4.firanden[0].typ === "mote" && r4.firanden[0].niva === "vanlig" && r4.firanden[0].antal === 4);
  ok("och blir känt", r4.minne.moten.includes("m4"));
  const b5 = bild({ nu: "15:02:00", moten: [...b4.moten.lista.slice().reverse(), mm("m5", "mick", "15:01:00", 5)] });
  const r5 = steg(b4, b5, r4.minne);
  ok("det femte är fem", r5.firanden[0]?.niva === "fem" && r5.firanden[0].antal === 5);
  ok("samma bild igen firar inget (en omladdning med minnet)", steg(b5, b5, r5.minne).firanden.length === 0);
  ok("en omladdning (start med minnet) firar inget", planera(null, b5, r5.minne).firanden.length === 0);
  const gammal = bild({ nu: "15:30:00", moten: [...b5.moten.lista.slice().reverse(), mm("m6", "mick", "15:05:00", 6)] });
  ok("ett möte som bokades för mer än tio minuter sedan firas inte, men blir känt", (() => {
    const r = steg(b5, gammal, r5.minne);
    return r.firanden.length === 0 && r.minne.moten.includes("m6");
  })());
  const tre = bild({ nu: "15:03:00", moten: [...b4.moten.lista.slice().reverse(), mm("m5", "mick", "15:01:00", 5), mm("m6", "mick", "15:02:00", 6), mm("m7", "mick", "15:02:30", 7)] });
  const r3 = steg(b4, tre, r4.minne);
  ok("tre på en gång från fyra till sju firas en gång, som fem, med sju", r3.firanden.length === 1 && r3.firanden[0].niva === "fem" && r3.firanden[0].antal === 7 && r3.firanden[0].nya === 3);
  ok("firandet bär alla tre mötenas nycklar och det senaste mötet", lika(r3.firanden[0].nycklar, ["m5", "m6", "m7"]) && r3.firanden[0].mote.nyckel === "m7");
  const tva = bild({ nu: "14:46:00", moten: [...a.moten.lista.slice().reverse(), mm("c1", "carl", "14:45:00", 1, true), mm("m4", "mick", "14:45:30", 4)] });
  const r2 = steg(a, tva, start.minne);
  ok("två bokare samtidigt: ett firande var, i tidsordning", r2.firanden.length === 2 && r2.firanden[0].mote.person === "carl" && r2.firanden[1].mote.person === "mick");
  ok("Carls första någonsin", r2.firanden[0].niva === "forsta");
  const dold = bild({ nu: "14:46:00", moten: [...a.moten.lista.slice().reverse(), mm("d1", "dold", "14:45:00", 0)] });
  const rd = steg(a, dold, start.minne);
  ok("en dold säljares möte firas för laget", rd.firanden.length === 1 && rd.firanden[0].niva === "lag");
  const igar = { ...bild({ nu: "13:00:00", moten: [] }), idag: { datum: DAG, veckodag: 4, antal: 0, summa: 0, bastaDag: 0 } };
  ok("en bild utan möten (äldre bygge) går att planera", planera(null, { ...igar, moten: undefined }, null).minne.moten.length === 0 && steg({ ...igar, moten: undefined }, { ...igar, moten: undefined }).firanden.length === 0);
  const ordningen = steg(a, { ...b4, manad: { ...b4.manad, mal: 40_000, varde: 40_000 } }, { ...start.minne }).firanden.map((f) => f.typ);
  ok("mötet kommer före målet", lika(ordningen, ["mote", "malet"]) || lika(ordningen, ["mote"]), ordningen.join(","));
}

// -----------------------------------------------------------------------------
avsnitt("Kön och tavlan");
// -----------------------------------------------------------------------------
{
  const m = mm("m5", "mick", "15:01:00", 5);
  const ny = bild({ nu: "15:02:00", moten: [mm("m4", "mick", "13:13:00", 4), m] });
  const post = { firande: { typ: "mote", mote: m, niva: "fem", antal: 5, nya: 1, nycklar: ["m5"] }, efter: ny };
  ok("ett möte som finns kvar spelas", aktuell(post, ny) === post);
  ok("ett möte som raderats medan det väntade spelas inte", aktuell(post, bild({ nu: "15:03:00", moten: [mm("m4", "mick", "13:13:00", 4)] })) === null);
  const f = forlopp(post, { fore: ny, senaste: ny, vantande: [], nuIso: kl("15:02:01"), ordning: "varde" });
  ok("förloppet är ett möte med nivå, bokare och lagets tal", f.data.typ === "mote" && f.data.niva === "fem" && f.data.person.namn === "Mick E." && f.data.lag.idag === 2);
  ok("ett möte landar ingen order", f.nycklar.length === 0 && lika(f.moten, ["m5"]) && f.tider.byt === 0);
  ok("förloppets längd är nivåns", f.varaktighet === MOTE_LANGD.fem);
  const tal = motestal(ny.moten, new Set(["m5"]), ny.personer);
  ok("listan räknar inte ett möte som väntar på sitt firande", tal.idag === 1 && tal.rader[0].idag === 4 && tal.rader[0].vem.namn === "Mick E.");
  const v0 = visning({ visad: ny, vantande: [post], spel: null, r: 0, senaste: ny });
  ok("i vila, med mötet i kön: listan visar det inte", v0.moten.idag === 1);
  const v1 = visning({ visad: ny, vantande: [], spel: f, r: MOTE_LANDAR.fem - 1, senaste: ny });
  const v2 = visning({ visad: ny, vantande: [], spel: f, r: MOTE_LANDAR.fem, senaste: ny });
  ok("under firandet syns mötet i listan när blocket landat, inte förr", v1.moten.idag === 1 && v2.moten.idag === 2);
  ok("ett möte ändrar inte topplistans tal", lika(v2.tal, visning({ visad: ny, vantande: [], spel: null, r: 0 }).tal));
  ok("mötesbokarna i ordning: flest i dag först", lika(motestal({ idag: 3, manad: 9, lista: [], bokare: [{ person: "a", idag: 1, manad: 9 }, { person: "b", idag: 2, manad: 1 }] }, new Set()).rader.map((r) => r.person), ["b", "a"]));
  for (const [testtyp, niva] of [["mote", "vanlig"], ["moteForsta", "forsta"], ["moteFem", "fem"], ["moteTio", "tio"]]) {
    const t = forlopp({ firande: { typ: "test", testtyp, id: 1 }, efter: ny }, { fore: ny, senaste: ny, vantande: [], nuIso: kl("15:02:01"), ordning: "varde" });
    ok(`testet ${testtyp} spelar ${niva}, märkt test och utan att räknas`, t.test && t.data.typ === "mote" && t.data.niva === niva && t.data.person.nyckel.startsWith("test") && (t.moten ?? []).length === 0);
  }
}

// -----------------------------------------------------------------------------
avsnitt("Tiderna och ljudet");
// -----------------------------------------------------------------------------
{
  const nivaer = ["vanlig", "lag", "dagensForsta", "forsta", "fem", "tio"];
  ok("varje nivå är längre än den förra: ett till < första < fem < tio", MOTE_LANGD.vanlig < MOTE_LANGD.dagensForsta && MOTE_LANGD.dagensForsta < MOTE_LANGD.forsta && MOTE_LANGD.forsta < MOTE_LANGD.fem && MOTE_LANGD.fem < MOTE_LANGD.tio);
  ok("blocket landar innan firandet är slut", nivaer.every((n) => MOTE_LANDAR[n] < MOTE_LANGD[n] - 60));
  ok("fem: fyra block i takt, en paus, det femte", [0, 1, 2, 3].every((i) => femBlock(i) < femBlock(i + 1)) && femBlock(4) - femBlock(3) > femBlock(3) - femBlock(2));
  const glapp = Array.from({ length: 8 }, (_, i) => tioBlock(i + 1) - tioBlock(i));
  ok("tio: allt tätare, sedan en paus före det tionde", glapp.every((g, i) => i === 0 || g <= glapp[i - 1]) && tioBlock(9) - tioBlock(8) > glapp[0], glapp.join(","));
  const spar = nivaer.flatMap((n) => moteLjud(n, 5));
  ok("varje ljud i mötenas spår är en fil", spar.every((p) => LJUD.includes(p.ljud)));
  const orderns = new Set([...orderLjud("vanlig", 18_900), ...orderLjud("stor", 52_800), ...orderLjud("forsta", 9_800), ...serieLjud(3)].map((p) => p.ljud));
  ok("mötena låter aldrig som en order: ingen kassa, inget horn, inga pengar", !spar.some((p) => ["kassa", "horn", "pengar"].includes(p.ljud)));
  ok("och ett mötesljud (anslag, klocka) hörs i varje nivå", nivaer.every((n) => moteLjud(n, 5).some((p) => ["pling", "valkommen", "ackord", "klang", "ton"].includes(p.ljud) && !orderns.has(p.ljud))));
  ok("tonen i fem stiger för varje block", moteLjud("fem", 5).filter((p) => p.ljud === "ton").map((p) => p.p.takt).every((t, i, a) => i === 0 || t > a[i - 1]));
  ok("tio har klangen och publiken på det tionde", moteLjud("tio", 10).some((p) => p.ljud === "klang" && p.f === MOTE_LANDAR.tio) && moteLjud("tio", 10).some((p) => p.ljud === "publik"));
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
