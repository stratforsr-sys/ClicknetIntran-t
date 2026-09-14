import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { Samtalsrad } from "@/lib/samtal-vy";
import {
  gallringsfrist,
  parIhop,
  type OrderForKoppling,
  type SamtalForKoppling,
} from "@/lib/samtal-order";

/**
 * Skriver kopplingen mellan samtal och affär.
 *
 * ===========================================================================
 * EN SVEPNING, INTE TRE OLIKA KOPPLINGAR
 *
 * Tre saker ska kunna utlösa en koppling: ett nytt samtal kommer in, en ny
 * order läggs upp, och natten passerar. Frestelsen är att skriva tre
 * funktioner som var och en gör "sin" del.
 *
 * De skulle glida isär. Den som lägger till ett villkor i en av dem kommer
 * inte ihåg de andra två, och resultatet blir att ett samtal kopplas olika
 * beroende på vad som råkade hända först — vilket är omöjligt att felsöka,
 * för utfallet beror på historien och inte på datan.
 *
 * Därför EN svepning, som räknar om allt som inte är fastspikat av en
 * människa, och tre anropare. Den är billig: `parIhop()` returnerar bara det
 * som faktiskt skiljer sig, så en svepning utan nyheter skriver ingenting.
 *
 * ===========================================================================
 * TRE SAKER FÖLJER MED KOPPLINGEN, OCH DE MÅSTE FÖLJAS ÅT
 *
 * När ett samtal får en affär:
 *   1. `sales_order_id` och `order_linked_at` sätts på samtalet.
 *   2. `recording_retained_until` NOLLSTÄLLS — inspelningen är nu ett bevis på
 *      ett muntligt avtal och ska inte gallras. Villkoret `phone_call_gallring`
 *      i 0056 kräver det dessutom; utan nollställningen faller skrivningen.
 *   3. Filen får samma `sales_order_id`, så att den som får se affären också
 *      får höra samtalet — se RLS-grenen för `call_recording` i 0056.
 *
 * När kopplingen LÖSES UPP gäller det omvända, och punkt 2 är den viktiga:
 * en inspelning som blir orderlös igen måste få en ny frist. Utan den blir den
 * liggande för alltid — en fil ingen bestämt sig för att spara.
 */

export type Svepning = {
  kopplade: number;
  upplosta: number;
  samtal: number;
  ordrar: number;
  fel: string[];
};

/**
 * Räknar om kopplingen för alla samtal.
 *
 * `bara` begränsar vilka samtal som räknas om — en enskild order eller ett
 * enskilt samtal. Urvalet gäller VILKA SAMTAL som skrivs om, aldrig vilka
 * ordrar de får väljas bland: hela orderlistan skickas alltid in, annars kan
 * `valjOrder()` inte se att numret finns på två affärer.
 */
export async function svepKoppling(bara?: {
  samtalId?: string;
  orderId?: string;
}): Promise<Svepning> {
  const db = supabaseAdmin();
  const fel: string[] = [];

  const { data: ordrarRa, error: orderfel } = await db
    .from("sales_order")
    .select("id, contact_phone_e164, created_at")
    .not("contact_phone_e164", "is", null);

  if (orderfel) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: 0, fel: [orderfel.message] };

  const ordrar: OrderForKoppling[] = (ordrarRa ?? []).map((o) => ({
    id: o.id as string,
    contactPhoneE164: o.contact_phone_e164 as string | null,
    createdAt: o.created_at as string,
  }));

  let fraga = db
    .from("phone_call")
    .select("id, counterpart_e164, started_at, sales_order_id, order_linked_by, recording_file_id")
    .not("counterpart_e164", "is", null);

  if (bara?.samtalId) fraga = fraga.eq("id", bara.samtalId);

  // En enskild order: räkna om samtalen på DESS nummer. Inte bara de som redan
  // pekar på ordern — hela poängen är att hitta dem som ännu inte gör det,
  // också de som ligger långt bakåt.
  if (bara?.orderId) {
    const nummer = ordrar.find((o) => o.id === bara.orderId)?.contactPhoneE164;
    if (!nummer) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: ordrar.length, fel };
    fraga = fraga.eq("counterpart_e164", nummer);
  }

  const { data: samtalRa, error: samtalsfel } = await fraga;
  if (samtalsfel) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: ordrar.length, fel: [samtalsfel.message] };

  const samtal: SamtalForKoppling[] = (samtalRa ?? []).map((s) => ({
    id: s.id as string,
    counterpartE164: s.counterpart_e164 as string | null,
    startedAt: s.started_at as string | null,
    salesOrderId: s.sales_order_id as string | null,
    orderLinkedBy: s.order_linked_by as string | null,
  }));

  const harInspelning = new Map(
    (samtalRa ?? []).map((s) => [s.id as string, Boolean(s.recording_file_id)]),
  );
  const filId = new Map(
    (samtalRa ?? []).map((s) => [s.id as string, s.recording_file_id as string | null]),
  );

  const andringar = parIhop(samtal, ordrar);

  let kopplade = 0;
  let upplosta = 0;

  for (const a of andringar) {
    const nu = new Date().toISOString();

    const { error } = await db
      .from("phone_call")
      .update(
        a.orderId
          ? {
              sales_order_id: a.orderId,
              order_linked_at: nu,
              // Punkt 2. Inspelningen är nu ett bevis och gallras inte.
              recording_retained_until: null,
            }
          : {
              sales_order_id: null,
              order_linked_at: null,
              // Och tvärtom: utan affär behöver den en ny frist, annars blir
              // den liggande för alltid.
              recording_retained_until: harInspelning.get(a.samtalId) ? gallringsfrist() : null,
            },
      )
      .eq("id", a.samtalId);

    if (error) {
      fel.push(`${a.samtalId}: ${error.message}`);
      continue;
    }

    // Punkt 3. Filen följer samtalet, så att orderns behörighet gäller ljudet.
    const fil = filId.get(a.samtalId);
    if (fil) {
      await db
        .from("file_object")
        .update({ sales_order_id: a.orderId })
        .eq("id", fil)
        .then(
          () => undefined,
          () => undefined,
        );
    }

    if (a.orderId) kopplade++;
    else upplosta++;
  }

  return { kopplade, upplosta, samtal: samtal.length, ordrar: ordrar.length, fel };
}

/**
 * Pekar om ett samtal till en annan affär, eller lossar det helt.
 *
 * `beslutadAv` SKA vara den som tryckte. Det är skillnaden mot svepningen: en
 * människa som flyttat ett samtal ska inte få sitt beslut överskrivet nästa
 * natt. Samma resonemang som `phone_identity.created_by` i 0052.
 */
export async function kopplaForHand(args: {
  samtalId: string;
  orderId: string | null;
  beslutadAv: string;
}): Promise<{ fel?: string }> {
  const db = supabaseAdmin();

  const { data: samtal } = await db
    .from("phone_call")
    .select("id, recording_file_id")
    .eq("id", args.samtalId)
    .maybeSingle();

  if (!samtal) return { fel: "Samtalet finns inte." };

  const nu = new Date().toISOString();

  const { error } = await db
    .from("phone_call")
    .update(
      args.orderId
        ? {
            sales_order_id: args.orderId,
            order_linked_at: nu,
            order_linked_by: args.beslutadAv,
            recording_retained_until: null,
          }
        : {
            sales_order_id: null,
            order_linked_at: null,
            // Lossas kopplingen för hand ska svepningen få försöka igen —
            // annars sitter samtalet fast som "medvetet olöst" för alltid.
            order_linked_by: null,
            recording_retained_until: samtal.recording_file_id ? gallringsfrist() : null,
          },
    )
    .eq("id", args.samtalId);

  if (error) return { fel: error.message };

  if (samtal.recording_file_id) {
    await db
      .from("file_object")
      .update({ sales_order_id: args.orderId })
      .eq("id", samtal.recording_file_id)
      .then(
        () => undefined,
        () => undefined,
      );
  }

  return {};
}

/**
 * Samtalen för en uppsättning order, i EN fråga.
 *
 * Läses med ANVÄNDARENS klient och inte med service role. RLS avgör vad som
 * syns — `phone_call_read` i 0056 släpper in den som ringde, hens chef,
 * ledningen, och den som får se affären. En sida som filtrerat själv hade varit
 * ett andra svar på samma fråga, och det första hade stått kvar i databasen och
 * hunnit glida isär från det.
 *
 * Samma form som `hamtaOrderbilagor()`: en fråga för alla rader på sidan, inte
 * en fråga per rad på en sida som redan ligger i den blockerande vägen.
 */
export async function hamtaOrdersamtal(
  orderIds: string[],
): Promise<Map<string, Samtalsrad[]>> {
  const ut = new Map<string, Samtalsrad[]>();
  if (orderIds.length === 0) return ut;

  const db = await supabaseServer();

  const { data } = await db
    .from("phone_call")
    // EN LITERAL, inte en summa av strangar. Supabase-klienten harleder radens
    // typ ur select-strangen, och den harledningen kraver att strangen ar
    // statiskt lasbar. Skriven som `"a, b" + "c, d"` blir raden
    // `GenericStringError` och varje faltatkomst ett typfel — samma falla som
    // provisionsvyn gick i 2026-09-10, och den star i arbetsloggen dar.
    .select(
      "id, sales_order_id, direction, outcome, counterpart_e164, counterpart_raw, started_at, duration_seconds, talk_seconds, recording_state, recording_file_id, recording_error, order_linked_by, employee_id",
    )
    .in("sales_order_id", orderIds)
    .order("started_at", { ascending: false });

  for (const r of data ?? []) {
    const orderId = r.sales_order_id as string;
    const rad: Samtalsrad = {
      id: r.id as string,
      direction: r.direction as Samtalsrad["direction"],
      outcome: r.outcome as string,
      counterpartE164: r.counterpart_e164 as string | null,
      counterpartRaw: r.counterpart_raw as string | null,
      startedAt: r.started_at as string | null,
      durationSeconds: r.duration_seconds as number | null,
      talkSeconds: r.talk_seconds as number | null,
      recordingState: r.recording_state as Samtalsrad["recordingState"],
      recordingFileId: r.recording_file_id as string | null,
      recordingError: r.recording_error as string | null,
      orderLinkedBy: r.order_linked_by as string | null,
      employeeId: r.employee_id as string | null,
    };
    ut.set(orderId, [...(ut.get(orderId) ?? []), rad]);
  }

  return ut;
}
