/**
 * Filer: vad som far laddas upp, vad filen heter for en manniska, och hur lange
 * en signerad URL lever.
 *
 * Ren logik, inga importer — samma skal som `franvaro.ts` och
 * `losenordskrav.ts`: reglerna ska ga att prova utan att starta Next och utan
 * att fraga databasen. Sjalva uppladdningen och signeringen ligger i
 * `filer-server.ts`.
 *
 * ===========================================================================
 * K35: FILNAMNET AR ETT FRITEXTFALT.
 *
 * Ett lakarintyg som heter "cancerbesked.pdf" bar en diagnos. Darfor lagras
 * inget filnamn alls for `sick_certificate` — check-villkoret i 0022 gor det
 * omojligt — och `visningsnamn()` raknar fram vad den som far se filen ser.
 * ===========================================================================
 */

export type Andamal = "sick_certificate" | "document_attachment";

/** Vad varje andamal far bara. Samma lista som check-villkoret i 0022. */
export const TILLATNA_TYPER: Record<Andamal, string[]> = {
  sick_certificate: ["application/pdf", "image/jpeg", "image/png"],
  document_attachment: ["application/pdf", "image/jpeg", "image/png"],
};

/** Bucketens tak. Star i 0022 och upprepas har for att kunna nekas tidigt. */
export const MAX_BYTE = 10 * 1024 * 1024;

/**
 * Hur lange en signerad URL lever.
 *
 * Trettio sekunder later snalt och ar det inte: URL:en utfardas i samma andetag
 * som webblasaren foljer den. Den langre livslangden finns bara for den som
 * skickar lanken vidare, och det ar precis det X5 ska gora obekvamt.
 */
export const URL_SEKUNDER = 30;

export const ANDAMAL_ETIKETT: Record<Andamal, string> = {
  sick_certificate: "Läkarintyg",
  document_attachment: "Bilaga",
};

export type Filfel =
  | { kod: "typ"; text: string }
  | { kod: "storlek"; text: string }
  | { kod: "tom"; text: string };

/**
 * Provar en fil innan den nar bucketen.
 *
 * Databasen sallar ocksa, och Storage sallar en tredje gang. Det har lagret
 * finns for att felet ska ga att lasa: "PDF, JPG eller PNG" sager nagot,
 * "new row violates check constraint" gor det inte.
 */
export function provaFil(
  andamal: Andamal,
  fil: { type: string; size: number },
): Filfel | null {
  if (fil.size === 0) return { kod: "tom", text: "Filen är tom." };

  if (fil.size > MAX_BYTE)
    return {
      kod: "storlek",
      text: `Filen är ${Math.ceil(fil.size / 1024 / 1024)} MB. Högst ${MAX_BYTE / 1024 / 1024} MB.`,
    };

  // Webblasaren skickar ibland med teckenuppsattning: "application/pdf; charset=..."
  const typ = fil.type.split(";")[0].trim().toLowerCase();
  if (!TILLATNA_TYPER[andamal].includes(typ))
    return {
      kod: "typ",
      text: "Filen måste vara en PDF, JPG eller PNG.",
    };

  return null;
}

/**
 * Vad filen heter nar nagon laddar ned den.
 *
 * For ett lakarintyg finns inget lagrat namn att aterge (K35), sa det raknas
 * fram ur datumet. For en bilaga ar originalnamnet ratt svar — den som laddade
 * upp "Prislista 2026.pdf" ska fa tillbaka just den.
 */
export function visningsnamn(fil: {
  purpose: Andamal;
  filename: string | null;
  mime_type: string;
  uploaded_at?: string;
}): string {
  if (fil.purpose === "sick_certificate") {
    const dag = (fil.uploaded_at ?? "").slice(0, 10) || "utan datum";
    // ASCII med flit: strangen blir ett filnamn i Content-Disposition och i
    // mottagarens filsystem, inte en text pa en sida. Rubriken ovanfor lanken
    // heter "Lakarintyg" med a-diaeresis, som allt annat en manniska laser.
    return `Lakarintyg ${dag}${andelse(fil.mime_type)}`;
  }
  return fil.filename ?? `Bilaga${andelse(fil.mime_type)}`;
}

function andelse(mime: string): string {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  return "";
}

/** Storlek i klartext. 0,4 MB sager mer an 419430 byte. */
export function storlek(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} kB`;
  return `${(byte / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Sokvagen i bucketen.
 *
 * Filens uuid under sitt andamal, och ingenting annat. Inget av det anvandaren
 * skrivit far ligga i sokvagen: den syns i den signerade URL:en, och for ett
 * lakarintyg hade originalnamnet darmed statt i klartext i webblasarens
 * adressfalt och i varje historik den hamnar i.
 */
export function bygStig(andamal: Andamal, id: string): string {
  return `${andamal}/${id}`;
}
