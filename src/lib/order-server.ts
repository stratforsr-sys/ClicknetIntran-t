import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { AVTALSSLUT_VARSEL_DAGAR, type Order, type Paket, type Sats, type Tjanst } from "@/lib/order";
import type { Chefssats } from "@/lib/chefsprovision";
import type { Utkopssats } from "@/lib/utkop";
import type { Chefspost } from "@/lib/provision-motor";
import {
  ORDERTAK,
  sammaKund,
  statusarnaI,
  type Orderfilter,
} from "@/lib/ordervy";

/**
 * Hamtningarna for kundordern. Laser med ANVANDARENS EGEN TOKEN — RLS i 0034
 * avgor vad som syns: saljaren ser sina egna order, saljchef, VD och ekonomi
 * ser alla.
 *
 * Skriv inget rollfilter har. Samma regel som provisionen, sokningen och
 * adoptionen foljer: ett filter i koden som upprepar policyn hinner glida isar
 * fran den, och da ar det koden man tror pa medan databasen sager nagot annat.
 */

export type Orderrad = Order & {
  company_name: string;
  org_number: string;
  contact_name: string;
  contact_phone: string;
  /** 0060. Nullbar: order fran fore 2026-09-15 har ingen adress och far ingen i efterhand. */
  contact_email: string | null;
  commission_source: string | null;
  order_value_source: string | null;
  note: string | null;
  /**
   * Vem som la upp ordern. Avgor tillsammans med rollen VEM SOM FAR RATTA den:
   * chefskretsen rattar allt, upphovspersonen bara faktauppgifterna. Se
   * `redigeraOrder` i `order/actions.ts`.
   *
   * Nullbar for order fran fore kolumnen fanns. En order utan upphovsperson far
   * darfor bara rattas av chefskretsen — vilket ar ratt vag runt: en tom kolumn
   * ska inte oppna ett formular for nagon.
   */
  created_by: string | null;
  created_at: string;
  approved_at: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
};

const FALT =
  "id, company_name, org_number, contact_name, contact_phone, contact_email, package_id," +
  " term_months, salesperson_id, signed_on, starts_on, ends_on, period_month, status, is_addon," +
  " monthly_amount, commission_amount, commission_source, order_value, order_value_source," +
  " buyout_amount, note, created_by, created_at, approved_at, cancelled_on, cancel_reason," +
  " cancel_period_month, renewal_outcome, renewal_at, renewal_by, renewal_reason," +
  " renewal_order_id";

/**
 * numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
 * summeringen en strangkonkatenering, och 1500 + 2500 blir "15002500". Samma
 * falla som `provision-server.ts` redan gatt i.
 *
 * ORDERVARDET AR EN NUMERIC TILL, och den ar den dyraste att glomma: talen ar
 * femsiffriga, sa "11940" + "23880" blir "1194023880" — ett ordervarde pa en
 * miljard som ser ut som ett riktigt tal i en vy som inte forvantar sig
 * strangar. `null` far forbli null; se `ordervarde()` i `order.ts` for varfor de
 * raknas i stallet for att bli nollor.
 */
function tolka(rader: unknown[]): Orderrad[] {
  return (rader as Record<string, unknown>[]).map((r) => ({
    ...r,
    commission_amount: r.commission_amount === null ? null : Number(r.commission_amount),
    order_value: r.order_value === null || r.order_value === undefined ? null : Number(r.order_value),
    // UTKOPET AR EN NUMERIC TILL (0060), och den ar lika lett att glomma som de
    // tva ovan. En strang dar gor `order_value - buyout_amount` till NaN, och
    // NaN i en provisionsvy ser ut som ett fel i rakningen i stallet for ett
    // fel i tolkningen. `null` far forbli null: ingen affar utan utkop ska
    // bara en nolla, se `buyout_amount` i `order.ts`.
    buyout_amount:
      r.buyout_amount === null || r.buyout_amount === undefined ? null : Number(r.buyout_amount),
    // MANADSBELOPPET AR EN NUMERIC TILL (0068). Samma falla, och den bits pa ett
    // eget satt: `monthly_amount * term_months` med en strang i forsta ledet ger
    // NaN, alltsa ett ordervarde som ser ut som ett rakenfel.
    monthly_amount:
      r.monthly_amount === null || r.monthly_amount === undefined
        ? null
        : Number(r.monthly_amount),
    // DATUMEN KAPAS TILL TIO TECKEN. PostgREST svarar med `2026-09-24` for en
    // date-kolumn, men den genererade `ends_on` har visat sig komma tillbaka med
    // tidsdel i vissa svar — och `dagarTill()` parsar `${datum}T12:00:00Z`, som
    // blir ett ogiltigt datum om datumet redan bar ett T.
    starts_on: r.starts_on === null || r.starts_on === undefined ? null : String(r.starts_on).slice(0, 10),
    ends_on: r.ends_on === null || r.ends_on === undefined ? null : String(r.ends_on).slice(0, 10),
  })) as unknown as Orderrad[];
}

/**
 * Villkoret for "ror den har manaden eller senare".
 *
 * ===========================================================================
 * EN MAKULERING HAR SIN EGEN MANAD, OCH `period_month` HITTAR DEN INTE.
 *
 * Rattat 2026-09-07. Fram till dess filtrerade bada hamtningarna nedan pa bara
 * `period_month >= x`, och det tappar en hel sorts rad: en order signerad i
 * mars som makuleras i september har `period_month = 2026-03-01` och
 * `cancel_period_month = 2026-09-01`.
 *
 * Foljden var att septembers avdrag inte kom med i vyn. `stangning.ts` hamtade
 * REDAN pa bada kolumnerna, sa bokforingen var korrekt hela tiden — det var
 * bara den siffra chefen laste FORE att hon tryckte Faststall som var for hog.
 * Precis den avvikelse mellan live och bokfort som kommentaren i `page.tsx`
 * sager aldrig far uppsta.
 *
 * Villkoret star som en funktion och inte som en strang pa tva stallen, sa att
 * de tva hamtningarna inte kan glida isar.
 * ===========================================================================
 */
function ror(franOchMed: string): string {
  return `period_month.gte.${franOchMed},cancel_period_month.gte.${franOchMed}`;
}

/** Order som ror en manad eller senare — signerade dar eller makulerade dar. */
export async function hamtaOrder(franOchMed: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .or(ror(franOchMed))
    .order("signed_on", { ascending: false })
    .order("created_at", { ascending: false });

  return tolka(data ?? []);
}

/** En enskild persons order. Anvands av progressvyn i steg 4. */
export async function hamtaOrderFor(employeeId: string, franOchMed: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .eq("salesperson_id", employeeId)
    .or(ror(franOchMed))
    .order("signed_on", { ascending: false });

  return tolka(data ?? []);
}

/*
 * `hamtaKo` TOGS BORT 2026-09-25, och det ar varför-raden som ar vard att spara.
 *
 * Funktionen hamtade hela kon som orderrader, och ordersidan ritade dem i ett
 * eget kort. Nu ar kon ett LAGE i filterraden — `status=vantar` gar genom
 * `hamtaOrderUrval` som alla andra lagen — och det enda sidan behover veta utan
 * att nagon valt laget ar hur manga. Det svarar `raknaKo` pa med `head: true`,
 * alltsa utan att en enda rad lamnar databasen.
 *
 * En grep over hela tradet visade att ordersidan var ENDA anroparen. Kvar hade
 * den darfor blivit en andra vag till samma svar, och tva vagar till samma svar
 * hinner glida isar — det ar samma skal som star over `ror()` harovan.
 */

export async function hamtaPaket(): Promise<Paket[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_package")
    .select("id, label, list_price, sort, active")
    .eq("active", true)
    .order("sort");

  return (data ?? []).map((p) => ({ ...p, list_price: Number(p.list_price) })) as Paket[];
}

/**
 * Satserna. HELA historiken hamtas, inte bara de oppna raderna.
 *
 * Skalet: uppslaget sker pa orderns SIGNERINGSDATUM, inte pa dagens datum. En
 * order som lades in i efterhand ska fa den sats som gallde da, och da maste
 * de stangda raderna finnas med i materialet motorn far.
 */
export async function hamtaSatser(): Promise<Sats[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_rate")
    .select("id, package_id, term_months, amount, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((s) => ({ ...s, amount: Number(s.amount) })) as Sats[];
}

/**
 * Saljchefens satser. HELA historiken, av samma skal som `hamtaSatser`.
 *
 * Uppslaget sker pa orderns SIGNERINGSDATUM — se `gallandeChefssats` i
 * `chefsprovision.ts` for varfor det skiljer sig fran volymtrappan — och da
 * maste de stangda raderna finnas med i materialet.
 *
 * LASES MED ANVANDARENS EGEN TOKEN. `manager_commission_rate_read` i 0050
 * slapper bara in den krets som ser provision, sa en saljare far en TOM lista.
 * Det ar ratt svar: satserna ar villkoren for nagon annans ersattning, och
 * saljarens vy blir inte en siffra fattigare av att de ar stangda. Skriv inget
 * rollfilter har — samma regel som resten av filen foljer.
 */
export async function hamtaChefssatser(): Promise<Chefssats[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("manager_commission_rate")
    .select("id, employee_id, override_percent, own_sale_percent, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((s) => ({
    ...s,
    override_percent: Number(s.override_percent),
    own_sale_percent: Number(s.own_sale_percent),
  })) as Chefssats[];
}

/**
 * Utkopssatserna. HELA historiken, av samma skal som `hamtaSatser`.
 *
 * Uppslaget sker pa orderns SIGNERINGSDATUM — se `gallandeUtkopssats` i
 * `utkop.ts` — och da maste de stangda raderna finnas med i materialet.
 *
 * LASBAR FOR ALLA INLOGGADE, till skillnad fran `hamtaChefssatser`.
 * `buyout_commission_rate_read` i 0060 slapper in hela kretsen, och det ar
 * avsiktligt: det ar SALJARENS EGEN sats. Den som lagger en order med utkop ska
 * se vad affaren ger innan hen trycker, precis som paketmatrisen star oppen.
 */
export async function hamtaUtkopssatser(): Promise<Utkopssats[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("buyout_commission_rate")
    .select("id, percent, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((s) => ({ ...s, percent: Number(s.percent) })) as Utkopssats[];
}

/**
 * Overtacken som ror en manad eller senare.
 *
 * ===========================================================================
 * MANADEN KOMMER UR ORDERN, SA FRAGAN MASTE GA GENOM ORDERN.
 *
 * `order_manager_commission` har med flit ingen egen manadskolumn — overtacket
 * foljer sin order och bokfors i dess `period_month`, dras tillbaka i dess
 * `cancel_period_month`. Det gor uppslaget till en join, och den maste bara
 * SAMMA villkor som `ror()` ovan: bade signeringsmanaden och
 * makuleringsmanaden.
 *
 * Missas den andra halvan uteblir avdraget for en order som makuleras i en
 * senare manad — exakt det fel som rattades i `hamtaOrder` 2026-09-08, och det
 * gar at det hall dar ingen saknar sina pengar.
 * ===========================================================================
 *
 * PostgREST filtrerar pa den inbaddade tabellen med `sales_order.<kolumn>`, och
 * `!inner` kravs for att villkoret ska GALLRA rader i stallet for att bara nolla
 * den inbaddade delen. Utan det kommer varje overtack tillbaka med `sales_order:
 * null` och faller sedan bort tyst i tolkningen nedan.
 */
export async function hamtaChefsposter(franOchMed: string): Promise<Chefspost[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("order_manager_commission")
    .select(
      "order_id, manager_id, amount, percent," +
        " sales_order!inner(period_month, cancel_period_month, signed_on, company_name, status)",
    )
    .or(ror(franOchMed), { referencedTable: "sales_order" });

  // ===========================================================================
  // CASTEN AR INTE KOSMETISK. Supabase harleder radens typ ur select-STRANGEN,
  // och en inbaddad tabell med `!inner` far den inte att ga ihop — resultatet
  // blir `GenericStringError`, alltsa en typ utan nagon av kolumnerna. Bygget
  // faller da pa `r.order_id`, inte pa nagot som ar fel i fragan.
  //
  // Samma cast som `hamtaAllaOrder` i `stangning.ts` redan gor, och av samma
  // skal. Foljden ar att kolumnnamnen harunder inte langre kontrolleras av
  // kompilatorn — de maste stamma med select-strangen ovan for hand.
  // ===========================================================================
  const rader = (data ?? []) as unknown as Record<string, unknown>[];

  return rader.flatMap((r) => {
    const o = r.sales_order as Record<string, unknown> | null;
    if (!o) return [];

    return [
      {
        order_id: String(r.order_id),
        manager_id: String(r.manager_id),
        amount: Number(r.amount),
        percent: Number(r.percent),
        period_month: String(o.period_month),
        cancel_period_month: o.cancel_period_month === null ? null : String(o.cancel_period_month),
        signed_on: String(o.signed_on),
        company_name: String(o.company_name),
        makulerad: o.status === "makulerad",
      } satisfies Chefspost,
    ];
  });
}


/**
 * Bilagorna per order (E13 steg 9, migration 0039).
 *
 * Lases med ANVANDARENS EGEN TOKEN. `file_object_read` i 0039 later bilagan
 * arva ORDERNS behorighet — grenen ar en `exists` mot `sales_order` och inget
 * eget rollvillkor. Skriv inget filter har: det hade varit ett andra svar pa
 * samma fraga.
 *
 * `removed_at is null`: en fil vars innehall tagits bort ur bucketen har kvar
 * sin rad och sin oppningslogg (0022), men den ska inte erbjudas att oppnas.
 */
export async function hamtaOrderbilagor(
  orderIds: string[],
): Promise<Map<string, { id: string; filename: string | null; uploaded_at: string }[]>> {
  const ut = new Map<string, { id: string; filename: string | null; uploaded_at: string }[]>();
  if (orderIds.length === 0) return ut;

  const rls = await supabaseServer();
  const { data } = await rls
    .from("file_object")
    .select("id, filename, uploaded_at, sales_order_id")
    .eq("purpose", "sales_order")
    .is("removed_at", null)
    .in("sales_order_id", orderIds)
    .order("uploaded_at", { ascending: false });

  for (const f of data ?? []) {
    const nyckel = String(f.sales_order_id);
    ut.set(nyckel, [
      ...(ut.get(nyckel) ?? []),
      {
        id: String(f.id),
        filename: (f.filename as string | null) ?? null,
        uploaded_at: String(f.uploaded_at),
      },
    ]);
  }

  return ut;
}

/**
 * Tjansteraderna for en bunt order, i EN fraga.
 *
 * Samma form som `hamtaOrderbilagor` och av samma skal: en fraga per orderkort
 * hade blivit tjugo fragor pa en sida som redan gor sex. RLS i 0068 avgor vad
 * som syns — policyn fragar `sales_order`, sa en tjanst kan aldrig synas pa en
 * order som inte gor det.
 */
export async function hamtaTjanster(orderIds: string[]): Promise<Map<string, Tjansterad[]>> {
  const ut = new Map<string, Tjansterad[]>();
  if (orderIds.length === 0) return ut;

  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order_service")
    .select(
      "id, order_id, name, billing, amount, follows_order, term_months, starts_on, ends_on," +
        " renewal_outcome, renewal_reason, sort",
    )
    .in("order_id", orderIds)
    .order("sort");

  // ===========================================================================
  // CASTEN AR INTE KOSMETISK, och den fallde bygget 2026-09-24.
  //
  // Supabase harleder radens typ ur select-STRANGEN. En strang over en viss
  // langd far den inte att ga ihop, och resultatet blir `GenericStringError` —
  // en typ UTAN nagon av kolumnerna. Bygget faller da pa `r.order_id`, inte pa
  // nagot som ar fel i fragan.
  //
  // Samma falla som `hamtaChefsposter` gick i 2026-09-09, `redigeraOrder` strax
  // darefter och `hamtaRad` i actions.ts. Foljden ar att faltlistan harunder
  // maste stamma med strangen ovan FOR HAND — de kontrolleras inte mot varandra
  // av nagot.
  // ===========================================================================
  const rader = (data ?? []) as unknown as {
    id: string;
    order_id: string;
    name: string;
    billing: string;
    amount: number | string;
    follows_order: boolean;
    term_months: number | string | null;
    starts_on: string | null;
    ends_on: string | null;
    renewal_outcome: string | null;
    renewal_reason: string | null;
    sort: number;
  }[];

  for (const r of rader) {
    const nyckel = String(r.order_id);
    ut.set(nyckel, [
      ...(ut.get(nyckel) ?? []),
      {
        id: String(r.id),
        name: String(r.name),
        billing: r.billing as Tjansterad["billing"],
        // numeric ur PostgREST ar en STRANG. Se `tolka()` ovan.
        amount: Number(r.amount),
        follows_order: Boolean(r.follows_order),
        term_months: r.term_months === null ? null : Number(r.term_months),
        starts_on: r.starts_on === null ? null : String(r.starts_on).slice(0, 10),
        ends_on: r.ends_on === null ? null : String(r.ends_on).slice(0, 10),
        renewal_outcome: (r.renewal_outcome as Tjansterad["renewal_outcome"]) ?? null,
        renewal_reason: (r.renewal_reason as string | null) ?? null,
      },
    ]);
  }

  return ut;
}

/** En tjansterad sa som vyn behover kanna den. Bar `Tjanst` plus radens eget. */
export type Tjansterad = Tjanst & {
  id: string;
  ends_on: string | null;
  renewal_outcome: "forlangd" | "avslutad" | null;
  renewal_reason: string | null;
};

/**
 * Avtalen som narmar sig sitt slut och annu ingen tagit stallning till.
 *
 * ===========================================================================
 * FRAGAN GAR UTANFOR TOLVMANADERSFONSTRET, och det ar hela skalet till att den
 * ar en egen hamtning.
 *
 * `hamtaOrder` visar tolv manader bakat. Ett trearsavtal tecknat 2024 loeper ut
 * 2027 — och syns alltsa inte i den listan alls, trots att det ar precis det
 * avtal nagon borde ringa om. Bevakningen fragar darfor pa SLUTDATUMET och inte
 * pa signeringsmanaden.
 *
 * Villkoren speglar `bevakas()` i `lib/order.ts`, och det ar med flit att de
 * star pa tva stallen: databasen far svara pa vilka RADER som ar aktuella —
 * indexet `sales_order_avtalsslut_idx` ar byggt for exakt det predikatet — och
 * den rena funktionen far svara pa vad som galler EN rad, dar den gar att prova
 * utan databas. Provet i tests/order.mjs bevakar den andra halvan.
 * ===========================================================================
 *
 * RLS AVGOR VEM SOM SER VAD. Saljaren far sina egna, kretsen alla — precis som
 * pa ordersidan i ovrigt. Inget rollfilter skrivs har.
 */
export async function hamtaAvtalsslut(idag: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();

  // Yttre gransen: slutdatum fram till och med nittio dagar bort. Ordern med ett
  // slutdatum som REDAN PASSERAT kommer med av sig sjalv — det finns ingen nedre
  // grans, och det ar avsiktligt. Se `bevakas()` for varfor ett utgangret avtal
  // star kvar i listan i stallet for att slockna.
  const senast = new Date(Date.parse(`${idag}T12:00:00Z`) + AVTALSSLUT_VARSEL_DAGAR * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .in("status", ["signerad", "betald"])
    .is("renewal_outcome", null)
    .lte("ends_on", senast)
    .order("ends_on", { ascending: true });

  return tolka(data ?? []);
}

/**
 * Tjansterna med EGET slutdatum som narmar sig, och orderns bolagsnamn.
 *
 * En tjanst som foljer huvudavtalet star inte har — den bevakas genom ordern,
 * och tva poster for samma slutdatum hade betytt att bortklicket pa den ena
 * lamnade den andra kvar. `ends_on` ar null for just de raderna (0068), sa
 * villkoret `not.is.null` ar hela filtret som behovs.
 */
export async function hamtaTjanstslut(
  idag: string,
): Promise<
  {
    id: string;
    order_id: string;
    name: string;
    amount: number;
    ends_on: string;
    company_name: string;
    salesperson_id: string;
  }[]
> {
  const rls = await supabaseServer();

  const senast = new Date(Date.parse(`${idag}T12:00:00Z`) + AVTALSSLUT_VARSEL_DAGAR * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data } = await rls
    .from("sales_order_service")
    .select("id, order_id, name, amount, ends_on, sales_order!inner(company_name, salesperson_id, status)")
    .not("ends_on", "is", null)
    .is("renewal_outcome", null)
    .lte("ends_on", senast)
    .order("ends_on", { ascending: true });

  // Samma cast och samma skal som i `hamtaTjanster` ovan — den har strangen bar
  // dessutom en inbaddad tabell, vilket gor den annu langre.
  const rader = (data ?? []) as unknown as {
    id: string;
    order_id: string;
    name: string;
    amount: number | string;
    ends_on: string;
    sales_order: { company_name: string; salesperson_id: string; status: string };
  }[];

  return rader
    .map((r) => {
      // `!inner` ger ett OBJEKT och inte en lista, men typen Supabase harleder
      // sager lista. Den ar redan skriven ratt i casten ovan.
      const order = r.sales_order;
      return {
        id: String(r.id),
        order_id: String(r.order_id),
        name: String(r.name),
        amount: Number(r.amount),
        ends_on: String(r.ends_on).slice(0, 10),
        company_name: order.company_name,
        salesperson_id: order.salesperson_id,
        status: order.status,
      };
    })
    // EN MAKULERAD ORDERS TJANSTER BEVAKAS INTE. Filtret star har och inte i
    // fragan eftersom PostgREST inte tar ett `in`-villkor pa en inbaddad tabell
    // tillsammans med `!inner` utan att tappa raderna helt.
    .filter((r) => r.status === "signerad" || r.status === "betald")
    .map(({ status: _status, ...rad }) => rad);
}

// -----------------------------------------------------------------------------
// Ordervyns egna hamtningar (2026-09-25)
// -----------------------------------------------------------------------------

/**
 * Listan, filtrerad i DATABASEN.
 *
 * =============================================================================
 * VARFOR FILTRET GAR TILL SERVERN OCH INTE TILL WEBBLASAREN.
 *
 * Fram till nu hamtade sidan tolv manader bakat och ritade allt. "Alla order"
 * fanns alltsa inte som lage — ett trearsavtal tecknat 2024 syntes inte, och
 * filtrerade man i webblasaren hade "alla" betytt "alla av de tolv manaderna",
 * vilket ar ett ord som lovar mer an det haller.
 *
 * Nu avgor `tid` hur langt bak fragan gar. `alla` satter ingen nedre grans alls,
 * och da behovs ett TAK i stallet: `ORDERTAK + 1` rader hamtas, och den extra
 * raden ar hela mekanismen — finns den vet vi att det fanns mer, utan att en
 * andra rakningsfraga behovs. Vyn sager det med ord i stallet for att tysta
 * klippa listan.
 * =============================================================================
 *
 * INGET ROLLFILTER. RLS i 0034 avgor vad som syns, precis som i resten av filen.
 * `vem` ar ett ANVANDARVAL i en lista — inte en behorighetskontroll — och den
 * som valjer en kollega hen inte far se far noll rader av databasen.
 */
export async function hamtaOrderUrval(
  f: Orderfilter,
): Promise<{ order: Orderrad[]; kapad: boolean }> {
  const rls = await supabaseServer();

  let q = rls.from("sales_order").select(FALT);

  if (f.vem !== "alla") q = q.eq("salesperson_id", f.vem);

  // MANADEN TAR BADE SIGNERINGS- OCH MAKULERINGSMANADEN, samma villkor som
  // `ror()` ovan och av samma skal: en order fran mars som makulerats i
  // september HOR TILL september lika mycket som en order som signerades dar.
  // Utan andra halvan visade septemberfiltret en summa som inte gick att stamma
  // av mot nyckeltalen hogst upp pa sidan.
  if (f.tid.slag === "manad") {
    q = q.or(`period_month.eq.${f.tid.manad},cancel_period_month.eq.${f.tid.manad}`);
  }

  // EN DAG ar signeringsdagen. Makuleringsdagen har ingen plats har: fragan
  // "vad skrevs den 24:e" ar en annan fraga an "vad hande den 24:e", och det ar
  // den forsta man staller i en orderlista.
  if (f.tid.slag === "dag") q = q.eq("signed_on", f.tid.datum);

  const statusar = statusarnaI(f.status);
  if (statusar.length > 0) q = q.in("status", statusar);

  // ===========================================================================
  // SOKNINGEN GAR MOT BOLAGSNAMNET OCH INGET ANNAT.
  //
  // Tva skal, och bada ar avsiktliga val snarare an forenklingar:
  //
  //   1. ORGANISATIONSNUMRET FAR INTE SOKAS PA. K27-undantaget later kolumnen
  //      bara ett personnummer for en enskild firma, och DECISIONS.md sager att
  //      numret aldrig far hamna i en sokning. En traff pa tio siffror hade
  //      betytt att personnummer gick att fiska fram ur listan.
  //
  //   2. `.ilike()` OCH INTE `.or()`. Ett andra `or=`-villkor pa samma fraga ar
  //      inte sakert dokumenterat i PostgREST, och en fraga vars form beror pa
  //      vilka filter som rakar vara satta ar en fraga ingen kan granska.
  //      Manadsvillkoret ovan ar redan ett `or`, och det far vara det enda.
  //
  // Texten ar dessutom rensad av `rensaSok()` fore den kommer hit — `%` och `_`
  // ar jokertecken i `ilike`, och en sokning pa `%` hade traffat allt.
  // ===========================================================================
  if (f.sok) q = q.ilike("company_name", `%${f.sok}%`);

  const { data } = await q
    .order("signed_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ORDERTAK + 1);

  const rader = tolka(data ?? []);
  return { order: rader.slice(0, ORDERTAK), kapad: rader.length > ORDERTAK };
}

/**
 * Antalet order som vantar pa godkannande.
 *
 * EN RAKNING OCH INTE EN HAMTNING. Kon ar ett lage i filterraden nu, inte ett
 * eget kort — det enda sidan behover veta utan att nagon valt laget ar HUR
 * MANGA, sa att chipet kan bara en siffra. `head: true` later PostgREST svara
 * med bara antalet.
 *
 * RLS ger noll at den som inte far se andras order, och noll ar ratt svar da:
 * chipet ritas inte, och saljaren far en filterrad utan ett lage hen inte kan
 * anvanda.
 */
export async function raknaKo(): Promise<number> {
  const rls = await supabaseServer();
  const { count } = await rls
    .from("sales_order")
    .select("id", { count: "exact", head: true })
    .eq("status", "inskickad");

  return count ?? 0;
}

/**
 * Hur manga tillaggstjanster varje order har.
 *
 * SKILD FRAN `hamtaTjanster` MED FLIT. Orderkortet i listan visar en RAKNARE —
 * "2 tjänster" — och for den behovs bara `order_id`. Att hamta namn, belopp,
 * bindningstider och fornyelseutfall for tvahundra order nar vyn ska rita en
 * siffra ar precis den sortens fraga som gor en lista trog utan att nagon ser
 * varfor. Hela raderna hamtas nar kundkortet oppnas, for de fa order som star
 * dar.
 */
export async function hamtaTjansteantal(orderIds: string[]): Promise<Map<string, number>> {
  const ut = new Map<string, number>();
  if (orderIds.length === 0) return ut;

  const rls = await supabaseServer();
  const { data } = await rls.from("sales_order_service").select("order_id").in("order_id", orderIds);

  for (const r of data ?? []) {
    const nyckel = String((r as { order_id: unknown }).order_id);
    ut.set(nyckel, (ut.get(nyckel) ?? 0) + 1);
  }

  return ut;
}

/**
 * Taket pa en kunds orderlista.
 *
 * Femtio ar inte en prestandagrans — det ar ett tak pa en fraga som annars ar
 * obegransad. En kund med fler an femtio order finns inte, och skulle hen finnas
 * ar det inte kundkortet som ska upptacka det.
 */
const KUNDTAK = 50;

/**
 * Kunden bakom en order: ordern man klickade pa, och allt annat samma kund har.
 *
 * =============================================================================
 * KORTET OPPNAS MED EN ORDERS ID, ALDRIG MED ETT ORGANISATIONSNUMMER.
 *
 * Det ar det enskilt viktigaste i den har funktionen. Kundkortet ligger i
 * adressen som `?kund=<orderid>`, och adressen hamnar i webblasarhistoriken, i
 * Vercels loggar och i en Referer-rubrik. K27-undantaget later `org_number`
 * bara ett PERSONNUMMER for en enskild firma — och ett personnummer far inte
 * ligga pa nagot av de stallena. Ett order-id ar ett uuid: det sager ingenting
 * om nagon, och RLS avgor om den som bar det far se raden.
 *
 * Uppslaget gar darfor i tva steg. Forst ordern, med anvandarens egen token —
 * far hen inte se den finns den inte, och kortet oppnas inte. Sedan syskonen.
 * =============================================================================
 *
 * =============================================================================
 * SYSKONEN HAMTAS I TVA FRAGOR, EN PA NUMMER OCH EN PA NAMN.
 *
 * Skalet ar att ingen av de tva ensam hittar kunden:
 *
 *   - NUMMERFRAGAN missar samma bolag inskrivet olika. `556677-8899` och
 *     `5566778899` ar samma kund for en manniska och tva strangar for en
 *     likhetsjamforelse.
 *   - NAMNFRAGAN missar ett bolag som bytt namn mitt i en avtalsperiod, och
 *     traffar for mycket nar tva olika bolag heter likadant.
 *
 * Bada fragas, svaren slas ihop, och `sammaKund()` — som normaliserar bort
 * bindestreck och versaler — far avgora vad som verkligen hor till kunden. Den
 * funktionen ar ren och provas i `tests/ordervy.mjs`; det ar dar regeln bor.
 *
 * `.eq()` OCH INTE ETT `or=`-UTTRYCK, och det ar inte en stilfraga: ett
 * bolagsnamn kan innehalla komma och parentes, och de tecknen ar SYNTAX i ett
 * `or=`. "Bygg & Co, AB" hade da inte blivit en sokning pa ett namn utan tva
 * villkor. `.eq()` gar genom URLSearchParams och kodas.
 * =============================================================================
 */
export async function hamtaKundensOrder(
  orderId: string,
): Promise<{ ankare: Orderrad; order: Orderrad[] } | null> {
  // Ett id som inte ar ett uuid gar aldrig till databasen. PostgREST svarar med
  // 400 pa en trasig uuid-jamforelse, och ett 400 i en serverkomponent ar ett
  // kastat undantag — alltsa en femhundrasida for nagon som skrivit fel i
  // adressfaltet. Tomt svar ar ratt: kortet ritas inte.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;

  const rls = await supabaseServer();

  const { data: rad } = await rls.from("sales_order").select(FALT).eq("id", orderId).maybeSingle();
  if (!rad) return null;

  const ankare = tolka([rad])[0];

  // FRAGORNA LAGGS I EN LISTA i stallet for i en ternar i ett `Promise.all`.
  //
  // Skalet ar typerna: en gren som ar en PostgREST-byggare och en gren som ar
  // `Promise.resolve({ data: [] })` ger en UNION av tva svarsformer, och da
  // maste varje atkomst harunder ga igenom bada. En lista dar alla element har
  // samma typ slipper hela den frågan — och lasningen blir dessutom rakare: det
  // ar en fraga, plus en till OM det finns ett nummer att fraga pa.
  const fragor = [
    rls
      .from("sales_order")
      .select(FALT)
      .eq("company_name", ankare.company_name)
      .order("signed_on", { ascending: false })
      .limit(KUNDTAK),
  ];

  if (ankare.org_number) {
    fragor.push(
      rls
        .from("sales_order")
        .select(FALT)
        .eq("org_number", ankare.org_number)
        .order("signed_on", { ascending: false })
        .limit(KUNDTAK),
    );
  }

  const svar = await Promise.all(fragor);

  const alla = new Map<string, Orderrad>([[ankare.id, ankare]]);
  for (const r of tolka(svar.flatMap((s) => s.data ?? []))) {
    // `sammaKund` far sista ordet. Namnfragan kan ha dragit in ett annat bolag
    // med samma namn men eget organisationsnummer, och da hor det inte hit.
    if (sammaKund(ankare, r)) alla.set(r.id, r);
  }

  return { ankare, order: [...alla.values()] };
}
