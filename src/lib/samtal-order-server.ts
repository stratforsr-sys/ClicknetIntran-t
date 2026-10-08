import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { Samtalsrad } from "@/lib/samtal-vy";
import {
  bedomSaljsamtal,
  gallringsfrist,
  MIN_SALJSAMTAL_SEKUNDER,
  parIhop,
  saljsamtalsgrans,
  type OrderForKoppling,
  type SamtalForBedomning,
  type SamtalForKoppling,
  type Saljsamtalsbedomning,
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
 * ALLA rader, inte de första tusen.
 *
 * Supabase-API:t svarar med högst 1 000 rader per fråga och säger inget om att
 * resten saknas — svaret ser komplett ut. Fram till 2026-10-08 läste svepningen
 * `phone_call` i en enda fråga, och med 5 400 samtal såg nattjobbet bara de
 * 1 000 första. Varje order som lades upp EFTER sitt säljsamtal (alltså nästan
 * alla) fick därför aldrig sina samtal: mottagningen kunde inte koppla dem, för
 * ordern fanns inte än, och natten såg dem inte. Adlaon, Sweden City Service,
 * VästRent, G.M.W, Plåt & Mek — säljsamtal på 25–72 minuter som stod okopplade
 * och skulle ha gallrats efter 30 dygn.
 *
 * `bygg` måste ge en NY fråga varje varv — en Supabase-fråga går bara att köra
 * en gång — och sortera på något unikt, annars kan sidorna överlappa.
 */
export async function sidvis<T>(
  bygg: (fran: number, till: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const SIDA = 1000;
  const ut: T[] = [];
  for (let fran = 0; ; fran += SIDA) {
    const { data, error } = await bygg(fran, fran + SIDA - 1);
    if (error) return { data: ut, error: error.message };
    const rader = (data ?? []) as T[];
    ut.push(...rader);
    if (rader.length < SIDA) return { data: ut, error: null };
  }
}

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

  const { data: ordrarRa, error: orderfel } = await sidvis<Record<string, unknown>>((fran, till) =>
    db
      .from("sales_order")
      .select("id, contact_phone_e164, created_at, status")
      .not("contact_phone_e164", "is", null)
      .order("id")
      .range(fran, till),
  );

  if (orderfel) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: 0, fel: [orderfel] };

  const ordrar: OrderForKoppling[] = ordrarRa.map((o) => ({
    id: o.id as string,
    contactPhoneE164: o.contact_phone_e164 as string | null,
    createdAt: o.created_at as string,
    status: o.status as string,
  }));

  // En enskild order: räkna om samtalen på DESS nummer. Inte bara de som redan
  // pekar på ordern — hela poängen är att hitta dem som ännu inte gör det,
  // också de som ligger långt bakåt.
  let nummer: string | null = null;
  if (bara?.orderId) {
    nummer = ordrar.find((o) => o.id === bara.orderId)?.contactPhoneE164 ?? null;
    if (!nummer) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: ordrar.length, fel };
  }

  const { data: samtalRa, error: samtalsfel } = await sidvis<Record<string, unknown>>((fran, till) => {
    let fraga = db
      .from("phone_call")
      .select("id, counterpart_e164, started_at, sales_order_id, order_linked_by, recording_file_id")
      .not("counterpart_e164", "is", null);
    if (bara?.samtalId) fraga = fraga.eq("id", bara.samtalId);
    if (nummer) fraga = fraga.eq("counterpart_e164", nummer);
    return fraga.order("id").range(fran, till);
  });

  if (samtalsfel) return { kopplade: 0, upplosta: 0, samtal: 0, ordrar: ordrar.length, fel: [samtalsfel] };

  const samtal: SamtalForKoppling[] = samtalRa.map((s) => ({
    id: s.id as string,
    counterpartE164: s.counterpart_e164 as string | null,
    startedAt: s.started_at as string | null,
    salesOrderId: s.sales_order_id as string | null,
    orderLinkedBy: s.order_linked_by as string | null,
  }));

  const harInspelning = new Map(
    samtalRa.map((s) => [s.id as string, Boolean(s.recording_file_id)]),
  );
  const filId = new Map(
    samtalRa.map((s) => [s.id as string, s.recording_file_id as string | null]),
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

/**
 * Har ordern sitt säljsamtal från Lynes? Kopplar först, bedömer sedan.
 *
 * ===========================================================================
 * KRAVET FÖR ATT EN ORDER SKA GÅ VIDARE (beställaren 2026-10-08)
 *
 * "Ingen order någonsin utan ett samtal direkt från Lynes." Den här funktionen
 * är spärren, och den anropas på de tre ställen där en order tar ett steg:
 * `skapaOrder` (innan den lämnar utkastet), `skickaInOrder` och `godkannOrder`.
 *
 * Svepningen körs FÖRST, för den enda ordern. Säljsamtalet ringdes nästan
 * alltid innan ordern fanns, och mottagningen kunde då inte koppla det — det
 * är just det här ögonblicket som gör kopplingen möjlig. Svepningen läser bara
 * samtalen på orderns nummer, så den kostar en fråga och några skrivningar.
 *
 * Felar läsningen blir svaret NEJ, aldrig ja. En spärr som släpper igenom när
 * den inte vet är ingen spärr.
 * ===========================================================================
 */
export async function provaSaljsamtal(orderId: string): Promise<Saljsamtalsbedomning> {
  await svepKoppling({ orderId }).catch(() => undefined);

  const db = supabaseAdmin();
  const { data: order } = await db
    .from("sales_order")
    .select("salesperson_id, created_at, signed_on")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, skal: "Ordern finns inte." };

  const { data, error } = await db
    .from("phone_call")
    .select("id, employee_id, talk_seconds, started_at, recording_state")
    .eq("sales_order_id", orderId);
  if (error) return { ok: false, skal: `Samtalen gick inte att läsa: ${error.message}` };

  const samtal: SamtalForBedomning[] = (data ?? []).map((s) => ({
    id: s.id as string,
    employeeId: s.employee_id as string | null,
    talkSeconds: s.talk_seconds as number | null,
    startedAt: s.started_at as string | null,
    recordingState: s.recording_state as string,
  }));

  return bedomSaljsamtal({
    samtal,
    saljareId: order.salesperson_id as string,
    orderSkapad: order.created_at as string,
    signerad: order.signed_on as string | null,
  });
}

/** Hur långt före ordern en kandidat till säljsamtalet får ligga. */
const KANDIDATFONSTER_DYGN = 30;

export type Samtalskandidat = {
  id: string;
  startedAt: string | null;
  talkSeconds: number | null;
  counterpartE164: string | null;
  harLjud: boolean;
};

/**
 * Säljarens samtal som KAN vara säljsamtalet när numret på ordern inte träffar:
 * kunden ringde från en annan telefon, eller numret skrevs fel.
 *
 * Bara säljarens egna, minst fem minuter, de 30 dygnen före ordern, och inga
 * som redan hör till en annan affär — att flytta ett samtal från någon annans
 * order är ett annat beslut än att hitta ett som saknar ägare.
 */
export async function samtalskandidater(orderId: string): Promise<Samtalskandidat[]> {
  const db = supabaseAdmin();
  const { data: order } = await db
    .from("sales_order")
    .select("salesperson_id, created_at, signed_on")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return [];

  const till = saljsamtalsgrans(order.created_at as string, order.signed_on as string | null);
  const fran = new Date(new Date(till).getTime() - KANDIDATFONSTER_DYGN * 86_400_000).toISOString();

  const { data } = await db
    .from("phone_call")
    .select("id, started_at, talk_seconds, counterpart_e164, recording_state")
    .eq("employee_id", order.salesperson_id as string)
    .is("sales_order_id", null)
    .gte("talk_seconds", MIN_SALJSAMTAL_SEKUNDER)
    .gte("started_at", fran)
    .lte("started_at", till)
    .order("started_at", { ascending: false })
    .limit(30);

  return (data ?? []).map((s) => ({
    id: s.id as string,
    startedAt: s.started_at as string | null,
    talkSeconds: s.talk_seconds as number | null,
    counterpartE164: s.counterpart_e164 as string | null,
    harLjud: s.recording_state === "hamtad",
  }));
}
