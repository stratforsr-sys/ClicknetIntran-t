import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  bucketFor,
  lagerForNyInspelning,
  nedladdningshuvud,
  r2Konfigurerad,
  type Lager,
  type R2Miljo,
} from "@/lib/lagring";

/**
 * ===========================================================================
 * DEN ENDA VÄGEN TILL EN BYTE, OAVSETT VILKEN LAGRING DEN LIGGER I.
 *
 * Tre verb — `laggUpp`, `taBort`, `signeraLank` — och varje anropare säger
 * vilket lager filen hör hemma i i stället för att veta hur lagret fungerar.
 * Det är samma skäl som `signeraOchLogga()` är enda vägen till en signerad
 * URL: två vägar till samma sak glider isär, och det är alltid den slappare
 * som överlever.
 *
 * Bytet är därför också litet. Den som vill flytta filerna tillbaka till
 * Supabase när planen uppgraderats behöver inte röra någon av anroparna —
 * bara `file_object.store`.
 *
 * ===========================================================================
 * VARFÖR R2 OCH INTE EN ANDRA SUPABASE
 *
 * Fria planen tillåter två projekt, alltså 1 GB till. Med 218 MB per arbetsdag
 * räcker det en vecka, och då står vi här igen med två Supabase-projekt att
 * hålla reda på i stället för ett. R2 ger 10 GB och tar inte betalt för
 * uttrafik — vilket är det som räknas när någon lyssnar igenom ett samtal på
 * fyrtiofyra minuter, för då hämtas hela filen.
 *
 * Bucketen ska skapas med EU-jurisdiktion. Inspelningar är personuppgifter,
 * och `docs` motiverar Supabases `eu-north-1` med K23 om EU-lagring; en ny
 * lagring får inte vara vägen runt det kravet. Jurisdiktionen går inte att
 * ändra i efterhand, så det måste vara rätt när bucketen skapas.
 */

function miljo(): R2Miljo {
  return {
    endpoint: process.env.R2_ENDPOINT,
    bucket: process.env.R2_BUCKET,
    nyckelId: process.env.R2_ACCESS_KEY_ID,
    hemlighet: process.env.R2_SECRET_ACCESS_KEY,
  };
}

/** Vart nästa inspelning skrivs. Se `lagerForNyInspelning`. */
export function lagerForInspelning(): Lager {
  return lagerForNyInspelning(miljo());
}

/** Bucketen i ett givet lager, med R2-namnet hämtat ur miljön. */
export function bucketen(lager: Lager): string {
  return bucketFor(lager, process.env.R2_BUCKET);
}

let klient: S3Client | null = null;

/**
 * S3-klienten mot R2.
 *
 * `region: "auto"` är R2:s eget svar — den har inga regioner i AWS mening, och
 * SigV4 kräver ändå att en står i signaturen.
 *
 * Klienten återanvänds mellan anrop i samma instans. Den bär bara nycklar och
 * en endpoint; att bygga en ny per uppladdning hade kostat en handskakning i
 * en väg som redan är det långsamma i webhooken.
 */
function r2(): S3Client {
  if (!r2Konfigurerad(miljo())) {
    throw new Error("R2 är inte uppsatt — R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID och R2_SECRET_ACCESS_KEY krävs.");
  }
  if (!klient) {
    klient = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT!.trim(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
      // =================================================================
      // INTEGRITETSHUVUDENA SKICKAS BARA NÄR DE KRÄVS, OCH DET ÄR INTE EN
      // FÖRSIKTIGHETSÅTGÄRD UTAN EN RÄTTELSE I FÖRVÄG
      //
      // Nyare versioner av AWS-klienten lägger på `x-amz-checksum-*` på varje
      // `PutObject` som standard. AWS förstår dem; S3-KOMPATIBLA lagringar har
      // upprepade gånger svarat "not implemented" på dem, och då faller varje
      // uppladdning — inte vid bygget, utan första gången ett samtal ringer.
      //
      // `WHEN_REQUIRED` ger samma beteende som klienten hade innan, och den
      // integritetskontroll vi faktiskt lutar oss mot är ändå en annan: sha256
      // räknas på bufferten här nedanför och skrivs i `file_object.checksum`.
      // =================================================================
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return klient;
}

export type Lagringssvar = { ok: true } | { ok: false; fel: string };

/**
 * Lägger upp en byte-buffert.
 *
 * `upsert: false` i Supabase och ingen motsvarighet i R2 — S3 skriver alltid
 * över. Det spelar ingen roll här: stigen bär filens uuid, och ett uuid krockar
 * inte. Skulle det ändå göra det är det raden i `file_object` som avgör vad som
 * finns, precis som förut.
 */
export async function laggUpp(args: {
  lager: Lager;
  bucket: string;
  path: string;
  data: Buffer;
  mime: string;
}): Promise<Lagringssvar> {
  if (args.lager === "supabase") {
    const { error } = await supabaseAdmin()
      .storage.from(args.bucket)
      .upload(args.path, args.data, { contentType: args.mime, upsert: false });
    return error ? { ok: false, fel: error.message } : { ok: true };
  }

  try {
    await r2().send(
      new PutObjectCommand({
        Bucket: args.bucket,
        Key: args.path,
        Body: args.data,
        ContentType: args.mime,
      }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, fel: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Tar bort innehållet.
 *
 * Kastar aldrig. Gallringen kör den femhundra gånger i rad i nattjobbet, och en
 * fil som redan är borta ska inte stoppa de fyrahundranittionio som återstår.
 */
export async function taBort(args: {
  lager: Lager;
  bucket: string;
  path: string;
}): Promise<Lagringssvar> {
  if (args.lager === "supabase") {
    const { error } = await supabaseAdmin().storage.from(args.bucket).remove([args.path]);
    return error ? { ok: false, fel: error.message } : { ok: true };
  }

  try {
    await r2().send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.path }));
    return { ok: true };
  } catch (e) {
    return { ok: false, fel: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * En kortlivad URL till innehållet.
 *
 * `laddaNedSom` satt betyder att filen ska till hårddisken i stället för att
 * öppnas i fliken — samma skillnad som förut, och den avgörs fortfarande av
 * ändamålet hos anroparen och inte här. Se `signeraOchLogga`.
 */
export async function signeraLank(args: {
  lager: Lager;
  bucket: string;
  path: string;
  sekunder: number;
  laddaNedSom?: string | null;
}): Promise<{ url: string } | { fel: string }> {
  if (args.lager === "supabase") {
    const { data, error } = await supabaseAdmin()
      .storage.from(args.bucket)
      .createSignedUrl(
        args.path,
        args.sekunder,
        args.laddaNedSom ? { download: args.laddaNedSom } : {},
      );
    if (error || !data) return { fel: error?.message ?? "Filen kunde inte signeras." };
    return { url: data.signedUrl };
  }

  try {
    const url = await getSignedUrl(
      r2(),
      new GetObjectCommand({
        Bucket: args.bucket,
        Key: args.path,
        ResponseContentDisposition: args.laddaNedSom
          ? nedladdningshuvud(args.laddaNedSom)
          : undefined,
      }),
      { expiresIn: args.sekunder },
    );
    return { url };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : String(e) };
  }
}
