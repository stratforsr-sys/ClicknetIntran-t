import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { inspelningslage, tolkaSamtal, type Tolkning } from "@/lib/samtal";

/**
 * Mottagningen av ett samtal från växeln.
 *
 * ===========================================================================
 * ORDNINGEN ÄR HELA POÄNGEN
 *
 * Råpåsen skrivs FÖRST, i en egen skrivning, innan någonting tolkas. Faller
 * tolkningen efter det har vi ändå kvar vad växeln skickade, och raden går att
 * tolka om när vi förstått fältnamnen. Skrevs den efteråt — eller i samma
 * skrivning som tolkningen — skulle ett fel i tolkningen ta med sig beviset på
 * att samtalet ens ringde.
 *
 * Därför också två utfall och inte ett:
 *
 *   `mottaget: false`  råpåsen kunde inte skrivas. Svara 500, låt växeln
 *                      skicka om — det är det enda läget där en omleverans
 *                      hjälper.
 *   `tolkat: false`    påsen ligger kvar men blev inte ett samtal. Svara 200:
 *                      växeln kan inte göra något åt vårt fel, och en
 *                      omleverans hade bara gett samma resultat en gång till.
 *                      `normalize_error` bär skälet, och `call_ingest`
 *                      raden syns i arbetslistan över otolkade.
 */

export type Mottagning = {
  mottaget: boolean;
  tolkat: boolean;
  ingestId: number | null;
  callId: string | null;
  /** Kort och avsiktligt intetsägande utåt. Skälet står i `normalize_error`. */
  skal?: string;
};

/** Headers vi sparar. `authorization` är med flit inte en av dem. */
const SPARADE_HEADERS = [
  "user-agent",
  "content-type",
  "x-forwarded-for",
  "x-request-id",
  "x-lynes-event",
  "x-webhook-event",
  "x-event-type",
];

export function avtryck(ratext: string): string {
  return createHash("sha256").update(ratext).digest("hex");
}

/**
 * Plockar ut de headers som säger något om leveransen.
 *
 * `authorization` utelämnas, och det är inte försiktighet utan ett krav:
 * hemligheten vi gett Lynes står i den, och en radlogg som ingen städar är
 * exakt fel ställe att förvara den på. Samma skäl som `sick_report` inte har
 * några textfält (0020) — det som inte lagras kan inte läcka.
 */
export function headerkarta(headers: Headers): Record<string, string> {
  const ut: Record<string, string> = {};
  for (const namn of SPARADE_HEADERS) {
    const v = headers.get(namn);
    if (v) ut[namn] = v.slice(0, 500);
  }
  return ut;
}

/**
 * Var i `phone_identity` växelns namn på en användare kan tänkas stå.
 *
 * En e-postadress är en e-postadress, ett kort tal är en anknytning, ett långt
 * en msisdn, och allt annat ett internt id hos Lynes. Vilket det blir vet vi
 * inte förrän första anropet — därför provas alla fyra i stället för att en
 * gissning skrivs in i schemat.
 */
function identitetsformer(agentRef: string): { kind: string; value: string }[] {
  const v = agentRef.trim();
  const former: { kind: string; value: string }[] = [{ kind: "lynes_user", value: v }];

  if (v.includes("@")) former.push({ kind: "epost", value: v.toLowerCase() });

  const siffror = v.replace(/[\s\-+()]/g, "");
  if (/^\d+$/.test(siffror)) {
    if (siffror.length <= 6) former.push({ kind: "anknytning", value: siffror });
    else former.push({ kind: "msisdn", value: siffror });
  }

  return former;
}

/**
 * Vem samtalet hör till, eller null.
 *
 * Två steg, och det andra är det som gör att kopplingen fungerar från dag ett:
 *
 *   1. `phone_identity` — det någon pekat ut, eller det navet redan gissat.
 *   2. E-postadressen på `employee`. Lynes-konton läggs i praktiken upp på
 *      arbetsmejlen, så den matchningen träffar direkt. Träffar den skrivs en
 *      `phone_identity`-rad med `created_by = null`, alltså märkt som en
 *      GISSNING — nästa samtal slipper då slå upp igen, och en människa kan se
 *      vad navet antagit och rätta det.
 *
 * Ingen matchning är inte ett fel. Samtalet sparas okopplat och syns i
 * arbetslistan `phone_call_okopplad_idx`.
 */
async function slaUppPerson(
  db: ReturnType<typeof supabaseAdmin>,
  agentRef: string | null,
): Promise<string | null> {
  if (!agentRef) return null;

  const former = identitetsformer(agentRef);

  for (const form of former) {
    const { data } = await db
      .from("phone_identity")
      .select("employee_id")
      .eq("kind", form.kind)
      .eq("value", form.value)
      .maybeSingle();
    if (data?.employee_id) return data.employee_id as string;
  }

  if (!agentRef.includes("@")) return null;

  const { data: person } = await db
    .from("employee")
    .select("id")
    .eq("email", agentRef.trim().toLowerCase())
    .maybeSingle();

  if (!person?.id) return null;

  // Gissningen bokförs så att den går att se och rätta. `created_by` är null —
  // se kommentaren på tabellen i 0052. Faller skrivningen (t.ex. för att någon
  // annan hann före) spelar det ingen roll: samtalet kopplas ändå.
  await db
    .from("phone_identity")
    .insert({ employee_id: person.id, kind: "epost", value: agentRef.trim().toLowerCase() })
    .then(
      () => undefined,
      () => undefined,
    );

  return person.id as string;
}

/**
 * Sömsvärdet när växeln inte skickar något eget id.
 *
 * Utan ett värde här blir varje omleverans ett nytt samtal, och en växel som
 * inte fått 200 i tid skickar om. Avtrycket av kroppen löser det: samma kropp
 * ger samma värde, alltså blir omleveransen en uppdatering. Två OLIKA samtal
 * med byte för byte identisk kropp skulle slås ihop — men en kropp utan både
 * id och tidsstämpel går ändå inte att skilja från en omleverans, så det finns
 * ingen tolkning som hade klarat det bättre.
 */
function somsvarde(t: Tolkning, avtr: string): string {
  return t.externalRef ?? `avtryck:${avtr.slice(0, 32)}`;
}

export async function taEmotSamtal(ratext: string, headers: Headers): Promise<Mottagning> {
  const db = supabaseAdmin();
  const avtr = avtryck(ratext);

  // Icke-JSON sparas som text. En växel som postar formulärdata eller som
  // skickar en trasig kropp har ändå berättat att något hände, och den raden
  // är det som gör att vi kan höra av oss till Lynes med ett exempel.
  let payload: unknown;
  try {
    payload = JSON.parse(ratext);
    if (payload === null || typeof payload !== "object") payload = { _varde: payload };
  } catch {
    payload = { _text: ratext.slice(0, 20000) };
  }

  const { data: ingest, error: ingestFel } = await db
    .from("call_ingest")
    .insert({
      source: "lynes",
      payload,
      headers: headerkarta(headers),
      fingerprint: avtr,
    })
    .select("id")
    .single();

  if (ingestFel || !ingest) {
    return { mottaget: false, tolkat: false, ingestId: null, callId: null, skal: ingestFel?.message };
  }

  const ingestId = ingest.id as number;

  try {
    const tolkning = tolkaSamtal(payload);
    const employeeId = await slaUppPerson(db, tolkning.agentRef);

    const externalRef = somsvarde(tolkning, avtr);

    // `onConflict` på sömmen. En växel skickar ofta två gånger om samma samtal
    // — en gång när det kopplas upp och en gång när det lagts på — och den
    // andra leveransen ska UPPDATERA den första, inte lägga en rad bredvid.
    //
    // Läget läses därför FÖRE upserten: har steg 2 redan hämtat hem ljudet får
    // en sen omleverans från växeln inte slå tillbaka `hamtad` till
    // `hos_vaxeln`. Då hade nedladdningen gjorts om i all evighet — och
    // villkoret `phone_call_inspelning` i 0052 hade dessutom avvisat raden,
    // eftersom `recording_file_id` fortfarande pekade på filen.
    const { data: befintlig } = await db
      .from("phone_call")
      .select("id, recording_state")
      .eq("source", "lynes")
      .eq("external_ref", externalRef)
      .maybeSingle();

    const lage: "ingen" | "hos_vaxeln" | "hamtad" =
      befintlig?.recording_state === "hamtad" ? "hamtad" : inspelningslage(tolkning);

    const rad = {
      ingest_id: ingestId,
      source: "lynes",
      external_ref: externalRef,
      direction: tolkning.direction,
      outcome: tolkning.outcome,
      raw_call_type: tolkning.rawCallType,
      raw_item_type: tolkning.rawItemType,
      agent_ref: tolkning.agentRef,
      employee_id: employeeId,
      counterpart_e164: tolkning.counterpartE164,
      counterpart_raw: tolkning.counterpartRaw,
      started_at: tolkning.startedAt,
      ended_at: tolkning.endedAt,
      duration_seconds: tolkning.durationSeconds,
      talk_seconds: tolkning.talkSeconds,
      recording_url: tolkning.recordingUrl,
      recording_state: lage,
    };

    const { data: samtal, error: samtalFel } = await db
      .from("phone_call")
      .upsert(rad, { onConflict: "source,external_ref" })
      .select("id")
      .single();

    if (samtalFel || !samtal) throw new Error(samtalFel?.message ?? "Samtalet kunde inte skrivas");

    await db.from("call_ingest").update({ normalized_at: new Date().toISOString() }).eq("id", ingestId);

    return { mottaget: true, tolkat: true, ingestId, callId: samtal.id as string };
  } catch (e) {
    const skal = e instanceof Error ? e.message : String(e);

    // Skälet skrivs på råraden och inte i en logg någon annanstans: den som
    // ska tolka om raden ska se varför den inte gick första gången, på samma
    // rad som innehållet.
    await db
      .from("call_ingest")
      .update({ normalize_error: skal.slice(0, 1000) })
      .eq("id", ingestId);

    return { mottaget: true, tolkat: false, ingestId, callId: null, skal };
  }
}
