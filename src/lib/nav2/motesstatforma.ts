/**
 * Nav 2.0, Möten: de rena talen på Mötessidan (B2).
 *
 * Inga tal lagras. De räknas fram ur mötesraderna (vyn `mote`) och
 * kedjeraderna (vyn `mote_kedja_utfall`) varje gång sidan läses, så att siffran
 * alltid går att följa ner till raderna den bygger på (`bakom`).
 *
 * Allt här är rena funktioner utan importer, så att provet kan köras med bara
 * `node --experimental-strip-types`. En kvot vars nämnare är 0 får `andel: null`
 * (gränssnittet visar `–`), aldrig NaN eller Infinity.
 */
import { motesTz, skaBekraftas } from "./motesflode.ts";

export type StatMote = {
  id: string; kedja: string; bokatAv: string; hallsAv: string; bokatNar: string; moteTid: string;
  art: "ny" | "ombokning" | "uppfoljning"; utfall: "hallet" | "uteblev" | "avbokat" | null;
  resultat: string | null; kalla: string;
  /** När bokaren bekräftade mötet med kunden (0260). Saknas fältet räknas mötet som obekräftat. */
  bekraftatNar?: string | null;
};
export type StatKedja = {
  id: string; forstaBokatAv: string; forstaBokatNar: string; forstaMoteTid: string | null;
  forstaHallnaHallsAv: string | null; avslut: "affar" | "nej" | "avbokat" | null; avslutNar: string | null;
  affarForstaMote: boolean; offertNar: string | null; kolumn: string | null; kalla: string;
};
export type Kvot = { andel: number | null; n: number; av: number };
export type Veckotal = {
  samtal: number; bokade: number; per100: number | null; hallna: Kvot; raddade: number;
  affarer: Kvot; forstaMote: Kvot; bokatTillAffar: number; oppnaOfferter: number; tysta: number; utanUtfall: number;
};

export type Period = { fran: string; till: string };

// Beställaren 2026-11-01: samtal kortare än 5 minuter räknas inte (samma 300 i 0267 och i rutten).
export const SAMTAL_MIN_SEK = 300;

const MS_PER_DAG = 86_400_000;
const TRETTIO_MIN = 30 * 60_000;

// Stockholmsdagen (YYYY-MM-DD) för en tidsstämpel. En bokning 23:30 UTC en
// söndag är måndag i Sverige, och det är svenska dagar säljarna räknar i.
// Samma mönster som dag() i avtalforma.ts.
const stockholmsdag = (ts: string | number | Date): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: motesTz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

// Båda ändarna räknas in. YYYY-MM-DD sorterar rätt som text.
const iVeckan = (ts: string | null, v: Period): boolean => {
  if (!ts) return false;
  const d = stockholmsdag(ts);
  return d >= v.fran && d <= v.till;
};

// Hela dagar mellan två Stockholmsdagar (inte timmar, så 23:50 till 00:10 blir 1).
const dagarMellan = (fran: string, till: string): number => {
  const tid = (d: string) => Date.parse(`${stockholmsdag(d)}T00:00:00Z`);
  return Math.round((tid(till) - tid(fran)) / MS_PER_DAG);
};

const kvot = (n: number, av: number): Kvot => ({ andel: av === 0 ? null : n / av, n, av });

// Måndag–söndag runt en dag. Räknas på UTC-datum, eftersom indatan redan är en
// kalenderdag och inte en tidpunkt som kan hamna på fel sida om midnatt.
export function vecka(dag: string): Period {
  const d = new Date(`${dag}T00:00:00Z`);
  const sedanMandag = (d.getUTCDay() + 6) % 7; // söndag (0) blir 6
  const dagIso = (offset: number) => new Date(d.getTime() + offset * MS_PER_DAG).toISOString().slice(0, 10);
  return { fran: dagIso(-sedanMandag), till: dagIso(6 - sedanMandag) };
}

// Raderna varje tal bygger på. veckotal() räknar dem och bakom() visar dem, så
// att siffran och listan under den aldrig kan bli oense.
type Underlag = {
  bokade: string[];
  hallnaAlla: StatMote[]; // nämnaren; n är de med utfall "hallet"
  raddade: string[];
  affarKedjor: StatKedja[]; // nämnaren för affärer och första mötet; n är de med avslut "affar"
  bokatTillAffar: string[];
  oppnaOfferter: string[];
  tysta: string[];
  utanUtfall: string[];
};

function underlag(person: string, v: Period, moten: StatMote[], kedjor: StatKedja[], nu: Date): Underlag {
  const kedjaPerId = new Map(kedjor.map((k) => [k.id, k]));
  const egnaOfferter = kedjor.filter((k) => k.avslut === null && k.offertNar !== null && k.forstaHallnaHallsAv === person);
  return {
    bokade: moten.filter((m) => m.bokatAv === person && m.art === "ny" && iVeckan(m.bokatNar, v)).map((m) => m.id),
    hallnaAlla: moten.filter((m) => m.bokatAv === person && m.art === "ny" && iVeckan(m.moteTid, v) && m.utfall !== null),
    raddade: moten
      .filter((m) => m.art === "ombokning" && m.utfall === "hallet" && iVeckan(m.moteTid, v) && kedjaPerId.get(m.kedja)?.forstaBokatAv === person)
      .map((m) => m.id),
    affarKedjor: kedjor.filter(
      (k) => (k.avslut === "affar" || k.avslut === "nej") && iVeckan(k.avslutNar, v) && k.forstaHallnaHallsAv === person,
    ),
    bokatTillAffar: kedjor
      .filter((k) => k.avslut === "affar" && iVeckan(k.avslutNar, v) && k.forstaBokatAv === person)
      .map((k) => k.id),
    oppnaOfferter: egnaOfferter.filter((k) => k.kolumn === "folj_upp").map((k) => k.id),
    tysta: egnaOfferter.filter((k) => k.kolumn === "tyst").map((k) => k.id),
    // Mötet är över först en halvtimme efter starten; dessförinnan är det inte
    // säljarens fel att utfallet saknas.
    utanUtfall: moten
      .filter((m) => m.hallsAv === person && m.utfall === null && Date.parse(m.moteTid) + TRETTIO_MIN < nu.getTime())
      .map((m) => m.id),
  };
}

export function veckotal(
  person: string, v: Period, moten: StatMote[], kedjor: StatKedja[], samtal: number, nu: Date = new Date(),
): Veckotal {
  const u = underlag(person, v, moten, kedjor, nu);
  const affarer = u.affarKedjor.filter((k) => k.avslut === "affar");
  return {
    samtal,
    bokade: u.bokade.length,
    per100: samtal === 0 ? null : Math.round((u.bokade.length / samtal) * 1000) / 10,
    hallna: kvot(u.hallnaAlla.filter((m) => m.utfall === "hallet").length, u.hallnaAlla.length),
    raddade: u.raddade.length,
    affarer: kvot(affarer.length, u.affarKedjor.length),
    forstaMote: kvot(affarer.filter((k) => k.affarForstaMote).length, affarer.length),
    bokatTillAffar: u.bokatTillAffar.length,
    oppnaOfferter: u.oppnaOfferter.length,
    tysta: u.tysta.length,
    utanUtfall: u.utanUtfall.length,
  };
}

const median = (tal: number[]): number | null => {
  if (tal.length === 0) return null;
  const s = [...tal].sort((a, b) => a - b);
  const mitt = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mitt] : (s[mitt - 1] + s[mitt]) / 2;
};

// "Äger" den här personen raden? Teamledarens block (I2) räknar bara rader som någon i kretsen äger, med
// samma ägare som personraderna i underlag(). krets null = alla (säljchef, vd, admin): allt ägs.
const iKrets = (krets: readonly string[] | null) => {
  const i = krets === null ? null : new Set(krets);
  return (id: string | null | undefined): boolean => i === null || (id !== null && id !== undefined && i.has(id));
};

// Offertläget i stort. Tysta är en ögonblicksbild (hur många som ligger och
// väntar just nu), de övriga talen gäller veckan.
export function offerter(kedjor: StatKedja[], v: Period, krets: readonly string[] | null = null) {
  // Med krets räknas bara kedjor vars första hållare ligger i den (som oppnaOfferter och tysta i underlag()).
  const agd = iKrets(krets);
  const medOffert = kedjor.filter((k) => k.offertNar !== null && agd(k.forstaHallnaHallsAv));
  const avslutade = (avslut: "affar" | "nej") => medOffert.filter((k) => k.avslut === avslut && iVeckan(k.avslutNar, v));
  const affarer = avslutade("affar");
  return {
    skickade: medOffert.filter((k) => iVeckan(k.offertNar, v)).length,
    affar: affarer.length,
    nej: avslutade("nej").length,
    tysta: medOffert.filter((k) => k.avslut === null && k.kolumn === "tyst").length,
    medianDagar: median(affarer.map((k) => dagarMellan(k.offertNar as string, k.avslutNar as string))),
  };
}

type Hink = "0–1" | "2–3" | "4–7" | "8+";
const hinkFor = (dagar: number): Hink => (dagar <= 1 ? "0–1" : dagar <= 3 ? "2–3" : dagar <= 7 ? "4–7" : "8+");

// Håller mötet oftare ju närmare bokningen det ligger? Bara nya möten med
// utfall, så att ombokningar och uppföljningar inte förvränger bilden.
export function dagarTillMote(moten: StatMote[], v: Period, krets: readonly string[] | null = null): Record<Hink, Kvot> {
  const agd = iKrets(krets); // ägaren är den som bokade (hallnaAlla i underlag())
  const rader: Record<Hink, StatMote[]> = { "0–1": [], "2–3": [], "4–7": [], "8+": [] };
  for (const m of moten) {
    if (m.art !== "ny" || m.utfall === null || !iVeckan(m.moteTid, v) || !agd(m.bokatAv)) continue;
    rader[hinkFor(dagarMellan(m.bokatNar, m.moteTid))].push(m);
  }
  const tal = (h: Hink) => kvot(rader[h].filter((m) => m.utfall === "hallet").length, rader[h].length);
  return { "0–1": tal("0–1"), "2–3": tal("2–3"), "4–7": tal("4–7"), "8+": tal("8+") };
}

// Bekräftelserna per bokare (byggsteg 4, U9): bekräftar bokaren sina möten före
// mötestiden, och håller de bekräftade oftare än de obekräftade? Underlaget är
// mötena med mötestid i perioden som inte avbokats, ägda av den som bokade.
// Bara första möten: ett uppföljningsmöte bekräftas inte (skaBekraftas i
// motesflode.ts, 2026-11-13) och skulle annars dra ner andelen.
// "Bekräftat före" = bekraftat_nar före mötestiden; en bekräftelse efteråt är
// ingen bekräftelse. Hållet räknas bland mötena som fått utfall (hållet eller
// uteblev), så att ett möte som väntar på utfall inte drar ner andelen.
export function bekraftelsePerBokare(
  moten: StatMote[], v: Period, krets: readonly string[] | null = null,
): Record<string, { bokade: number; bekraftadeFore: Kvot; hallnaBekraftade: Kvot; hallnaObekraftade: Kvot }> {
  const agd = iKrets(krets);
  const per = new Map<string, StatMote[]>();
  for (const m of moten) {
    if (m.utfall === "avbokat" || !skaBekraftas(m.art) || !iVeckan(m.moteTid, v) || !agd(m.bokatAv)) continue;
    if (!per.has(m.bokatAv)) per.set(m.bokatAv, []);
    per.get(m.bokatAv)!.push(m);
  }
  const fore = (m: StatMote) => !!m.bekraftatNar && Date.parse(m.bekraftatNar) < Date.parse(m.moteTid);
  const hallKvot = (rader: StatMote[]) => {
    const avgjorda = rader.filter((m) => m.utfall === "hallet" || m.utfall === "uteblev");
    return kvot(avgjorda.filter((m) => m.utfall === "hallet").length, avgjorda.length);
  };
  const ut: Record<string, { bokade: number; bekraftadeFore: Kvot; hallnaBekraftade: Kvot; hallnaObekraftade: Kvot }> = {};
  for (const [id, rader] of per) {
    const bekr = rader.filter(fore);
    ut[id] = {
      bokade: rader.length,
      bekraftadeFore: kvot(bekr.length, rader.length),
      hallnaBekraftade: hallKvot(bekr),
      hallnaObekraftade: hallKvot(rader.filter((m) => !fore(m))),
    };
  }
  return ut;
}

// Varifrån kommer bokningarna, möten och affärerna? En rad per källa som
// förekommer i något av underlagen, flest bokade först och sedan på namn.
export function perKalla(moten: StatMote[], kedjor: StatKedja[], v: Period, krets: readonly string[] | null = null) {
  // Ägare per kolumn, som personraderna i underlag(): bokade och hållna nya möten = den som bokade, hållna
  // ombokningar (och uppföljningar, som ingen personrad räknar) = kedjans första bokare, affärer = kedjans
  // första hållare. Med krets null äger "alla" allt och inget ändras.
  const agd = iKrets(krets);
  const kedjaPerId = new Map(kedjor.map((k) => [k.id, k]));
  const rader = new Map<string, { kalla: string; bokade: number; hallna: number; affarer: number }>();
  const rad = (kalla: string) => {
    if (!rader.has(kalla)) rader.set(kalla, { kalla, bokade: 0, hallna: 0, affarer: 0 });
    return rader.get(kalla)!;
  };
  for (const m of moten) {
    const r = rad(m.kalla);
    if (m.art === "ny" && iVeckan(m.bokatNar, v) && agd(m.bokatAv)) r.bokade++;
    if (m.utfall === "hallet" && iVeckan(m.moteTid, v)) {
      const agare = m.art === "ny" ? m.bokatAv : kedjaPerId.get(m.kedja)?.forstaBokatAv;
      if (agd(agare)) r.hallna++;
    }
  }
  for (const k of kedjor) {
    const r = rad(k.kalla);
    if (k.avslut === "affar" && iVeckan(k.avslutNar, v) && agd(k.forstaHallnaHallsAv)) r.affarer++;
  }
  // Källor där allt är 0 (ett gammalt öppet möte utanför veckan drar in sin källa) säger ingenting om veckan.
  return [...rader.values()]
    .filter((r) => r.bokade > 0 || r.hallna > 0 || r.affarer > 0)
    .sort((a, b) => b.bokade - a.bokade || a.kalla.localeCompare(b.kalla, "sv"));
}

/**
 * Teamledarens krets (0264, `mote_statkrets`): bara möten och kedjor som rör någon i `krets`.
 * `krets` null betyder alla (säljchef, vd, admin) och släpper igenom allt.
 *
 * - Ett möte behålls om `bokatAv` ELLER `hallsAv` ligger i kretsen. Bokat av en i teamet men hållet
 *   av någon utanför står alltså kvar, eftersom det är teamets bokning.
 * - En kedja behålls om ett behållet möte pekar på den, ELLER om `forstaBokatAv` eller
 *   `forstaHallnaHallsAv` ligger i kretsen. Det andra villkoret behövs eftersom statistiken bara
 *   läser möten bokade eller hållna i perioden: en kedja som avslutas i veckan efter ett möte långt
 *   tillbaka har inget möte med bland raderna, men dess affär tillhör ändå den som hållit det första
 *   mötet (kedjetalen i veckotal() sorterar på de två personfälten).
 */
export function inomKrets<M extends Pick<StatMote, "kedja" | "bokatAv" | "hallsAv">, K extends Pick<StatKedja, "id" | "forstaBokatAv" | "forstaHallnaHallsAv">>(
  moten: M[], kedjor: K[], krets: readonly string[] | null,
): { moten: M[]; kedjor: K[] } {
  if (krets === null) return { moten, kedjor };
  const i = new Set(krets);
  const motena = moten.filter((m) => i.has(m.bokatAv) || i.has(m.hallsAv));
  const pekade = new Set(motena.map((m) => m.kedja));
  const kedjorna = kedjor.filter(
    (k) => pekade.has(k.id) || i.has(k.forstaBokatAv) || (k.forstaHallnaHallsAv !== null && i.has(k.forstaHallnaHallsAv)),
  );
  return { moten: motena, kedjor: kedjorna };
}

// ---------------------------------------------------------------------------
// Teamledarens krets och "alla" (I1): ett tyst `null` blir aldrig bredare än rollen.

/** Rollerna för vilka `null` ur mote_statkrets() betyder "alla". En ren team_lead hör inte hit. */
const ALLA_ROLLER = ["sales_manager", "ceo", "admin"] as const;
const harAllaRoll = (roller: readonly string[]) => ALLA_ROLLER.some((r) => roller.includes(r));
const SAMTAL_FEL = "Samtalen gick inte att läsa.";

/**
 * Kretsen ur mote_statkrets() (`undefined` = fel) mot rollerna. `null` gäller som "alla" bara för
 * sales_manager, ceo eller admin; för alla andra är `null` ett fel (`undefined`), så att en brygga som
 * tyst ger `null` inte öppnar hela företaget för en teamledare.
 */
export function kretsFor(
  kretsRå: string[] | null | undefined, roller: readonly string[],
): string[] | null | undefined {
  if (kretsRå === null) return harAllaRoll(roller) ? null : undefined;
  return kretsRå;
}

/** Får `person` läsas? `krets` som kretsFor(), efter rpc-kontrollen i rutten (`undefined` = rpc:n felade). */
export function samtalTillatet(
  krets: readonly string[] | null | undefined, roller: readonly string[], person: string,
): { ok: true } | { status: 403 | 500; fel: string } {
  if (krets === undefined || (krets === null && !harAllaRoll(roller))) return { status: 500, fel: SAMTAL_FEL };
  if (krets === null || krets.includes(person)) return { ok: true };
  return { status: 403, fel: krets.length === 1 ? "Du ser bara dina egna samtal." : "Du ser bara samtalen i ditt team." };
}

// ---------------------------------------------------------------------------
// Samtalsfönstret (S1–S3): indatan till handlingen `samtal` i rutten, validerad på ett ställe.

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
// Zonen krävs (Z eller ±hh:mm): en tid utan zon skulle tolkas i serverns lokala tid (M2).
const ISO_TID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** YYYY-MM-DD som finns i kalendern: 2026-02-30 och 2026-99-99 går inte fram och tillbaka. */
export const giltigtDatum = (d: unknown): d is string => {
  if (typeof d !== "string" || !DATUM_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  // toISOString() kastar RangeError på ett ogiltigt datum (2026-99-99), så NaN prövas först.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

// Midnatt svensk tid på dagen `dag`, som ISO. Prövar de två möjliga offseterna (+1 h vinter, +2 h
// sommar) och tar den där Stockholm verkligen visar 00:00 den dagen. Importfri så att provet kan köras
// utan alias (klocka.ts har samma sak som svenskTidpunkt).
const stockholmsMidnatt = (dag: string): string => {
  const klockan = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: motesTz(), year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(t)).map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const utc = Date.parse(`${dag}T00:00:00Z`);
  for (const timmar of [2, 1]) {
    const t = utc - timmar * 3_600_000;
    if (klockan(t) === `${dag}T00:00`) return new Date(t).toISOString();
  }
  return new Date(utc - 3_600_000).toISOString();
};

/**
 * Fönstret för samtalslistan: `fran` och `till` är svenska dagar och båda räknas in. Ger `fran` (dygnets
 * start), `slut` (nästa dygns 00:00, uteslutet: `started_at < slut`, som 0263:s `< p_till + 1`) och
 * `fore` (tidpunkten då talen lästes, eller null om klienten inte skickade någon).
 * Fel: omöjligt datum (S1), till före fran, mer än 14 dagar, eller en `fore` som inte går att tolka (S3).
 */
export function samtalsfonster(
  i: { fran?: unknown; till?: unknown; fore?: unknown },
): { fel: string } | { fran: string; fore: string | null; slut: string } {
  if (!giltigtDatum(i.fran) || !giltigtDatum(i.till) || i.till < i.fran) return { fel: "Ogiltig begäran." };
  if (Date.parse(i.till) - Date.parse(i.fran) > 13 * MS_PER_DAG) return { fel: "Högst två veckor åt gången." };
  let fore: string | null = null;
  if (i.fore !== undefined && i.fore !== null && i.fore !== "") {
    if (typeof i.fore !== "string" || !ISO_TID_RE.test(i.fore) || Number.isNaN(Date.parse(i.fore))) return { fel: "Ogiltig begäran." };
    fore = new Date(i.fore).toISOString();
  }
  const nasta = new Date(Date.parse(`${i.till}T00:00:00Z`) + MS_PER_DAG).toISOString().slice(0, 10);
  return { fran: stockholmsMidnatt(i.fran), fore, slut: stockholmsMidnatt(nasta) };
}

// Id:n bakom ett tal: mötes-id för mötestal och kedje-id för kedjetal. För
// kvoter är det nämnarens rader (även de som inte räknades som n), så att
// användaren ser vilka som föll bort. Samtalen hämtas ur rutten, inte härifrån.
export function bakom(
  tal: keyof Veckotal, person: string, v: Period, moten: StatMote[], kedjor: StatKedja[], nu: Date = new Date(),
): string[] {
  const u = underlag(person, v, moten, kedjor, nu);
  switch (tal) {
    case "samtal":
    case "per100":
      return [];
    case "bokade": return u.bokade;
    case "hallna": return u.hallnaAlla.map((m) => m.id);
    case "raddade": return u.raddade;
    case "affarer": return u.affarKedjor.map((k) => k.id);
    case "forstaMote": return u.affarKedjor.filter((k) => k.avslut === "affar").map((k) => k.id);
    case "bokatTillAffar": return u.bokatTillAffar;
    case "oppnaOfferter": return u.oppnaOfferter;
    case "tysta": return u.tysta;
    case "utanUtfall": return u.utanUtfall;
  }
}
