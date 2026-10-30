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

export type StatMote = {
  id: string; kedja: string; bokatAv: string; hallsAv: string; bokatNar: string; moteTid: string;
  art: "ny" | "ombokning" | "uppfoljning"; utfall: "hallet" | "uteblev" | "avbokat" | null;
  resultat: string | null; kalla: string;
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

const MS_PER_DAG = 86_400_000;
const TRETTIO_MIN = 30 * 60_000;

// Stockholmsdagen (YYYY-MM-DD) för en tidsstämpel. En bokning 23:30 UTC en
// söndag är måndag i Sverige, och det är svenska dagar säljarna räknar i.
// Samma mönster som dag() i avtalforma.ts.
const stockholmsdag = (ts: string | number | Date): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

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

// Offertläget i stort. Tysta är en ögonblicksbild (hur många som ligger och
// väntar just nu), de övriga talen gäller veckan.
export function offerter(kedjor: StatKedja[], v: Period) {
  const medOffert = kedjor.filter((k) => k.offertNar !== null);
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
export function dagarTillMote(moten: StatMote[], v: Period): Record<Hink, Kvot> {
  const rader: Record<Hink, StatMote[]> = { "0–1": [], "2–3": [], "4–7": [], "8+": [] };
  for (const m of moten) {
    if (m.art !== "ny" || m.utfall === null || !iVeckan(m.moteTid, v)) continue;
    rader[hinkFor(dagarMellan(m.bokatNar, m.moteTid))].push(m);
  }
  const tal = (h: Hink) => kvot(rader[h].filter((m) => m.utfall === "hallet").length, rader[h].length);
  return { "0–1": tal("0–1"), "2–3": tal("2–3"), "4–7": tal("4–7"), "8+": tal("8+") };
}

// Varifrån kommer bokningarna, möten och affärerna? En rad per källa som
// förekommer i något av underlagen, flest bokade först och sedan på namn.
export function perKalla(moten: StatMote[], kedjor: StatKedja[], v: Period) {
  const rader = new Map<string, { kalla: string; bokade: number; hallna: number; affarer: number }>();
  const rad = (kalla: string) => {
    if (!rader.has(kalla)) rader.set(kalla, { kalla, bokade: 0, hallna: 0, affarer: 0 });
    return rader.get(kalla)!;
  };
  for (const m of moten) {
    const r = rad(m.kalla);
    if (m.art === "ny" && iVeckan(m.bokatNar, v)) r.bokade++;
    if (m.utfall === "hallet" && iVeckan(m.moteTid, v)) r.hallna++;
  }
  for (const k of kedjor) {
    const r = rad(k.kalla);
    if (k.avslut === "affar" && iVeckan(k.avslutNar, v)) r.affarer++;
  }
  return [...rader.values()].sort((a, b) => b.bokade - a.bokade || a.kalla.localeCompare(b.kalla, "sv"));
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
