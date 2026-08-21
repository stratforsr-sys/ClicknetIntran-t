/**
 * Reglerna for hur text ur en PDF blir sokbar text. Ren logik, inga importer.
 *
 * Ligger skilt fran `pdf.ts` med flit. Den filen bar `import "server-only"`
 * for att pdfjs aldrig ska hamna i en klientbunt, och det gor att den bara gar
 * att ladda inifran Next — alltsa inte i ett prov. Det som faktiskt har regler
 * att prova ar hopfogningen och avklippet, och de ligger darfor har.
 *
 * Kvar i `pdf.ts` blir sjalva anropet till pdfjs, som inte har nagot beslut i
 * sig.
 */

/**
 * Langre an sa har indexeras inte.
 *
 * En tsvector tar inte emot mer an 1 MB, och overskrids det failar INSERT:en —
 * alltsa hade en tillrackligt lang PDF gjort det omojligt att spara
 * dokumentet. Avklippet ar dessutom rimligt i sak: ett uppslag som traffar pa
 * sidan nittio hjalper anda ingen att hitta ratt dokument.
 */
export const MAX_TECKEN = 200_000;

/**
 * Fogar ihop sidorna till sokbar text.
 *
 * Varje sida kommer in som listan av textbitar pdfjs hittade pa den. Bitarna
 * ar ofta ett ord eller nagra tecken langa — en rubrik i sparrad stil kan bli
 * ett element per bokstav — sa de fogas med mellanslag och all upprepad
 * blanksteg kollapsas.
 *
 * Null nar det inte fanns nagon text. Det ar ett giltigt svar och inte ett
 * fel: en inskannad PDF ar bilder utan textlager, och den ska ga att bifoga
 * anda. Den blir bara inte sokbar.
 */
export function sammanfogaSidor(sidor: string[][]): string | null {
  const rader: string[] = [];
  let langd = 0;

  for (const sida of sidor) {
    const rad = sida.join(" ").replace(/\s+/g, " ").trim();
    if (!rad) continue;
    rader.push(rad);
    langd += rad.length + 1;
    if (langd > MAX_TECKEN) break;
  }

  const text = rader.join("\n").slice(0, MAX_TECKEN).trim();
  return text.length > 0 ? text : null;
}
