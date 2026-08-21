import "server-only";

import { sammanfogaSidor } from "@/lib/pdftext";

/**
 * E2.12 / AC-5.7: text ur en bifogad PDF, sa att den gar att soka i.
 *
 * Reglerna for hopfogning och avklipp ligger i `pdftext.ts` och provas i
 * tests/pdf.mjs. Har finns bara anropet till pdfjs.
 *
 * ===========================================================================
 * ANROPAS BARA FRAN BILAGEVAGEN. ALDRIG PA ETT LAKARINTYG.
 *
 * Ett lakarintyg ar en PDF som innehaller en diagnos. Kors den har funktionen
 * pa den hamnar diagnosen i en textkolumn och darefter i ett sokindex — och
 * det ar precis vad K35 och 0020 finns for att gora omojligt.
 *
 * Skyddet ar strukturellt och inte en regel att komma ihag: det finns ingen
 * textkolumn att skriva till pa `sick_report` eller `file_object`. Texten kan
 * bara ta vagen till `document.attachment_text` (0023), och ett lakarintyg har
 * inget dokument. Skulle nagon anda anropa funktionen har svaret ingenstans
 * att ta vagen.
 * ===========================================================================
 */
export async function pdfText(data: Uint8Array): Promise<string | null> {
  try {
    // Dynamisk import: pdfjs ar stort och behovs bara nar nagon faktiskt
    // laddar upp en PDF. Legacy-bygget ar det som ar byggt for Node.
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // Inga externa hamtningar och inga systemtypsnitt. En PDF ar en fil fran
    // utsidan, och den ska behandlas darefter. (Flaggan `isEvalSupported`
    // finns inte langre i pdfjs 5 — biblioteket kor ingen eval alls.)
    const dok = await getDocument({
      data,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise;

    const sidor: string[][] = [];
    for (let i = 1; i <= dok.numPages; i++) {
      const sida = await dok.getPage(i);
      const innehall = await sida.getTextContent();
      sidor.push(innehall.items.map((x) => ("str" in x ? x.str : "")));
    }

    return sammanfogaSidor(sidor);
  } catch {
    // En trasig eller losenordsskyddad fil ar inte ett skal att neka bilagan.
    // Den blir bara inte sokbar.
    return null;
  }
}
