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
 * Lagger en fil i bucketen och skriver raden.
 *
 * Behorigheten kontrolleras av ANROPAREN — den skiljer sig at per andamal
 * (chefen far ladda upp ett intyg at den sjuke, men bara agaren far lagga en
 * bilaga pa sin rutin), och den skillnaden hor hemma dar handlingen bor.
 *
 * Filen namnges med sitt eget uuid. Det som anvandaren skrev finns kvar i
 * `filename` for bilagor och ingenstans alls for lakarintyg (K35).
 */
export async function laddaUppFil(args: {
  andamal: Andamal;
  fil: File;
  uploadedBy: string;
  subjectEmployeeId?: string | null;
  sickReportId?: string | null;
  documentId?: string | null;
}): Promise<{ id: string } | { fel: string }> {
  const fel = provaFil(args.andamal, { type: args.fil.type, size: args.fil.size });
  if (fel) return { fel: fel.text };

  const db = supabaseAdmin();
  const id = crypto.randomUUID();
  const stig = bygStig(args.andamal, id);
  const buffert = Buffer.from(await args.fil.arrayBuffer());
  const mime = args.fil.type.split(";")[0].trim().toLowerCase();

  const { error: uppladdningsfel } = await db.storage
    .from("filer")
    .upload(stig, buffert, { contentType: mime, upsert: false });

  if (uppladdningsfel) return { fel: uppladdningsfel.message };

  const { error: radfel } = await db.from("file_object").insert({
    id,
    bucket: "filer",
    path: stig,
    purpose: args.andamal,
    subject_employee_id: args.subjectEmployeeId ?? null,
    sick_report_id: args.sickReportId ?? null,
    document_id: args.documentId ?? null,
    // K35: ett lakarintyg bar aldrig med sig namnet det hade pa datorn.
    filename: args.andamal === "sick_certificate" ? null : args.fil.name.slice(0, 200),
    mime_type: mime,
    size_bytes: args.fil.size,
    checksum: createHash("sha256").update(buffert).digest("hex"),
    uploaded_by: args.uploadedBy,
  });

  // Blev raden aldrig skriven ar filen i bucketen inte nabar for nagon — den
  // enda vagen dit gar genom en rad. Den stads bort direkt i stallet for att
  // ligga kvar som ett spoke ingen kan redovisa i ett registerutdrag.
  if (radfel) {
    await db.storage.from("filer").remove([stig]);
    return { fel: radfel.message };
  }

  await db.from("file_access_log").insert({
    file_id: id,
    actor_id: args.uploadedBy,
    action: "upload",
    purpose: args.andamal,
  });

  return { id };
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
