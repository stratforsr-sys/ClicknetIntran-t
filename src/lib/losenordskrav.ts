/**
 * Vad som duger som losenord.
 *
 * Reglerna foljer NIST SP 800-63B och inte den gamla vanan med "minst en
 * versal, en siffra och ett specialtecken". Den vanan ger `Sommar2026!` —
 * fyra krav uppfyllda och ett losenord som star hogt upp i varje ordlista.
 * Langd och en sparrlista gor mer nytta, och gor det utan att tvinga fram
 * lappen under tangentbordet.
 *
 * Ingen import. Modulen ska ga att kora rakt av i ett test.
 */

/** Bcrypt i GoTrue laser bara de forsta 72 BYTEN. Resten klipps tyst bort. */
export const MAX_BYTE = 72;
export const MIN_TECKEN = 12;

/**
 * Sparrlista, inte fullstandig — den ar en pahittsspa­rr for det som faktiskt
 * skrivs in nar nagon tvingas byta och vill bli klar. Alla jamforelser sker i
 * gemener och utan siffror pa slutet, sa `Clicknet123` fastnar pa `clicknet`.
 *
 * MINST FEM TECKEN, och det ar ett krav och inte en tillfallighet. Listan
 * innehöll en gang "abc", och eftersom den matchas som delstrang nekade den
 * var femtionde slumpat tillfalligt losenord — chefen delade alltsa ut ord som
 * navet sjalv vagrade ta emot. `tests/losenordskrav.mjs` slumpar 500 stycken
 * och granskar dem just for att den sortens regel ska falla direkt.
 */
const SPARRADE = [
  "losenord", "password", "passord", "hemligt", "clicknet", "clicknetnav",
  "kvalitet", "sommar", "vinter", "valkommen", "welcome", "qwerty",
  "admin", "saljare", "stockholm", "sverige", "iloveyou", "monkey",
  "dragon", "football", "fotboll", "hejsan", "hejhej", "sommaren",
];

/**
 * Korta ord som bara nekas nar de ar HELA losenordet.
 *
 * "test" och "host" ar vanliga forsok i sig sjalva, men som delstrangar sitter
 * de i "protestera" och "hostsonaten". En regel som nekar bra losenord for att
 * de rakar innehalla tre bokstaver larr folk att strunta i reglerna.
 */
const SPARRADE_HELA = ["abc", "asdf", "test", "host", "var", "hej", "nav"];

/** Tangentbordsrader, framat och baklanges. Sex tecken i foljd racker. */
const RADER = [
  "qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "qwertzuiop", "azerty",
];

const gemener = (s: string) => s.toLowerCase();

/** `Sommar2026!` -> `sommar`. Det ar stammen som ska matchas mot listan. */
function stam(losenord: string): string {
  return gemener(losenord).replace(/[^a-zåäö]+/g, "");
}

function harTangentbordsrad(losenord: string): boolean {
  const l = gemener(losenord);
  for (const rad of RADER) {
    const bak = [...rad].reverse().join("");
    for (let i = 0; i + 6 <= rad.length; i++) {
      if (l.includes(rad.slice(i, i + 6)) || l.includes(bak.slice(i, i + 6))) return true;
    }
  }
  return false;
}

/** `aaaaaa`, `abababab`. Kort period som upprepas hela vagen. */
function arUpprepning(losenord: string): boolean {
  const l = gemener(losenord);
  for (let period = 1; period <= 4; period++) {
    if (l.length < period * 3) continue;
    const bit = l.slice(0, period);
    if (l.split("").every((t, i) => t === bit[i % period])) return true;
  }
  return false;
}

/**
 * Namn och e-post ur profilen. Delar pa tre tecken eller mer raknas — annars
 * skulle ett efternamn som "Li" sparra halva ordforradet.
 */
function harPersonuppgift(losenord: string, om: Personuppgifter): string | null {
  const l = gemener(losenord);
  const bitar = [
    om.fornamn,
    om.efternamn,
    om.epost?.split("@")[0],
    om.epost?.split("@")[1]?.split(".")[0],
  ]
    .filter((b): b is string => Boolean(b))
    .flatMap((b) => gemener(b).split(/[^a-zåäö0-9]+/))
    .filter((b) => b.length >= 3);

  return bitar.find((b) => l.includes(b)) ?? null;
}

export type Personuppgifter = {
  fornamn?: string | null;
  efternamn?: string | null;
  epost?: string | null;
};

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
export function granska(
  losenord: string,
  om: Personuppgifter = {},
  gammalt?: string | null,
): Granskning {
  const fel: string[] = [];

  // Bytelangd, inte teckenlangd: en emoji ar fyra byte och ao/aa/oe ar tva.
  const byte = new TextEncoder().encode(losenord).length;

  if ([...losenord].length < MIN_TECKEN) {
    fel.push(`Lösenordet måste vara minst ${MIN_TECKEN} tecken. Det här är ${[...losenord].length}.`);
  }
  if (byte > MAX_BYTE) {
    fel.push(
      `Lösenordet är för långt. Allt efter ${MAX_BYTE} byte kastas bort av inloggningen, ` +
        "så det du skriver in är inte det du får.",
    );
  }
  if (losenord !== losenord.trim()) {
    fel.push("Lösenordet får inte börja eller sluta med mellanslag — det är för lätt att tappa bort.");
  }
  if (/^\d+$/.test(losenord)) {
    fel.push("Enbart siffror duger inte, hur många de än är.");
  }

  const s = stam(losenord);
  const traff = SPARRADE.find((ord) => s.includes(ord)) ?? SPARRADE_HELA.find((ord) => s === ord);
  if (traff) {
    fel.push(`Lösenordet bygger på ”${traff}”, som är bland det första någon gissar.`);
  }

  if (harTangentbordsrad(losenord)) {
    fel.push("Lösenordet innehåller en rad från tangentbordet.");
  }
  if (arUpprepning(losenord)) {
    fel.push("Lösenordet är samma tecken om och om igen.");
  }

  const personligt = harPersonuppgift(losenord, om);
  if (personligt) {
    fel.push(`Lösenordet innehåller ”${personligt}”, som står i din profil. Välj något annat.`);
  }

  if (gammalt && losenord === gammalt) {
    fel.push("Det nya lösenordet är samma som det gamla.");
  }

  return { ok: fel.length === 0, fel };
}

/**
 * Grov styrkeuppskattning i bitar, for maglinjen i formularet.
 *
 * Det ar en UPPSKATTNING och inget annat: den kanner inte till ordlistor och
 * ska darfor aldrig anvandas till att SLAPPA IGENOM nagot. `granska()` avgor.
 * Matten finns for att en manniska ska se skillnad pa tre ord och ett ord med
 * en trea i, som annars ser lika langa ut.
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
