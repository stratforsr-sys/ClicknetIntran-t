/**
 * Teamet i månaden (skiss 9): kedjan per person, orsaken med sitt belägg, och läget mot personens eget mål.
 *
 * KEDJAN har fem led: samtal, svar, bokade möten, hållna möten och order. Varje led jämförs med personens eget
 * spann, de åtta veckorna före. Ett led får färg först när BÅDA de två senaste veckorna ligger utanför spannet:
 * under (d) eller över (u). Annars som vanligt (n). Saknas data för ledet är det null och får ingen färg.
 * Veckorna är rullande sjudagarsperioder bakåt från i dag, så att en halv vecka aldrig jämförs med hela.
 *
 * SVAR ser Nav inte: växeln säger inte om ett samtal blev besvarat (beställaren 2026-11-15, "ser jag inte").
 * Ledet är null tills växeln skickar utfallet, och regler som bygger på det slår aldrig till.
 *
 * ORSAKEN är en regel om VAD som ändrats, aldrig varför. Den första regeln som stämmer gäller, och texten
 * slutar alltid med "Varför vet jag inte." Ren logik, inga anrop.
 */

export type Led = "n" | "u" | "d" | null;
export type Vecka = { samtal: number | null; svar: number | null; bokade: number | null; hallna: number | null; order: number | null };
export const LEDEN = ["samtal", "svar", "bokade", "hallna", "order"] as const;
export const LEDNAMN = ["Samtal", "Svar", "Bokade möten", "Hållna möten", "Order"] as const;

/** Ett led ur tio veckor, nyast först: [0] och [1] är de två senaste, [2..9] spannet. */
export function ledFor(v: readonly (number | null)[]): Led {
  if (v[0] === null || v[0] === undefined || v[1] === null || v[1] === undefined) return null;
  const spann = v.slice(2, 10).filter((x): x is number => x !== null && x !== undefined);
  if (spann.length < 4) return null;
  const min = Math.min(...spann), max = Math.max(...spann);
  if (v[0] < min && v[1] < min) return "d";
  if (v[0] > max && v[1] > max) return "u";
  return "n";
}

export type Orsak = "Möten uteblir" | "Färre svar blir möten" | "Färre samtal besvaras" | "Färre samtal" | "Färre möten blir order";

/** Kedjan och orsaken ur tio veckor, nyast först. */
export function kedja(veckor: readonly Vecka[]): { led: Led[]; orsak: Orsak | null } {
  const led = LEDEN.map((k) => ledFor(veckor.map((v) => v[k])));
  const [samtal, svar, bokade, hallna, order] = led;
  const orsak: Orsak | null =
    hallna === "d" && bokade === "n" ? "Möten uteblir"
    : bokade === "d" && svar === "n" ? "Färre svar blir möten"
    : svar === "d" && samtal === "n" ? "Färre samtal besvaras"
    : samtal === "d" ? "Färre samtal"
    : order === "d" && hallna === "n" ? "Färre möten blir order"
    : null;
  return { led, orsak };
}

/** Talen bakom en orsak: de två senaste veckorna mot de åtta före. */
export type Underlag = { samtal: number; hallna: number; uteblev: number; order: number };

/** Förklaringen till en person: vad som är som vanligt, vad som ligger över, och orsaken med sitt belägg. */
export function forklaring(led: readonly Led[], orsak: Orsak | null, s: Underlag, f: Underlag): string {
  const [samtal, , bokade] = led;
  const delar: string[] = [];
  if (samtal === "n" && bokade === "n") delar.push("Ringer och bokar som vanligt.");
  else if (bokade === "n") delar.push("Bokar som vanligt.");
  led.forEach((l, i) => { if (l === "u") delar.push(`${LEDNAMN[i]}: över sitt eget spann två veckor i rad.`); });
  if (orsak === "Möten uteblir") delar.push(`${s.uteblev} av ${s.hallna + s.uteblev} möten uteblev, mot ${f.uteblev} av ${f.hallna + f.uteblev} före.`);
  else if (orsak === "Färre samtal") delar.push(`${s.samtal} samtal de två senaste veckorna, mot ${f.samtal} på de åtta före.`);
  else if (orsak === "Färre möten blir order") delar.push(`${s.order} order på ${s.hallna} hållna möten, mot ${f.order} på ${f.hallna} före.`);
  if (orsak) delar.push("Varför vet jag inte.");
  return delar.length ? delar.join(" ") : "Inget sticker ut.";
}

export type Status = "Före sitt mål" | "Efter sitt mål" | "I takt";

/** Läget mot personens eget mål vid gångna arbetsdagar. Utan mål finns inget läge. */
export function statusMotMal(order: number, mal: number | null, gatt: number, totalt: number): Status | null {
  if (!mal || !totalt) return null;
  const forvantat = (mal * gatt) / totalt;
  return order >= forvantat + 1 ? "Före sitt mål" : order <= forvantat - 1 ? "Efter sitt mål" : "I takt";
}

/** Till målet: hur många order som är kvar, på hur många arbetsdagar, och takten hittills. */
export function tillMalet(netto: number, mal: number | null, gatt: number, totalt: number): { kvar: number; dagar: number; perDag: number; hittills: number } | null {
  if (!mal) return null;
  const kvar = Math.max(0, mal - netto), dagar = Math.max(0, totalt - gatt);
  return { kvar, dagar, perDag: dagar ? Math.round((kvar / dagar) * 10) / 10 : kvar, hittills: gatt ? Math.round((netto / gatt) * 10) / 10 : 0 };
}

const dagMinus = (dag: string, n: number): string => new Date(Date.parse(`${dag}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/**
 * Tio rullande veckor för en person, nyast först, ur dagar (YYYY-MM-DD) för varje händelse. Vecka k är de sju
 * dagarna som slutar k·7 dagar före i dag. En person utan ett enda samtal på tio veckor finns inte i växeln:
 * samtalsledet blir null i stället för noll. Underlaget är summorna för de två senaste veckorna och de åtta före.
 */
export function personVeckor(h: { samtal: readonly string[]; bokade: readonly string[]; hallna: readonly string[]; uteblev: readonly string[]; order: readonly string[] }, idag: string): { veckor: Vecka[]; s: Underlag; f: Underlag } {
  const fonster = Array.from({ length: 10 }, (_x, k) => ({ slut: dagMinus(idag, 7 * k), start: dagMinus(idag, 7 * k + 6) }));
  const per = (dagar: readonly string[]) => fonster.map((w) => dagar.filter((d) => d >= w.start && d <= w.slut).length);
  const samtal = per(h.samtal), bokade = per(h.bokade), hallna = per(h.hallna), uteblev = per(h.uteblev), order = per(h.order);
  const iVaxeln = samtal.some((n) => n > 0);
  const veckor = fonster.map((_w, k) => ({ samtal: iVaxeln ? samtal[k] : null, svar: null, bokade: bokade[k], hallna: hallna[k], order: order[k] }));
  const summa = (v: number[], a: number, b: number) => v.slice(a, b).reduce((x, y) => x + y, 0);
  const del = (a: number, b: number): Underlag => ({ samtal: summa(samtal, a, b), hallna: summa(hallna, a, b), uteblev: summa(uteblev, a, b), order: summa(order, a, b) });
  return { veckor, s: del(0, 2), f: del(2, 10) };
}

/**
 * Spannet delat i veckor, för att läsa samtalen vecka för vecka samtidigt i stället för sida efter sida.
 * Varje fönster är [från, till), och det sista är öppet framåt (till = null), så att inget samtal faller mellan.
 */
export function veckofonster(franIso: string, tillIso: string): [string, string | null][] {
  const ut: [string, string | null][] = [];
  const slut = Date.parse(tillIso), vecka = 7 * 864e5;
  for (let t = Date.parse(franIso); ; t += vecka) {
    if (t + vecka >= slut) { ut.push([new Date(t).toISOString(), null]); return ut; }
    ut.push([new Date(t).toISOString(), new Date(t + vecka).toISOString()]);
  }
}
