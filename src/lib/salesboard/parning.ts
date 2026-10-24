/**
 * Parningen av en kontors-TV: koden som visas på skärmen, tokenen som sedan
 * släpper in den och hashen som är det enda databasen får se av tokenen.
 *
 * Ren logik utan Supabase, kakor och Next, så att filen går att prova med node
 * (tests/salesboard-parning.mjs). Men slumpen och hashen kommer ur `node:crypto`,
 * och filen är därför SERVERKOD: den får inte importeras av en klientkomponent
 * (Parning.tsx, Installningar.tsx) eller av middleware. Koden formateras på
 * servern och skickas färdig till TV:n ("K7M4-QX9P").
 *
 * Flödet i stort står i spec §9 (docs/superpowers/specs/2026-10-23-salesboard-design.md).
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Alfabetet för parningskoden: 32 tecken, utan I, O, 0 och 1 som läses fel på en
 * TV tvärs över rummet. Åtta tecken ur 32 är 40 bitar.
 *
 * ANTALET ÄR 32 MED FLIT. 256 går jämnt upp i 32, så `byte % 32` ger varje tecken
 * precis lika stor chans. Ett alfabet på 31 eller 33 tecken hade gjort några
 * tecken vanligare, och ingen kod hade avslöjat det. Provet räknar därför hur
 * många av de 256 byten som träffar varje tecken.
 */
export const KODALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Antal tecken i en parningskod. Den visas som två grupper om fyra. */
export const KODLANGD = 8;

/** Hur länge en parningskod gäller: tio minuter, i millisekunder. */
export const KOD_GILTIG_MS = 600_000;

/**
 * En ny parningskod: `KODLANGD` tecken ur `KODALFABET`.
 *
 * Slumpen släpps in utifrån för att provet ska kunna styra den. Standard är
 * `randomBytes`, alltså kryptografisk slump, aldrig `Math.random`, som går att
 * förutsäga. En byte blir ett tecken, så ingen byte behöver kastas bort.
 */
export function nyKod(slump: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const byte = slump(KODLANGD);

  // En slump som ger för få byte hade gett en kod med texten "undefined" mitt i.
  if (byte.length < KODLANGD) {
    throw new Error(`Slumpen gav ${byte.length} byte, koden behöver ${KODLANGD}.`);
  }

  let kod = "";
  for (let i = 0; i < KODLANGD; i++) kod += KODALFABET[byte[i] % KODALFABET.length];
  return kod;
}

// Alfabetet är bara versaler och siffror och kan därför stå i en teckenklass utan
// skydd. Flaggan `i` utan `u` jämför bokstäverna utan hänsyn till skiftläge men
// viker aldrig in andra tecken: ß och ſ räknas inte som S, fast `toUpperCase()`
// hade gjort S av dem.
const KODMONSTER = new RegExp(`^[${KODALFABET}]{${KODLANGD}}$`, "i");

/**
 * Läser en kod som en människa skrivit in: " k7m4-qx9p " blir "K7M4QX9P".
 * Blanksteg och streck tas bort och små bokstäver blir stora. Allt som inte är
 * exakt `KODLANGD` tecken ur `KODALFABET` ger null.
 *
 * Felskrifter rättas inte. I, O, 0 och 1 finns inte i alfabetet och byts inte mot
 * något som liknar dem: en gissning är en annan kod, och en kod som "nästan"
 * gäller ska inte gälla.
 *
 * Det som inte är text ger också null i stället för ett undantag, eftersom
 * värdet kommer ur en JSON-kropp från en webbläsare och kan vara vad som helst.
 */
export function normaliseraKod(s: string): string | null {
  if (typeof s !== "string") return null;

  const ren = s.replace(/[\s-]/g, "");
  return KODMONSTER.test(ren) ? ren.toUpperCase() : null;
}

/**
 * Koden som den visas på TV:n: fyra tecken, ett streck och fyra tecken, alltså
 * "K7M4QX9P" blir "K7M4-QX9P". Tar en kod från `nyKod` eller `normaliseraKod`.
 *
 * Bara för visning. Hasha och spara alltid koden utan streck, som den kommer ur
 * `nyKod` och `normaliseraKod`: hashen av "K7M4-QX9P" är en annan än hashen av
 * "K7M4QX9P", och en kod som sparats med streck hittas aldrig igen.
 */
export function visaKod(k: string): string {
  const mitt = KODLANGD / 2;
  return `${k.slice(0, mitt)}-${k.slice(mitt)}`;
}

/**
 * En ny token: 32 slumpbyte (256 bitar) i base64url, alltså 43 tecken utan
 * fyllnad. Tecknen går rakt in i en kaka och en URL utan att behöva kodas om.
 */
export function nyToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * sha256 som 64 små hextecken. Det är hashen som sparas och aldrig tokenen, så
 * att den som kan läsa databasen inte kan använda den för att komma in.
 *
 * Ingen salt och ingen långsam hash, med flit: tokenen är 256 bitar slump, så det
 * finns ingen ordlista att gissa i, och uppslaget i databasen måste få samma hash
 * varje gång. En kod på 40 bitar går däremot att räkna baklänges ur sin hash. Den
 * skyddas av att den bara gäller i tio minuter och inte går att lösa in utan TV:ns
 * nonce, inte av hashen.
 */
export function hasha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
