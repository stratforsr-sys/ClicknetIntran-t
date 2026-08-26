import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { bygStig, provaFil, visningsnamn, URL_SEKUNDER, type Andamal } from "@/lib/filer";

/**
 * ===========================================================================
 * K36 / AC-3.22 / X5: DEN ENDA VAGEN TILL EN FIL.
 *
 * `signeraOchLogga()` gor tre saker i den har ordningen, och ordningen ar hela
 * kravet:
 *
 *   1. laser filens rad med ANVANDARENS EGEN TOKEN — far hen ingen rad ur
 *      `file_object` finns filen inte for hen, och RLS har redan svarat pa
 *      fragan om behorighet,
 *   2. skriver raden i `file_access_log`,
 *   3. utfardar en signerad URL som lever i trettio sekunder.
 *
 * Misslyckas steg 2 blir det ingen URL. Det ar tvartemot den vanliga regeln
 * att loggning aldrig ska kunna falla en funktion — men har ar loggen sjalva
 * kravet. En fil som gick att oppna utan att det syns ar precis det K36
 * forbjuder, och ett tyst tapp i loggen ser i en granskning ut som en fil
 * ingen oppnat.
 *
 * Behorighetsfragan stalls INTE en andra gang i den har filen. RLS pa
 * `file_object` arver policyn fran det objekt filen hor till (0022), och ett
 * eget villkor har hade blivit ett andra svar pa samma fraga — de glider isar,
 * och det ar alltid det slappare som overlever.
 * ===========================================================================
 */

export type Fil = {
  id: string;
  bucket: string;
  path: string;
  purpose: Andamal;
  filename: string | null;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string;
  removed_at: string | null;
};

export const FILFALT =
  "id, bucket, path, purpose, filename, mime_type, size_bytes, uploaded_at, uploaded_by, removed_at";

/**
 * Ger en kortlivad URL till filen, och skriver oppningen.
 *
 * Lamnar tillbaka null nar filen inte finns, ar borttagen, eller nar den
 * fragande inte far se den — samma svar i alla tre fallen. AC-5.8 drog samma
 * linje for dokument: den som inte far se nagot ska inte fa veta att det finns.
 */
export async function signeraOchLogga(
  fileId: string,
  actorEmployeeId: string,
  ip?: string | null,
): Promise<{ url: string; namn: string } | null> {
  const somAnvandaren = await supabaseServer();

  const { data: fil } = await somAnvandaren
    .from("file_object")
    .select(FILFALT)
    .eq("id", fileId)
    .maybeSingle<Fil>();

  if (!fil || fil.removed_at) return null;

  const db = supabaseAdmin();

  // Steg 2 fore steg 3. Faller den har skrivningen far ingen filen.
  const { error: loggfel } = await db.from("file_access_log").insert({
    file_id: fil.id,
    actor_id: actorEmployeeId,
    action: "open",
    purpose: fil.purpose,
    ip: ip ?? null,
  });

  if (loggfel) {
    throw new Error(
      `Oppningen kunde inte loggas, sa filen lamnas inte ut (K36): ${loggfel.message}`,
    );
  }

  const namn = visningsnamn(fil);
  const { data: signerad, error } = await db.storage
    .from(fil.bucket)
    .createSignedUrl(fil.path, URL_SEKUNDER, { download: namn });

  if (error || !signerad) throw new Error(error?.message ?? "Filen kunde inte signeras.");

  return { url: signerad.signedUrl, namn };
}

/**
 * ===========================================================================
 * UPPLADDNINGEN GAR INTE GENOM SERVERN. DET AR INTE EN OPTIMERING.
 *
 * Vercel tar emot hogst 4,5 MB i kroppen till en serverlos funktion, och en
 * server action ar en sadan. En intygssida fotograferad med telefon ar ofta
 * storre an sa, och en kvart inspelat samtal ar det alltid — felet hade
 * kommit fran plattformen, med ett meddelande som inte sager nagot om vad
 * anvandaren gjorde.
 *
 * Darfor tva steg:
 *
 *   1. `forberedUppladdning()` kontrollerar behorighet och lamnar tillbaka en
 *      signerad uppladdningslank. Ingen rad skrivs an.
 *   2. Webblasaren lagger filen direkt i bucketen.
 *   3. `registreraFil()` fragar Storage vad som FAKTISKT kom in, provar
 *      reglerna mot det, och skriver raden.
 *
 * Steg 3 provar om, och det ar viktigare an det later: efter omlaggningen ar
 * det klienten som beskriver sin egen fil i steg 1. Ett pastaende om storlek
 * och typ ar inte en kontroll. Storage sallar ocksa sjalvt pa bucketens tak
 * och mime-lista, sa en fil som ljuger kommer sallan ens forbi steg 2 — men
 * den som avgor ar steg 3.
 *
 * En fil utan rad nas inte av nagon: hela vagen till innehallet gar genom
 * `file_object`. Stannar ett forsok mellan steg 2 och 3 ligger det darfor kvar
 * som ett spoke i bucketen tills nagon stadar — och det ar ratt sida att fela
 * at. Alternativet vore en rad utan fil, som syns i ett registerutdrag och i
 * en lista men ger 404 nar nagon klickar.
 * ===========================================================================
 */

export type Uppladdningslank = {
  fileId: string;
  bucket: string;
  path: string;
  token: string;
};

/**
 * Steg 1. Kontrollerar behorigheten och oppnar en vag in i bucketen.
 *
 * Behorigheten kontrolleras av ANROPAREN innan den har anropas — den skiljer
 * sig at per andamal, och den skillnaden hor hemma dar handlingen bor.
 */
export async function forberedUppladdning(args: {
  andamal: Andamal;
  filnamn: string;
  mimetyp: string;
  storlek: number;
}): Promise<Uppladdningslank | { fel: string }> {
  const fel = provaFil(args.andamal, { type: args.mimetyp, size: args.storlek });
  if (fel) return { fel: fel.text };

  const fileId = crypto.randomUUID();
  const path = bygStig(args.andamal, fileId);

  const { data, error } = await supabaseAdmin()
    .storage.from("filer")
    .createSignedUploadUrl(path);

  if (error || !data) return { fel: error?.message ?? "Uppladdningen kunde inte förberedas." };

  return { fileId, bucket: "filer", path, token: data.token };
}

/**
 * Steg 3. Skriver raden — efter att ha fragat Storage vad som kom in.
 *
 * Filen namnges med sitt eget uuid. Det som anvandaren skrev finns kvar i
 * `filename` for bilagor och rollspel, och ingenstans alls for lakarintyg
 * (K35).
 */
export async function registreraFil(args: {
  fileId: string;
  andamal: Andamal;
  filnamn: string;
  uploadedBy: string;
  subjectEmployeeId?: string | null;
  sickReportId?: string | null;
  documentId?: string | null;
  salesOrderId?: string | null;
}): Promise<{ id: string } | { fel: string }> {
  const db = supabaseAdmin();
  const path = bygStig(args.andamal, args.fileId);

  // Vad ligger dar egentligen? `list` med sokning pa filnamnet ger storlek och
  // mime-typ som Storage sjalvt registrerade, inte som klienten pastod.
  const { data: poster } = await db.storage
    .from("filer")
    .list(args.andamal, { search: args.fileId, limit: 1 });

  const post = poster?.[0];
  if (!post) return { fel: "Filen kom aldrig fram. Försök igen." };

  const storlek = Number(post.metadata?.size ?? 0);
  const mime = String(post.metadata?.mimetype ?? "").split(";")[0].trim().toLowerCase();

  const fel = provaFil(args.andamal, { type: mime, size: storlek });
  if (fel) {
    await db.storage.from("filer").remove([path]);
    return { fel: fel.text };
  }

  // Laddas ned en gang for att kunna sagas att den ar densamma i efterhand.
  // Ett intyg som byts ut mot ett annat ska ga att upptacka.
  const { data: innehall } = await db.storage.from("filer").download(path);
  const checksum = innehall
    ? createHash("sha256").update(Buffer.from(await innehall.arrayBuffer())).digest("hex")
    : null;

  if (!checksum) {
    await db.storage.from("filer").remove([path]);
    return { fel: "Filen gick inte att läsa tillbaka. Försök igen." };
  }

  const { error: radfel } = await db.from("file_object").insert({
    id: args.fileId,
    bucket: "filer",
    path,
    purpose: args.andamal,
    subject_employee_id: args.subjectEmployeeId ?? null,
    sick_report_id: args.sickReportId ?? null,
    document_id: args.documentId ?? null,
    // 0039. En orderbilaga hor till en KUNDAFFAR och till ingen manniska —
    // `subjectEmployeeId` ska vara null for den, och check-villkoret nekar
    // annars raden. Satts den till saljaren blir kundens avtal en uppgift om
    // den anstallda och foljer med ut i hens registerutdrag.
    sales_order_id: args.salesOrderId ?? null,
    // K35: ett lakarintyg bar aldrig med sig namnet det hade pa datorn.
    filename: args.andamal === "sick_certificate" ? null : args.filnamn.slice(0, 200),
    mime_type: mime,
    size_bytes: storlek,
    checksum,
    uploaded_by: args.uploadedBy,
  });

  if (radfel) {
    await db.storage.from("filer").remove([path]);
    return { fel: radfel.message };
  }

  await db.from("file_access_log").insert({
    file_id: args.fileId,
    actor_id: args.uploadedBy,
    action: "upload",
    purpose: args.andamal,
  });

  return { id: args.fileId };
}

/**
 * Tar bort innehallet ur bucketen men later raden och loggen sta kvar.
 *
 * En fil som gick att radera helt hade tagit sin egen oppningslogg med sig
 * (0022), och den som last ett intyg tio ganger hade kunnat stada bort
 * beviset genom att ta bort filen efterat.
 */
export async function taBortInnehall(fileId: string, actorEmployeeId: string): Promise<void> {
  const db = supabaseAdmin();

  const { data: fil } = await db
    .from("file_object")
    .select(FILFALT)
    .eq("id", fileId)
    .maybeSingle<Fil>();

  if (!fil || fil.removed_at) return;

  await db.storage.from(fil.bucket).remove([fil.path]);
  await db
    .from("file_object")
    .update({ removed_at: new Date().toISOString(), removed_by: actorEmployeeId })
    .eq("id", fileId);

  await db.from("file_access_log").insert({
    file_id: fileId,
    actor_id: actorEmployeeId,
    action: "remove",
    purpose: fil.purpose,
  });
}
