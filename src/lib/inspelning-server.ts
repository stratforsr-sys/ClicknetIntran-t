import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { bygStig, MAX_BYTE } from "@/lib/filer";
import { gallringsfrist } from "@/lib/samtal-order";

/**
 * Hämtar hem inspelningen medan adressen fortfarande lever.
 *
 * ===========================================================================
 * VARFÖR DET SKER I WEBHOOKEN OCH INTE I ETT JOBB
 *
 * Lynes lämnar en förhandssignerad S3-adress med `X-Amz-Expires=1800`. Den
 * lever en halvtimme. Ett jobb som städar upp i efterhand hade behövt köra
 * oftare än så — och Vercels Hobby-plan ger en cron per dygn. Ett dygn är
 * fyrtioåtta gånger för sent.
 *
 * Alltså inne i mottagningen, direkt efter att samtalet skrivits ner. Det gör
 * svaret till växeln långsammare med ungefär en sekund, och det är priset.
 *
 * ===========================================================================
 * MEN SAMTALET SKRIVS FÖRST, OCH HÄMTNINGEN FÅR ALDRIG FÄLLA DET
 *
 * Ordningen är samma som i `taEmotSamtal()` och av samma skäl. Faller
 * nedladdningen — S3 svarar långsamt, filen är borta, nätet strular — ska
 * samtalet ändå finnas. Det som går förlorat är ljudet, inte uppgiften om att
 * samtalet ägde rum.
 *
 * Därför fångas allt, och felet skrivs på raden som `recording_state =
 * 'misslyckad'` med skälet i `recording_error`. Det syns i listan och går att
 * göra om — så länge halvtimmen inte hunnit gå. Efter det är ljudet borta, och
 * raden säger varför i stället för att bara vara tom.
 *
 * ===========================================================================
 * GALLRINGSFRISTEN SÄTTS VID NEDLADDNINGEN
 *
 * Varje inspelning hämtas, också de som aldrig blir en affär — det är enda
 * sättet att ha ljudet kvar när ordern läggs in timmar senare. Avgränsningen
 * beställaren bad om lever i stället i `recording_retained_until`: sätts den
 * här, nollställs den när samtalet får en order, och nattjobbet raderar det som
 * passerat sin frist.
 *
 * Villkoret `phone_call_gallring` i 0056 gör att en rad med order INTE kan bära
 * en frist. Gallringen kan alltså inte råka radera ett bevis på ett muntligt
 * avtal.
 */

/** Så länge väntar vi på S3 innan vi ger upp och låter samtalet stå utan ljud. */
const HAMTNING_TIMEOUT_MS = 15_000;

export type Hamtning =
  | { lage: "hamtad"; fileId: string; byte: number }
  | { lage: "misslyckad"; skal: string }
  | { lage: "ingen" };

/**
 * Hämtar, lagrar och bokför en inspelning för ett samtal.
 *
 * Kastar aldrig. Anroparen ska kunna köra den utan try/catch och lita på att
 * samtalet står kvar oavsett utfall.
 */
export async function hamtaInspelning(args: {
  samtalId: string;
  employeeId: string | null;
  url: string | null;
  /** Sätts när samtalet redan hunnit paras ihop med en affär. */
  salesOrderId?: string | null;
}): Promise<Hamtning> {
  const db = supabaseAdmin();

  if (!args.url) return { lage: "ingen" };

  // Inspelningen är den anställdas egen röst — `file_object` kräver ett subjekt
  // för `call_recording` (0052, oförändrat i 0056). Utan känd person finns
  // ingen att knyta den till, och en fil utan subjekt går inte att ge rätt
  // behörighet. Den hämtas då inte; samtalet står kvar med adressen och syns i
  // listan över okopplade.
  if (!args.employeeId) {
    await skrivFel(db, args.samtalId, "Samtalet hör ännu inte till någon person.");
    return { lage: "misslyckad", skal: "okänd person" };
  }

  let buffert: Buffer;
  let mime: string;

  try {
    const svar = await fetch(args.url, {
      signal: AbortSignal.timeout(HAMTNING_TIMEOUT_MS),
    });

    if (!svar.ok) {
      const skal = `Växeln svarade ${svar.status}`;
      await skrivFel(db, args.samtalId, skal);
      return { lage: "misslyckad", skal };
    }

    buffert = Buffer.from(await svar.arrayBuffer());

    // Vad S3 säger att det är, inte vad adressen antyder. `response-content-type`
    // kan sättas i en signerad URL av den som signerade.
    mime = (svar.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  } catch (e) {
    const skal = e instanceof Error ? e.message : String(e);
    await skrivFel(db, args.samtalId, skal.slice(0, 500));
    return { lage: "misslyckad", skal };
  }

  if (buffert.byteLength === 0) {
    await skrivFel(db, args.samtalId, "Filen var tom.");
    return { lage: "misslyckad", skal: "tom fil" };
  }

  if (buffert.byteLength > MAX_BYTE.call_recording) {
    const skal = `Inspelningen är ${Math.ceil(buffert.byteLength / 1024 / 1024)} MB.`;
    await skrivFel(db, args.samtalId, skal);
    return { lage: "misslyckad", skal };
  }

  // Lynes levererar mp3. Står något annat i svaret tas mp3 ändå, för
  // check-villkoret i 0052 släpper bara in ljudtyper och `application/octet-
  // stream` — som S3 ibland svarar — hade avvisats. Filen är ljud; det är
  // servern som är vag, inte innehållet.
  const typ = mime.startsWith("audio/") ? mime : "audio/mpeg";

  const fileId = crypto.randomUUID();
  const path = bygStig("call_recording", fileId);

  const { error: lagringsfel } = await db.storage
    .from("filer")
    .upload(path, buffert, { contentType: typ, upsert: false });

  if (lagringsfel) {
    await skrivFel(db, args.samtalId, `Lagringen nekade: ${lagringsfel.message}`);
    return { lage: "misslyckad", skal: lagringsfel.message };
  }

  const checksum = createHash("sha256").update(buffert).digest("hex");

  const { error: radfel } = await db.from("file_object").insert({
    id: fileId,
    bucket: "filer",
    path,
    purpose: "call_recording",
    // Den anställdas egen röst. Se 0052 om varför en inspelning har ett subjekt
    // när orderbilagan inte har det.
    subject_employee_id: args.employeeId,
    sales_order_id: args.salesOrderId ?? null,
    filename: null,
    mime_type: typ,
    size_bytes: buffert.byteLength,
    checksum,
    // NULL, och det är ett krav: `file_object_uppladdare` i 0052 säger att
    // exakt `call_recording` saknar uppladdare. En inspelning hämtas av ett
    // jobb, och att skriva säljarens id här hade varit en osanning i just den
    // kolumn man senare lutar sig mot.
    uploaded_by: null,
  });

  if (radfel) {
    // Raden är sanningen om vad som finns. Blev det ingen rad ska det inte
    // ligga en fil kvar i bucketen som ingen kan nå — hela vägen till innehållet
    // går genom `file_object`.
    await db.storage.from("filer").remove([path]);
    await skrivFel(db, args.samtalId, radfel.message);
    return { lage: "misslyckad", skal: radfel.message };
  }

  const { error: samtalsfel } = await db
    .from("phone_call")
    .update({
      recording_state: "hamtad",
      recording_file_id: fileId,
      recording_error: null,
      // Fristen sätts bara när samtalet ännu inte hör till en affär —
      // `phone_call_gallring` tillåter inte båda.
      recording_retained_until: args.salesOrderId ? null : gallringsfrist(),
    })
    .eq("id", args.samtalId);

  if (samtalsfel) {
    await db.storage.from("filer").remove([path]);
    await db.from("file_object").delete().eq("id", fileId);
    await skrivFel(db, args.samtalId, samtalsfel.message);
    return { lage: "misslyckad", skal: samtalsfel.message };
  }

  return { lage: "hamtad", fileId, byte: buffert.byteLength };
}

async function skrivFel(
  db: ReturnType<typeof supabaseAdmin>,
  samtalId: string,
  skal: string,
): Promise<void> {
  await db
    .from("phone_call")
    .update({ recording_state: "misslyckad", recording_error: skal.slice(0, 500) })
    .eq("id", samtalId)
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Raderar innehållet i inspelningar vars frist gått ut.
 *
 * ===========================================================================
 * RADEN STÅR KVAR. BARA LJUDET FÖRSVINNER.
 *
 * `phone_call` rörs inte utöver `recording_state = 'gallrad'`, och `file_object`
 * avpubliceras med `removed_at` precis som 0022 kräver — en fil tas inte bort
 * ur registret, och öppningsloggen ska inte gå att städa bort genom att radera
 * filen.
 *
 * Det betyder att samtalet fortfarande syns, med tid, längd, motpart och
 * person. Det som står i stället för spelaren är att inspelningen gallrades och
 * när. INGET SAMTAL FÖRSVINNER — det var kravet, och det är skillnaden mellan
 * att gallra en inspelning och att radera ett samtal.
 *
 * Villkoret `phone_call_gallring` i 0056 gör dessutom att ett samtal med order
 * aldrig har en frist, så urvalet nedan kan inte råka få med ett bevis.
 */
export async function gallraInspelningar(): Promise<{
  gallrade: number;
  fel: string[];
}> {
  const db = supabaseAdmin();
  const fel: string[] = [];

  const { data: mogna, error } = await db
    .from("phone_call")
    .select("id, recording_file_id, sales_order_id")
    .eq("recording_state", "hamtad")
    .not("recording_retained_until", "is", null)
    .lt("recording_retained_until", new Date().toISOString())
    .limit(500);

  if (error) return { gallrade: 0, fel: [error.message] };

  let gallrade = 0;

  for (const rad of mogna ?? []) {
    // Bältet och hängslena. Villkoret i databasen säger redan att det här inte
    // kan hända, och just därför ska koden säga ifrån om det ändå gör det.
    if (rad.sales_order_id) {
      fel.push(`${rad.id}: har en order men också en frist — gallrades inte`);
      continue;
    }

    const { data: fil } = await db
      .from("file_object")
      .select("id, bucket, path")
      .eq("id", rad.recording_file_id)
      .maybeSingle();

    if (fil) {
      const { error: bortfel } = await db.storage.from(fil.bucket).remove([fil.path]);
      if (bortfel) {
        fel.push(`${rad.id}: ${bortfel.message}`);
        continue;
      }

      await db
        .from("file_object")
        .update({ removed_at: new Date().toISOString(), removed_by: null })
        .eq("id", fil.id);
    }

    await db
      .from("phone_call")
      .update({
        recording_state: "gallrad",
        recording_file_id: null,
        recording_retained_until: null,
      })
      .eq("id", rad.id);

    gallrade++;
  }

  return { gallrade, fel };
}
