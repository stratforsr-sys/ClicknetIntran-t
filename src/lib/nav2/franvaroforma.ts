/**
 * Nav 2.0, Frånvaro: ren logik som rutten och läsningen delar med repot.
 * Inga anrop och ingen Supabase, så att provet (`tests/franvaro.mjs`) når den.
 *
 * Granskningen 2026-10-22, S10:
 *   - D7: saldot läses som repots `saldoFor`, alltså den senaste raden per
 *     intjänandeår, summerad. Sparade dagar ligger i en rad per år.
 *   - D22: chefens "registrera efter samtal" prövas mot samma regler som en
 *     ansökan och samma beslutsrätt som ett beslut (rutten).
 */
import { provaRegler, saldoFor, type Ansokan, type Brottkod, type Provunderlag, type Saldo } from "../franvaro.ts";
import { arArbetsdag } from "../saljtakt.ts";

/** Saldot för en typ som vyn visar det: dagar och inmatningsdatum, eller null. */
export function egetSaldo(saldon: Saldo[], typ: string): { d: number; asof: string } | null {
  const s = saldoFor(
    saldon.map((r) => ({ ...r, days: Number(r.days) })),
    typ,
  );
  return s ? { d: s.days, asof: s.as_of } : null;
}

/**
 * Fristerna gäller den som söker i förväg. Chefen registrerar efter ett samtal,
 * alltså i dag eller bakåt, och då är en bruten frist det normala. De fryses
 * ändå i `rules_broken`, med "Registrerad efter samtal" som motivering.
 */
export const EFTER_SAMTAL: ReadonlySet<Brottkod> = new Set<Brottkod>(["frist", "bakat", "huvudsemester"]);

export const REGISTRERAD_TEXT = "Registrerad efter samtal";

export type Registreringsbeslut =
  | { fel: string }
  | {
      /** `approved` när inga andra regler bryts; annars en ansökan i kön som chefen beslutar med motivering (AC-3.12). */
      status: "approved" | "submitted";
      /** Alla brutna regler, frysta på raden. */
      brott: Brottkod[];
      /** De regler som gjorde den till en ansökan, som meningar. */
      texter: string[];
    };

/**
 * Hur en registrering efter samtal ska sparas.
 *
 * Ett regelbrott är en varning och aldrig en spärr (repots hållning), men ett
 * godkännande som bryter mot en regel kräver en motivering (villkoret i 0019).
 * Registreringen har inget motiveringsfält, så en registrering som bryter mot
 * en spärrperiod, bemanningstaket, saldot eller en befintlig ledighet läggs som
 * en ansökan i kön, där chefen beslutar med motivering som vanligt.
 */
export function provaRegistrering(a: Ansokan, u: Provunderlag): Registreringsbeslut {
  if (!arArbetsdag(a.starts_on)) return { fel: `${a.starts_on} är ingen arbetsdag (helg eller röd dag). Ingenting registrerades.` };
  const alla = provaRegler(a, u);
  const verkliga = alla.filter((b) => !EFTER_SAMTAL.has(b.kod));
  return {
    status: verkliga.length ? "submitted" : "approved",
    brott: alla.map((b) => b.kod),
    // Repots texter talar till den som söker; här läser chefen dem.
    texter: verkliga.map((b) => b.text.replace(/^Du har /, "Personen har ")),
  };
}
