import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { fullName } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { lasSidvis } from "@/lib/sidvis";
import { LAGE_KOL, REGEL_OBEKRAFTAT, arChefFor, lasInst, lasKrets, motesInfo, type LageRad } from "./forslag";
import { nyckelDelar, oppetLage } from "./forslagforma";
import { blevPerManad, dagstalPerManad, taktKrets, teamPersoner, teamTal, type TeamOrder, type TeamPerson } from "./hemforma";
import { KALLRAD, dagText, manadsnamn, textLagetsOppna, textTakt, textTaktKort, textTaktFacit } from "./hemtext";
import { lokalDag } from "./motesflode";
import { inomKrets, type StatMote } from "./motesstatforma";
import { arbetsdagarIManad, taktFacit, taktFacitVid, taktLage, type TaktManad, type TaktTraff } from "./takt";
import { forklaring, forstaDag, kedja, personVeckor, statusMotMal, tillMalet, veckofonster, type Led, type Orsak, type Status } from "./kedja";

/**
 * Nav 2.0: Teamet i månaden, på servern.
 *
 * ===========================================================================
 * VEM SOM SER KORTET avgörs av `mote_statkrets()`: den som har en krets större
 * än sig själv. Säljchef, vd och admin ser hela företaget, en teamledare sina.
 * Summorna räknas med service role för just den kretsen (en säljare får bara
 * läsa sina egna order), som Golvet gör. Inga rader om enskilda order lämnar
 * servern, bara antal.
 *
 * TALEN: nettoorder är samma `nettoAntal` som provisionens trappa. Målet är
 * summan av kretsens mål i Provision (`sales_target`). Takten är en uträkning,
 * inget löfte, och dess eget facit står bredvid: vad den sa vid samma antal
 * gångna arbetsdagar varje avslutad månad, och vad det blev. Sparade
 * morgonvärden (`nav_takt_dag`) går före; månader innan Nav började spara
 * räknas i efterhand ur signeringsdagarna och märks så.
 * ===========================================================================
 */

type Db = SupabaseClient;

export type NdTeam = {
  /** "2026-11". */
  manad: string;
  manadsnamn: string;
  netto: number;
  vantar: number;
  makulerade: number;
  mal: number | null;
  utanMal: number;
  takt: { gatt: number; totalt: number; prognos: number | null };
  /** Taktens facit vid samma antal gångna arbetsdagar, nyast först. */
  facit: TaktTraff[];
  /** Kortets färdiga rader (hemtext.ts). Samma data ger samma text. */
  text: { stort: string; rad: string; malrad: string | null; facit: string; kort: string };
  kalla: string;
};

const ORDER_KOL = "id, salesperson_id, status, signed_on, period_month, cancelled_on, cancel_period_month";

/** "2026-11" minus n månader. */
const manadMinus = (manad: string, n: number): string => {
  const [a, m] = manad.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 - n, 1, 12)).toISOString().slice(0, 7);
};

/**
 * REST-lagret kapar varje svar vid 1000 rader utan att säga det, så ett högre `.limit()` ger ett för lågt tal som
 * ser rätt ut. Order och möten läses därför sida för sida, i stabil ordning. Ett fel kastas, också på en senare
 * sida: en halv läsning lämnas aldrig ut som om den vore allt.
 */
export async function lasOrder(db: Db, krets: readonly string[] | null, fran: string): Promise<TeamOrder[]> {
  const rader = await lasSidvis<TeamOrder>((a, b) => {
    let q = db.from("sales_order").select(ORDER_KOL).or(`period_month.gte.${fran}-01,cancel_period_month.gte.${fran}-01`);
    if (krets !== null) q = q.in("salesperson_id", [...krets]);
    return q.order("id").range(a, b) as unknown as PromiseLike<{ data: TeamOrder[] | null; error: { message: string } | null }>;
  });
  return rader.map((o) => ({ ...o, signed_on: String(o.signed_on).slice(0, 10), cancelled_on: o.cancelled_on ? String(o.cancelled_on).slice(0, 10) : null }));
}

/** Alla möten från och med `fran` (mötestid eller bokningstid), sida för sida. Kretsen väljs av den som räknar. */
export async function lasStatMoten(db: Db, fran: string): Promise<StatMote[]> {
  const mr = await lasSidvis<MoteRad>((a, b) =>
    db.from("mote").select("id, kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, art, utfall, resultat, kalla, bekraftat_nar").or(`mote_tid.gte.${fran},bokat_nar.gte.${fran}`).order("id").range(a, b) as unknown as PromiseLike<{ data: MoteRad[] | null; error: { message: string } | null }>,
  );
  return mr.map((m) => ({
    id: m.id, kedja: m.kedja_id, bokatAv: m.bokat_av, hallsAv: m.halls_av, bokatNar: m.bokat_nar, moteTid: m.mote_tid, art: m.art, utfall: m.utfall, resultat: m.resultat, kalla: m.kalla, bekraftatNar: m.bekraftat_nar,
  }));
}

async function lasSparadTakt(db: Db, nyckel: string | null, fran: string): Promise<{ manad: string; gatt: number; prognos: number }[]> {
  if (!nyckel) return [];
  // Högst tretton månader för en krets, en rad per arbetsdag: under 300 rader, långt från REST-lagrets tak på 1000.
  const { data, error } = await db.from("nav_takt_dag").select("manad, gatt, prognos").eq("krets", nyckel).gte("manad", `${fran}-01`).limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { manad: string; gatt: number; prognos: number | null }[])
    .filter((r): r is { manad: string; gatt: number; prognos: number } => r.prognos !== null)
    .map((r) => ({ manad: String(r.manad).slice(0, 7), gatt: r.gatt, prognos: r.prognos }));
}

export type LettLag = { id: string; namn: string };

/**
 * Lagen läsaren leder, i namnordning. Golvet och Teamet behöver samma svar, så hemmet läser det en gång per
 * begäran och delar löftet. Ett fel kastas: ett tomt svar betyder att läsaren inte leder något lag.
 */
export async function lagenJagLeder(db: Db, mig: string): Promise<LettLag[]> {
  const { data, error } = await db.from("team").select("id, name").eq("lead_id", mig).order("name").limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { id: string; name: string }[]).map((t) => ({ id: t.id, namn: t.name }));
}

type MalRad = { employee_id: string; target_orders: number | null };

/** Kretsens mål i Provision för månaden, sida för sida. */
async function lasMal(db: Db, krets: readonly string[] | null, manad: string): Promise<MalRad[]> {
  return lasSidvis<MalRad>((a, b) => {
    let q = db.from("sales_target").select("employee_id, target_orders").eq("period_month", `${manad}-01`);
    if (krets !== null) q = q.in("employee_id", [...krets]);
    return q.order("id").range(a, b) as unknown as PromiseLike<{ data: MalRad[] | null; error: { message: string } | null }>;
  });
}

/** Avslutade månader med någon order alls, nyast först. En månad utan order har inget facit att visa. */
const avslutade = (dagstal: Record<string, Record<string, number>>, manad: string, antal: number): string[] =>
  Array.from({ length: antal }, (_x, i) => manadMinus(manad, i + 1)).filter((m) => Object.keys(dagstal[m] ?? {}).length > 0);

/** Kortets tal ur färdiga läsningar. Samma rader ger samma kort, var de än lästes. */
function teamKort(order: readonly TeamOrder[], mal: readonly MalRad[], sparade: { manad: string; gatt: number; prognos: number }[], krets: string[] | null, idag: string): NdTeam {
  const manad = idag.slice(0, 7);
  const tal = teamTal(order, mal, krets, manad);
  const takt = taktLage({ netto: tal.netto, manad, idag });
  const dagstal = dagstalPerManad(order, krets);
  const manader = avslutade(dagstal, manad, 3);
  const facit = taktFacitVid(takt.gatt, sparade, blevPerManad(order, krets, manader), dagstal);
  const t = textTakt({ netto: tal.netto, mal: tal.mal, prognos: takt.prognos, utanMal: tal.utanMal, manad });
  return { manad, manadsnamn: manadsnamn(manad), ...tal, takt, facit, text: { ...t, facit: textTaktFacit(facit), kort: textTaktKort(takt.prognos, facit) }, kalla: KALLRAD.regler };
}

/** Taktens sparade morgonvärden för kretsen. Kretsens nyckel beror på laget läsaren leder, så läsningen väntar bara på det. */
const sparadTakt = (db: Db, krets: string[] | null, leder: Promise<LettLag[]>, fran: string) =>
  leder.then((l) => lasSparadTakt(db, taktKrets(krets, l[0]?.id ?? null), fran));

/**
 * Kortet Teamet i månaden. `krets` är läsarens krets ur `mote_statkrets()`
 * (null = alla). Den som bara har sig själv får inget kort (null). `tz` är
 * installationens tidszon (`lasInst().m.tidszon`): den avgör vilken dag och
 * månad det är. `leder` är lagen läsaren leder, när hemmet redan har läst dem.
 * Ett läsfel kastas, så att hemmet kan skilja "inget kort för dig" från
 * "kortet gick inte att läsa".
 */
export async function byggTeam(user: CurrentUser, krets: string[] | null | undefined, o: { tz: string; nu?: Date; leder?: () => Promise<LettLag[]> }): Promise<NdTeam | null> {
  if (!user.employee || krets === undefined || !arChefFor(krets, user.employee.id)) return null;
  const db = supabaseAdmin();
  const idag = lokalDag(o.nu ?? new Date(), o.tz);
  const fran = manadMinus(idag.slice(0, 7), 3);
  const mig = user.employee.id;
  const leder = krets === null ? Promise.resolve([]) : o.leder ? o.leder() : lagenJagLeder(db, mig);
  const [order, mal, sparade] = await Promise.all([lasOrder(db, krets, fran), lasMal(db, krets, idag.slice(0, 7)), sparadTakt(db, krets, leder, fran)]);
  return teamKort(order, mal, sparade, krets, idag);
}

/* ------------------------------------------------------------------------ */
/* Genomgången: öppnas när kortet öppnas                                     */
/* ------------------------------------------------------------------------ */

/** En rad per person i lagets genomgång (skiss 9): kedjan, eget mål, läget och förklaringen med belägg. */
export type NdTeamRad = { id: string; namn: string; fornamn: string; mal: number | null; order: number; status: Status | null; led: Led[]; orsak: Orsak | null; forklaring: string; kommentar: string | null };

export type NdTeamGenomgang = {
  kort: NdTeam;
  /** Skiss 9: en rad per person med kedjan, och lagets tal runt omkring. */
  rader: NdTeamRad[];
  /** Möten i månaden vars tid har passerat utan utfall. */
  saknarUtfall: number;
  /** Till målet, när ett mål finns. */
  tillMalet: { kvar: number; dagar: number; perDag: number; hittills: number } | null;
  /** Uträkningen bakom takten, i klartext. */
  utrakning: string;
  /** En rad per person i bokstavsordning: antal, utan färg och utan dom. */
  personer: TeamPerson[];
  /** Lagets öppna rader om obekräftade möten, eller null när inga finns. */
  oppna: string | null;
  /** Varje avslutad månad: vad takten sa efter 5, 10 och 15 arbetsdagar, och vad det blev. */
  takten: TaktManad[];
  serInte: string;
  kalla: string;
};

type MoteRad = { id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: string; mote_tid: string; art: StatMote["art"]; utfall: StatMote["utfall"]; resultat: string | null; kalla: string; bekraftat_nar: string | null };

type PersonRad = { id: string; first_name: string | null; last_name: string | null; start_date: string | null; created_at: string | null };

export async function teamGenomgang(user: CurrentUser, nu: Date = new Date()): Promise<{ status: number; data: Record<string, unknown> }> {
  if (!user.employee) return { status: 401, data: { fel: "Du måste vara inloggad." } };
  const mig = user.employee.id;
  const supabase = await supabaseServer();
  const db = supabaseAdmin();
  // Kretsen och inställningarna samtidigt; allt annat beror på kretsen och läses sedan i en enda omgång.
  const [krets, inst] = await Promise.all([lasKrets(supabase, user), lasInst(db)]);
  if (krets === undefined) return { status: 500, data: { fel: "Det gick inte att läsa vilka du leder." } };
  if (!arChefFor(krets, mig)) return { status: 403, data: { fel: "Teamet i månaden visas för den som leder ett lag." } };

  const tz = inst.m.tidszon;
  const idag = lokalDag(nu, tz);
  const manad = idag.slice(0, 7);
  const fran = manadMinus(manad, 12);
  const manadStart = new Date(Date.UTC(Number(manad.slice(0, 4)), Number(manad.slice(5, 7)) - 1, 1) - 2 * 864e5).toISOString();

  // Kedjan behöver tio rullande veckor bakåt: samtal ur växeln, möten och order.
  const tioVeckor = new Date(Date.parse(`${idag}T12:00:00Z`) - 70 * 864e5).toISOString();
  const leder = krets === null ? Promise.resolve([]) : lagenJagLeder(db, mig);
  // Ordern läses en gång, tolv månader bakåt: kortet räknas ur samma rader som genomgången.
  const [order, pr, mr, sparade, { data: fr, error: frFel }, samtalRader, malRader] = await Promise.all([
    lasOrder(db, krets, fran),
    lasSidvis<PersonRad>((a, b) => {
      let q = db.from("employee").select("id, first_name, last_name, start_date, created_at").neq("status", "offboarded");
      if (krets !== null) q = q.in("id", krets);
      return q.order("id").range(a, b) as unknown as PromiseLike<{ data: PersonRad[] | null; error: { message: string } | null }>;
    }),
    lasStatMoten(db, tioVeckor < manadStart ? tioVeckor : manadStart),
    sparadTakt(db, krets, leder, fran),
    // Lagets öppna rader läses med läsarens egen klient: RLS avgör vilka förslag hen får se.
    supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("sort", "forslag").eq("prov", false).is("dom", null).gt("utgar", nu.toISOString()).limit(200),
    // Vecka för vecka samtidigt: ungefär 12 000 samtal på tio veckor blir två varv i stället för tolv sidor i följd.
    Promise.all(veckofonster(tioVeckor, nu.toISOString()).map(([fran, till]) => lasSidvis<{ employee_id: string | null; started_at: string }>((a, b) => {
      let q = db.from("phone_call").select("employee_id, started_at").gte("started_at", fran).not("employee_id", "is", null);
      if (till) q = q.lt("started_at", till);
      if (krets !== null) q = q.in("employee_id", [...krets]);
      return q.order("id").range(a, b) as unknown as PromiseLike<{ data: { employee_id: string | null; started_at: string }[] | null; error: { message: string } | null }>;
    }))).then((v) => v.flat()),
    lasMal(db, krets, manad),
  ]);
  // Lagets öppna rader är en bisak: faller läsningen visas resten, och felet hamnar i loggen.
  if (frFel) console.error(`hem: lagets öppna rader gick inte att läsa: ${frFel.message}`);
  const kort = teamKort(order, malRader, sparade, krets, idag);

  const allaMoten = mr;
  const moten = inomKrets(allaMoten, [], krets).moten;
  const folk = pr.map((p) => ({ id: p.id, namn: fullName(p as { first_name: string; last_name: string }) }));
  const borjade = new Map(pr.map((p) => [p.id, { start: p.start_date ? String(p.start_date).slice(0, 10) : null, lagd: p.created_at ? lokalDag(p.created_at, tz) : null }]));
  const rader = teamPersoner(folk, moten, order, manad, tz);
  // Bara de som har något att visa i månaden. En rad med bara nollor säger ingenting.
  const personer = rader.filter((p) => p.bokade || p.hallna || p.uteblivna || p.order);

  // Lagets öppna rader: förslag som fortfarande går att välja i, och hur många som saknar ett val.
  const forslag = (fr ?? []) as unknown as LageRad[];
  let oppna: string | null = null;
  if (forslag.length) {
    const info = await motesInfo(db, forslag.map((r) => nyckelDelar(r.nyckel)?.mote ?? ""));
    const aktuella = forslag.filter((r) => {
      const m = info.get(nyckelDelar(r.nyckel)?.mote ?? "")?.m ?? null;
      return r.beslut_id ? r.beslut?.val !== "inaktuellt" && !!m : oppetLage(r.nyckel, r.utgar ?? "", m, nu, tz) === "oppet";
    });
    if (aktuella.length) {
      const dagar = [...new Set(aktuella.map((r) => nyckelDelar(r.nyckel)?.dag ?? ""))];
      oppna = textLagetsOppna(aktuella.length, aktuella.filter((r) => !r.beslut_id).length, dagar.length === 1 ? dagText(dagar[0], lokalDag(nu, tz)) : null);
    }
  }

  const dagstal = dagstalPerManad(order, krets);
  const manader = avslutade(dagstal, manad, 12);
  const takten = taktFacit(sparade, blevPerManad(order, krets, manader), dagstal);
  const dagar = arbetsdagarIManad(manad);
  const utrakning =
    kort.takt.prognos === null
      ? `Ingen arbetsdag har gått i ${kort.manadsnamn} än, så det finns ingen takt att räkna på.`
      : `${kort.netto} order på ${kort.takt.gatt} ${kort.takt.gatt === 1 ? "arbetsdag" : "arbetsdagar"}, gånger månadens ${dagar.length} arbetsdagar, blir ungefär ${kort.takt.prognos}.`;
  // Skiss 9: en rad per person med kedjan. Bara de som har ett mål eller något i månaden.
  const malPer = new Map(malRader.map((m) => [m.employee_id, m.target_orders ?? null]));
  const dag = (iso: string) => lokalDag(iso, tz);
  const forsta = allaMoten.filter((m) => m.art === "ny");
  const radIds = rader.filter((p) => p.bokade || p.hallna || p.uteblivna || p.order || malPer.get(p.id)).map((p) => p.id);
  const lagRader: NdTeamRad[] = rader.filter((p) => radIds.includes(p.id)).map((p) => {
    const h = {
      samtal: samtalRader.filter((c) => c.employee_id === p.id).map((c) => dag(c.started_at)),
      bokade: forsta.filter((m) => m.bokatAv === p.id).map((m) => dag(m.bokatNar)),
      hallna: forsta.filter((m) => m.hallsAv === p.id && m.utfall === "hallet").map((m) => dag(m.moteTid)),
      uteblev: forsta.filter((m) => m.hallsAv === p.id && m.utfall === "uteblev").map((m) => dag(m.moteTid)),
      order: order.filter((o) => o.salesperson_id === p.id && o.signed_on).map((o) => o.signed_on),
    };
    const v = personVeckor(h, idag, forstaDag(borjade.get(p.id), [...h.samtal, ...h.bokade, ...h.hallna, ...h.uteblev, ...h.order]));
    const k = kedja(v.veckor), mal = malPer.get(p.id) ?? null;
    return { id: p.id, namn: p.namn, fornamn: p.namn.split(" ")[0], mal, order: p.order, status: statusMotMal(p.order, mal, kort.takt.gatt, kort.takt.totalt), led: k.led, orsak: k.orsak, forklaring: forklaring(k.led, k.orsak, v.s, v.f), kommentar: null };
  });
  const saknarUtfall = moten.filter((m) => m.art === "ny" && m.utfall === null && Date.parse(m.moteTid) < nu.getTime() && lokalDag(m.moteTid, tz).slice(0, 7) === manad).length;
  const g: NdTeamGenomgang = {
    kort, rader: lagRader, saknarUtfall, tillMalet: tillMalet(kort.netto, kort.mal, kort.takt.gatt, kort.takt.totalt), utrakning, personer, oppna, takten,
    serInte: "Det här ser jag inte: order som inte är inlagda i Nav, och varför en order makulerades.",
    kalla: KALLRAD.regler,
  };
  return { status: 200, data: { team: g } };
}
