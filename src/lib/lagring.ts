/**
 * Vilken lagring en fil ligger i. Ren logik, inga importer.
 *
 * ===========================================================================
 * TVÅ LAGRINGAR, OCH RADEN AVGÖR — ALDRIG MILJÖN
 *
 * Supabases fria plan tog slut på fillagring (se 0065). Samtalsinspelningarna
 * skrivs därför till Cloudflare R2, medan allt som redan ligger i Supabase
 * ligger kvar där.
 *
 * Det betyder att båda lagringarna är i bruk samtidigt, och att frågan "var
 * ligger den här filen?" måste besvaras **per fil**. Svaret står i
 * `file_object.store`.
 *
 * DEN FRÅGAN FÅR ALDRIG BESVARAS AV EN MILJÖVARIABEL. Frestelsen är att låta
 * "R2 är påslaget" betyda "filerna ligger i R2" — det är sant för de nya och
 * falskt för de 1 693 gamla, och den dagen någon stänger av R2 igen pekar
 * varenda ny rad fel. En miljövariabel kan bara ha ett värde åt gången; under
 * en flytt ligger filerna på båda ställena.
 *
 * Miljön avgör exakt en sak: vart NÄSTA fil skrivs. Det är `r2Konfigurerad()`.
 * Var en BEFINTLIG fil ligger avgörs av `tolkaLager()`, och den frågar bara
 * raden.
 */

export type Lager = "supabase" | "r2";

/**
 * Lagret en rad pekar ut, med Supabase som svar när raden inte säger något.
 *
 * Defaulten är densamma som i 0065, och av samma skäl: allt som fanns före
 * kolumnen ligger i Supabase. Men den fyller också en andra roll här — en
 * läsning som glömt att välja `store` ger `undefined`, och då ska filen slås
 * upp där de allra flesta filer faktiskt ligger i stället för att kastas.
 *
 * Ett okänt värde behandlas likadant. Det kan bara uppstå om någon lagt till
 * ett lager i check-villkoret utan att lära koden om det, och då är ett
 * uppslag som misslyckas i Supabase ett begripligare fel än ett krasch-fel
 * långt från orsaken.
 */
export function tolkaLager(varde: unknown): Lager {
  return varde === "r2" ? "r2" : "supabase";
}

/** Miljövärdena R2 behöver. Alla fyra, eller inget. */
export type R2Miljo = {
  endpoint?: string;
  bucket?: string;
  nyckelId?: string;
  hemlighet?: string;
};

/**
 * Är R2 fullständigt uppsatt?
 *
 * ALLA FYRA KRÄVS, och halvvägs räknas som avstängt. En endpoint utan nyckel
 * ger inte en halv uppladdning utan ett fel per samtal, och felet syns först
 * när någon undrar varför inspelningarna tog slut. Saknas något faller
 * skrivningen tillbaka på Supabase, som fungerar — trångt, men fungerar.
 */
export function r2Konfigurerad(miljo: R2Miljo): boolean {
  return [miljo.endpoint, miljo.bucket, miljo.nyckelId, miljo.hemlighet].every(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}

/**
 * Vart nästa inspelning ska skrivas.
 *
 * Bara inspelningar. Läkarintyg, orderbilagor och dokumentbilagor fortsätter
 * till Supabase oavsett vad som står här — de laddas upp direkt från
 * webbläsaren med en signerad uppladdningslänk (se `forberedUppladdning`), de
 * är tillsammans noll byte i dag, och att flytta dem hade betytt att bygga om
 * en uppladdningsväg som fungerar för att lösa ett problem den inte orsakar.
 */
export function lagerForNyInspelning(miljo: R2Miljo): Lager {
  return r2Konfigurerad(miljo) ? "r2" : "supabase";
}

/**
 * Namnet på bucketen i ett givet lager.
 *
 * Supabase har en enda bucket och den heter `filer` sedan 0022. R2:s heter vad
 * den heter i Cloudflare, och namnet skrivs ner på filens rad — inte läses ur
 * miljön vid uppslag. Byter någon `R2_BUCKET` ska gamla filer fortsätta hittas
 * i den bucket de faktiskt ligger i.
 */
export function bucketFor(lager: Lager, r2Bucket: string | undefined): string {
  if (lager === "supabase") return "filer";
  const namn = r2Bucket?.trim();
  if (!namn) throw new Error("R2_BUCKET saknas — det går inte att välja bucket i R2.");
  return namn;
}

/**
 * Content-Disposition för en nedladdning, med filnamnet kodat.
 *
 * Supabase-klienten tar filnamnet som en sträng och kodar själv. R2 signeras
 * med ett färdigt huvud, så kodningen är vår. Ett svenskt filnamn — "Läkarintyg
 * Hässelby.pdf" — är inte latin-1, och ett rått sådant i ett HTTP-huvud ger
 * antingen mojibake eller ett avvisat anrop.
 *
 * Därför RFC 5987: ett asciifierat `filename` för det som är gammalt, och
 * `filename*` med procentkodad UTF-8 för det som inte är det.
 */
export function nedladdningshuvud(namn: string): string {
  const ascii = namn.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(namn)}`;
}
