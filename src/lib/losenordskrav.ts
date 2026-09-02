/**
 * Vad som duger som losenord.
 *
 * Sedan 2026-09-02 galler bestallarens regel och ingen annan: MINST ATTA
 * TECKEN OCH MINST EN SIFFRA. Allt annat far anvandaren valja fritt.
 *
 * Har lag tidigare NIST-varianten med tolv tecken, sparrlista, tangentbords-
 * rader, upprepningsmonster och namnkontroll mot profilen. Den ar borttagen
 * med flit — inte glomd. Lagg inte tillbaka en regel har for att den ar god
 * praxis; det ar ett beslut och inte en bugg, och det fattas av bestallaren.
 *
 * Kvar star tva kontroller som INTE ar smakregler:
 *
 *   - 72 byte. Bcrypt i GoTrue laser inte langre an sa och klipper resten
 *     tyst, alltsa far anvandaren inte det losenord hen skrev in.
 *   - Samma ord som det gamla. Vid ett tvingat byte ar "bytet" annars inget
 *     byte alls, och GoTrue nekar det anda med ett samre felmeddelande.
 *
 * Ingen import. Modulen ska ga att kora rakt av i ett test.
 */

/** Bcrypt i GoTrue laser bara de forsta 72 BYTEN. Resten klipps tyst bort. */
export const MAX_BYTE = 72;
export const MIN_TECKEN = 8;

export type Granskning = {
  ok: boolean;
  /** Allt som ar fel, inte bara det forsta. Ett fel i taget ar en pina. */
  fel: string[];
};

/**
 * Granskar ett nytt losenord.
 *
 * `gammalt` skickas med nar det ar kant — vid tvingat byte ar det tillfalliga
 * ordet kant, och att "byta" till samma ord ar inget byte.
 */
export function granska(losenord: string, gammalt?: string | null): Granskning {
  const fel: string[] = [];

  // Bytelangd, inte teckenlangd: en emoji ar fyra byte och ao/aa/oe ar tva.
  const byte = new TextEncoder().encode(losenord).length;
  const tecken = [...losenord].length;

  if (tecken < MIN_TECKEN) {
    fel.push(`Lösenordet måste vara minst ${MIN_TECKEN} tecken. Det här är ${tecken}.`);
  }
  if (!/\d/.test(losenord)) {
    fel.push("Lösenordet måste innehålla minst en siffra.");
  }
  if (byte > MAX_BYTE) {
    fel.push(
      `Lösenordet är för långt. Allt efter ${MAX_BYTE} byte kastas bort av inloggningen, ` +
        "så det du skriver in är inte det du får.",
    );
  }
  if (gammalt && losenord === gammalt) {
    fel.push("Det nya lösenordet är samma som det gamla.");
  }

  return { ok: fel.length === 0, fel };
}

/**
 * Grov styrkeuppskattning i bitar, for maglinjen i formularet.
 *
 * Det ar en UPPSKATTNING och ett RAD. Den avgor ingenting: `granska()` slapper
 * igenom ett attateckensord med en siffra aven nar matet kallar det svagt, och
 * matet far aldrig anvandas at andra hallet heller. Det finns for att en
 * manniska ska se skillnad pa tre ord och ett ord med en trea i.
 */
export function bitar(losenord: string): number {
  if (losenord.length === 0) return 0;

  const grupper = [
    /[a-zåäö]/.test(losenord) ? 29 : 0,
    /[A-ZÅÄÖ]/.test(losenord) ? 29 : 0,
    /\d/.test(losenord) ? 10 : 0,
    /[^a-zåäöA-ZÅÄÖ0-9]/.test(losenord) ? 32 : 0,
  ].reduce((a, b) => a + b, 0);

  const unika = new Set(losenord).size;
  // Upprepning ger inte mer entropi. `aaaaaaaaaaaa` ar inte tolv tecken vart.
  const langd = Math.min([...losenord].length, unika * 2);

  return Math.round(langd * Math.log2(Math.max(grupper, 2)));
}

export type Styrka = "svagt" | "godkant" | "starkt";

export function styrka(losenord: string): Styrka {
  const b = bitar(losenord);
  if (b < 55) return "svagt";
  if (b < 80) return "godkant";
  return "starkt";
}
