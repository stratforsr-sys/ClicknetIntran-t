import type { Kanal, Personlager, Regler } from "@/lib/utskick";
import type { Katalog } from "@/lib/utskick-server";

/**
 * Det utskicksvyerna räknar med i webbläsaren: samma regler som `far()` i
 * `src/lib/utskick.ts`, men utan serverimporter (den filen drar med sig
 * `notiser.ts`). `tests/utskick.mjs` prövar originalet; här speglas bara
 * beslutsordningen så att en brytare kan svara direkt, innan servern hunnit.
 *
 * Är de två oense gäller servern. Vyn hämtar om sig efter ett misslyckat spar.
 */

export type Omrade = Katalog["omraden"][number];
export type Sort = Omrade["sorter"][number];

function forsta(r: Regler | undefined, kanal: Kanal, nycklar: readonly string[]): boolean | undefined {
  const k = r?.[kanal];
  if (!k) return undefined;
  for (const n of nycklar) if (typeof k[n] === "boolean") return k[n];
  return undefined;
}

/** Vad bolaget, nivån och personen sagt (utan personens egna val). `undefined` = inget. */
export function saVal(l: Personlager, kanal: Kanal, nycklar: readonly string[]): boolean | undefined {
  return forsta(l.person, kanal, nycklar) ?? forsta(l.niva, kanal, nycklar) ?? forsta(l.alla, kanal, nycklar);
}

/** Beslutet, som `far()`: superadmins nej, sedan det egna, sedan superadmins ja, sedan standard. */
export function gar(l: Personlager, kanal: Kanal, nycklar: readonly string[], standard: boolean): boolean {
  const sa = saVal(l, kanal, nycklar);
  if (sa === false) return false;
  const egen = forsta(l.egen, kanal, nycklar);
  if (egen !== undefined) return egen;
  return sa ?? standard;
}

/** Beslutet utan det egna lagret: vad en ruta som står på Ärv ger. */
export function arvs(l: Personlager, kanal: Kanal, nycklar: readonly string[], standard: boolean): boolean {
  return saVal(l, kanal, nycklar) ?? standard;
}

/** Nycklarna för en sort, från den mest precisa till hela kanalen. */
export const sortNycklar = (omrade: string, sort: string) => [`sort:${sort}`, `omrade:${omrade}`, "*"];
export const omradeNycklar = (omrade: string) => [`omrade:${omrade}`, "*"];
export const avsnittNycklar = (id: string) => [`avsnitt:${id}`, "*"];

/** Ett lager med en nyckel ändrad. `null` tar bort nyckeln (ärv). */
export function med(regler: Regler, kanal: Kanal, nyckel: string, varde: boolean | null): Regler {
  const ut: Regler = { ...regler, [kanal]: { ...(regler[kanal] ?? {}) } };
  if (varde === null) delete ut[kanal]![nyckel];
  else ut[kanal]![nyckel] = varde;
  if (Object.keys(ut[kanal]!).length === 0) delete ut[kanal];
  return ut;
}

export function nyckelVarde(regler: Regler | undefined, kanal: Kanal, nyckel: string): boolean | null {
  const v = regler?.[kanal]?.[nyckel];
  return typeof v === "boolean" ? v : null;
}

/** Sorterna ett område har i kanalen. */
export function sorterI(o: Omrade, kanal: Kanal): Sort[] {
  return o.sorter.filter((s) => s.kanaler.includes(kanal));
}

/** Områdena som alls har något i kanalen. */
export function omradenI(k: Katalog, kanal: Kanal): Omrade[] {
  return k.omraden.filter((o) => sorterI(o, kanal).length > 0);
}

/** Antal sorter i området som går fram, och hur många det finns. */
export function raknaOmrade(l: Personlager, kanal: Kanal, o: Omrade, egenAv = false): { pa: number; av: number } {
  const lista = sorterI(o, kanal);
  let pa = 0;
  for (const s of lista) {
    const n = sortNycklar(o.id, s.id);
    const std = s.standard[kanal] ?? false;
    if (egenAv ? arvs(l, kanal, n, std) : gar(l, kanal, n, std)) pa++;
  }
  return { pa, av: lista.length };
}

/** Antal områden där minst en sort går fram. Det som visas som "12 av 20 områden på". */
export function raknaOmraden(l: Personlager, kanal: Kanal, k: Katalog, egenAv = false): { pa: number; av: number } {
  const lista = omradenI(k, kanal);
  return { pa: lista.filter((o) => raknaOmrade(l, kanal, o, egenAv).pa > 0).length, av: lista.length };
}

/**
 * Vad som ska sparas när någon slår PÅ en nyckel: helst Ärv (inget sparas),
 * men står den ändå av för att standarden är av sparas ett uttryckligt På.
 * Att slå AV sparar alltid Av.
 */
export function valjVarde(onskat: boolean, paUtanNyckeln: () => boolean): boolean | null {
  if (!onskat) return false;
  return paUtanNyckeln() ? null : true;
}

/** Ett läsbart namn på en nyckel, för listan över vad personen själv stängt. */
export function nyckelNamn(k: Katalog, nyckel: string): string {
  if (nyckel === "*") return "Allt i kanalen";
  const [typ, id] = [nyckel.split(":")[0], nyckel.slice(nyckel.indexOf(":") + 1)];
  if (typ === "omrade") return k.omraden.find((o) => o.id === id)?.namn ?? id;
  if (typ === "avsnitt") return k.avsnitt.find((a) => a.id === id)?.namn ?? id;
  if (typ === "sort") {
    for (const o of k.omraden) {
      const s = o.sorter.find((x) => x.id === id);
      if (s) return s.namn;
    }
  }
  return id;
}
