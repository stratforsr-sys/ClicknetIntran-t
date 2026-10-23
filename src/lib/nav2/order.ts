import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  hamtaAvtalsslut,
  hamtaChefssatser,
  hamtaCrmkopplingar,
  hamtaFinanssatser,
  hamtaOrder,
  hamtaOrderUrval,
  hamtaOrderbilagor,
  hamtaPaket,
  hamtaSatser,
  hamtaTjanster,
  hamtaUtkopssatser,
  raknaKo,
} from "@/lib/order-server";
import { hamtaPerioder } from "@/lib/bonus-server";
import { hamtaOrdersamtal } from "@/lib/samtal-order-server";
import { MIN_SALJSAMTAL_SEKUNDER } from "@/lib/samtal-order";
import { ORDERTAK, TOMT_FILTER } from "@/lib/ordervy";
import { AVTALSSLUT_VARSEL_DAGAR, LOPTIDER, dagarTill, grundprovision, nettoAntal, ordervarde, provisionFor } from "@/lib/order";
import { gallandeChefssats } from "@/lib/chefsprovision";
import { gallandeUtkopssats } from "@/lib/utkop";
import { gallandeFinanssats } from "@/lib/finans";
import { manadFore, manadsnyckel } from "@/lib/provision";
import { formaOrder, formaSida, formaUtskrift, svenskTid, type NdOrder, type NdSamtal, type NdSida, type NdUtskrift, type RaOrder, type RaSamtal } from "./orderforma";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: Order och kundkortet, med samma funktioner som /order.
 *
 * Listan ar `hamtaOrderUrval` utan filter (utkastet filtrerar i webblasaren),
 * nyckeltalen ar sidans egna (`nettoAntal`, `grundprovision`, `ordervarde` pa
 * `hamtaOrder(manad)`, `raknaKo`, `hamtaAvtalsslut`), och kundkortets material
 * ar `hamtaTjanster`, `hamtaOrderbilagor`, `hamtaOrdersamtal` och
 * `hamtaCrmkopplingar` — for alla order pa en gang i stallet for en kund at
 * gangen, eftersom utkastet oppnar kortet utan att ladda om sidan.
 *
 * Allt med anvandarens token. RLS (`sales_order_read`) ger saljaren sina egna
 * order och chefskretsen alla, precis som pa /order.
 *
 * Provisionen ar repots: fryst `commission_amount` pa en godkand order, och pa
 * en som vantar det godkannandet skulle frysa i dag (se `orderforma.ts`).
 *
 * Det 0083 och 0084 lade till for det utkastet har och navet saknade, med
 * samma token: den fasta anteckningen per kund, nar personen senast tittade
 * pa listan, kampanjsidornas lage (`kampanjsidor_lage()`) och utskrifterna av
 * samtalen. Allt som skriver gar genom /nav2/order, bakom SKRIVLAGE.order.
 */

export type NdOrderdata = {
  order: NdOrder[];
  /** Fler an ORDERTAK order finns; listan visar de senaste. */
  kapad: boolean;
  samtal: NdSamtal[];
  /** Sidans nyckeltal for innevarande manad, oberoende av filter. */
  nyckeltal: {
    manad: string;
    antal: number;
    provision: number;
    varde: number;
    utanVarde: number;
    ko: number;
    loperUt: number;
    utgangna: number;
  };
  paket: { id: number; l: string; pris: number }[];
  /** Vad en order ger i dag: provisionFor per paket och bindningstid, null = ingen sats. */
  matris: Record<number, Record<number, number | null>>;
  /** Satserna, for formularets forhandsvisning pa valfritt signeringsdatum. */
  satser: { package_id: number; term_months: number; amount: number; valid_from: string; valid_to: string | null }[];
  chefssatser: { employee_id: string; override_percent: number; own_sale_percent: number; valid_from: string; valid_to: string | null }[];
  utkopssatser: { percent: number; valid_from: string; valid_to: string | null }[];
  finanssatser: { percent_per_year: number; valid_from: string; valid_to: string | null }[];
  /** De som galler i dag, for texterna ("40 % av nettot", "11 % per ar"). */
  idag: { egen: number | null; overtack: number | null; utkop: number | null; finans: number | null; chefId: string | null };
  /** Faststallda manader, "YYYY-MM". */
  stangda: string[];
  /** Hanterar order (godkanner, makulerar): sales_manager, ceo, finance. */
  hanterare: boolean;
  /** Far markera betald: finance, ceo. */
  bokforare: boolean;
  /** Valbara saljare for chefen (SALJANDE_ROLLER pa /order). */
  saljare: { id: string; namn: string }[];
  /** Den inloggades egna samtal som kan vara ett saljsamtal: i dag och i gar, minst fem minuter, inte kopplade. */
  kandidater: { id: string; nar: string; sek: number; nr: string; ljud: boolean }[];
  varselDagar: number;
  ortak: number;
  /** 0083: den fasta anteckningen per kund (organisationsnummer). */
  fasta: Record<string, { kommentar: string; text: string; vem: string | null; av: string | null; nar: string }>;
  /** 0083: nar den inloggade senast oppnade orderlistan, eller null. */
  sett: string | null;
  /** 0084: kampanjsidornas lage per kund (organisationsnummer). */
  sidor: Record<string, NdSida>;
  /** Sparar vyn (SKRIVLAGE.order)? Annars svarar /nav2/order med lasläge. */
  skriv: boolean;
};

const SALJANDE_ROLLER = new Set(["salesperson", "sales_manager", "ceo"]);

export async function byggOrder(supabase: SupabaseClient, user: CurrentUser): Promise<NdOrderdata> {
  const mig = user.employee!.id;
  const hanterare = hasRole(user, "sales_manager", "ceo", "finance");
  const bokforare = hasRole(user, "finance", "ceo");
  const idag = svensktDatum();
  const manad = manadsnyckel();

  const igar = new Date(Date.parse(`${idag}T00:00:00Z`) - 864e5 - 2 * 3600e3).toISOString();

  const [urval, manadens, ko, loperUt, paket, satser, chefssatser, utkopssatser, finanssatser, perioder, { data: extra }, { data: personer }, { data: egnaSamtal }] =
    await Promise.all([
      hamtaOrderUrval(TOMT_FILTER),
      hamtaOrder(manad),
      raknaKo(),
      hamtaAvtalsslut(idag),
      hamtaPaket(),
      hamtaSatser(),
      hamtaChefssatser(),
      hamtaUtkopssatser(),
      hamtaFinanssatser(),
      hamtaPerioder(manadFore(manad, 11)),
      // 0080 och vem som godkant och makulerat — `FALT` i order-server.ts bar dem inte.
      supabase.from("sales_order").select("id, order_number, approved_by, cancelled_by, free_order_reason, discounted_monthly_amount"),
      supabase.from("employee").select("id, first_name, last_name, status, employee_role!employee_role_employee_id_fkey(role)"),
      supabase
        .from("phone_call")
        .select("id, started_at, talk_seconds, counterpart_e164, counterpart_raw, recording_state")
        .eq("employee_id", mig)
        .is("sales_order_id", null)
        .gte("talk_seconds", MIN_SALJSAMTAL_SEKUNDER)
        .gte("started_at", igar)
        .order("started_at", { ascending: false })
        .limit(30),
    ]);

  const ids = urval.order.map((o) => o.id);
  const [tjanster, bilagor, samtal, crm, { data: filinfo }] = await Promise.all([
    hamtaTjanster(ids),
    hamtaOrderbilagor(ids),
    hamtaOrdersamtal(ids),
    hamtaCrmkopplingar(ids),
    ids.length
      ? supabase.from("file_object").select("id, size_bytes, uploaded_by").eq("purpose", "sales_order").in("sales_order_id", ids)
      : Promise.resolve({ data: [] as { id: string; size_bytes: number | null; uploaded_by: string | null }[] }),
  ]);

  // 0083/0084: utskrifterna for samtalen pa listans order, de fasta anteckningarna,
  // "sett senast" och kampanjsidornas lage. Allt med anvandarens token.
  const samtalIds = [...samtal.values()].flat().map((c) => c.id);
  const [{ data: utskriftRader }, { data: fastRader }, { data: settRad }, { data: sidRader }] = await Promise.all([
    samtalIds.length
      ? supabase.from("call_transcript").select("call_id, status, segments, error").in("call_id", samtalIds)
      : Promise.resolve({ data: [] as { call_id: string; status: string; segments: unknown; error: string | null }[] }),
    supabase.from("customer_note_pin").select("org_number, inkio_comment_id, body, author_name, pinned_by, pinned_at"),
    supabase.from("order_list_seen").select("seen_at").eq("employee_id", mig).maybeSingle(),
    supabase.rpc("kampanjsidor_lage"),
  ]);
  const utskrifter = new Map<string, NdUtskrift>(
    ((utskriftRader ?? []) as { call_id: string; status: string; segments: unknown; error: string | null }[]).map((u) => [u.call_id, formaUtskrift(u)]),
  );

  const namnFor = new Map((personer ?? []).map((p) => [p.id as string, fullName(p)]));
  const namn = (id: string | null | undefined) => (id ? namnFor.get(id) ?? null : null);
  const extraFor = new Map((extra ?? []).map((r) => [r.id as string, r]));
  const filFor = new Map((filinfo ?? []).map((f) => [f.id as string, f]));

  const satserna = { paket, satser, chefssatser, utkopssatser, finanssatser };
  const order: NdOrder[] = [];
  const allaSamtal: NdSamtal[] = [];
  for (const o of urval.order) {
    const x = extraFor.get(o.id);
    const rad = {
      ...o,
      order_number: x ? Number(x.order_number) : null,
      approved_by: (x?.approved_by as string | null) ?? null,
      cancelled_by: (x?.cancelled_by as string | null) ?? null,
      free_order_reason: (x?.free_order_reason as string | null) ?? null,
      // 0221 (S08): numeric kommer som sträng.
      discounted_monthly_amount: x?.discounted_monthly_amount == null ? null : Number(x.discounted_monthly_amount),
    } as unknown as RaOrder;
    const { order: ut, samtal: s } = formaOrder(rad, {
      satser: satserna,
      tjanster: tjanster.get(o.id) ?? [],
      samtal: (samtal.get(o.id) ?? []) as RaSamtal[],
      bilagor: (bilagor.get(o.id) ?? []).map((b) => ({ ...b, size_bytes: filFor.get(b.id)?.size_bytes ?? null, uploaded_by: filFor.get(b.id)?.uploaded_by ?? null })),
      crm: crm.get(o.id) ?? null,
      namn,
      utskrifter,
    });
    order.push(ut);
    allaSamtal.push(...s);
  }

  const varde = ordervarde(manadens, manad);
  const chefIdag = gallandeChefssats(chefssatser, idag);
  const matris: NdOrderdata["matris"] = {};
  for (const p of paket) {
    matris[p.id] = {};
    for (const m of LOPTIDER) matris[p.id][m] = provisionFor(satser, p.id, m, idag);
  }

  const saljare = hanterare
    ? (personer ?? [])
        .filter((e) => ["active", "onboarding"].includes(e.status as string))
        .filter((e) => ((e as unknown as { employee_role: { role: string }[] | null }).employee_role ?? []).some((r) => SALJANDE_ROLLER.has(r.role)))
        .map((e) => ({ id: e.id as string, namn: fullName(e) }))
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv"))
    : [];

  return {
    order,
    kapad: urval.kapad,
    samtal: allaSamtal,
    nyckeltal: {
      manad: manad.slice(0, 7),
      antal: nettoAntal(manadens, manad),
      provision: grundprovision(manadens, manad),
      varde: varde.netto,
      utanVarde: varde.utanVarde,
      ko,
      loperUt: loperUt.length,
      utgangna: loperUt.filter((o) => dagarTill(o.ends_on, idag) < 0).length,
    },
    paket: paket.map((p) => ({ id: p.id, l: p.label, pris: p.list_price })),
    matris,
    satser: satser.map(({ package_id, term_months, amount, valid_from, valid_to }) => ({ package_id, term_months, amount, valid_from, valid_to })),
    chefssatser: chefssatser.map(({ employee_id, override_percent, own_sale_percent, valid_from, valid_to }) => ({ employee_id, override_percent, own_sale_percent, valid_from, valid_to })),
    utkopssatser: utkopssatser.map(({ percent, valid_from, valid_to }) => ({ percent, valid_from, valid_to })),
    finanssatser: finanssatser.map(({ percent_per_year, valid_from, valid_to }) => ({ percent_per_year, valid_from, valid_to })),
    idag: {
      egen: chefIdag?.own_sale_percent ?? null,
      overtack: chefIdag?.override_percent ?? null,
      utkop: gallandeUtkopssats(utkopssatser, idag)?.percent ?? null,
      finans: gallandeFinanssats(finanssatser, idag)?.percent_per_year ?? null,
      chefId: chefIdag?.employee_id ?? null,
    },
    stangda: perioder.map((p) => String(p.period_month).slice(0, 7)),
    hanterare,
    bokforare,
    saljare,
    kandidater: (egnaSamtal ?? [])
      .filter((c) => c.started_at)
      .map((c) => ({
        id: c.id as string,
        nar: svenskTid(c.started_at as string),
        sek: Number(c.talk_seconds ?? 0),
        nr: (c.counterpart_raw as string | null) ?? (c.counterpart_e164 as string | null) ?? "",
        ljud: c.recording_state === "hamtad",
      })),
    varselDagar: AVTALSSLUT_VARSEL_DAGAR,
    ortak: ORDERTAK,
    fasta: Object.fromEntries(
      ((fastRader ?? []) as { org_number: string; inkio_comment_id: string; body: string; author_name: string | null; pinned_by: string | null; pinned_at: string }[]).map((f) => [
        f.org_number,
        { kommentar: f.inkio_comment_id, text: f.body, vem: f.author_name, av: namn(f.pinned_by), nar: f.pinned_at },
      ]),
    ),
    sett: ((settRad as { seen_at: string } | null)?.seen_at as string | undefined) ?? null,
    sidor: Object.fromEntries(
      ((sidRader ?? []) as (Parameters<typeof formaSida>[0] & { org_number: string })[]).map((r) => [r.org_number, formaSida(r, idag)]),
    ),
    skriv: SKRIVLAGE.order,
  };
}
