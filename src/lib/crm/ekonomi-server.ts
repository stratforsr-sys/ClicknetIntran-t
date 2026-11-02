import "server-only";

import { Inkiofel, inkioLas, inkioUrl } from "./inkio";
import {
  ekonomiMarke,
  orderekonomi,
  slutbetald,
  utbetalningsId,
  type InkioAvtal,
  type InkioFaktura,
  type InkioFil,
  type InkioHantering,
  type InkioKort,
  type InkioOrderhuvud,
  type InkioSamtal,
  type InkioUtbetalning,
  type Orderekonomi,
} from "./ekonomi";

/**
 * Orderns ekonomi ur Inkio, för kundkortet (`/nav2/inkio?vad=ekonomi`).
 * BARA LÄSNING, med Inkios egna anrop — se `ekonomi.ts`.
 *
 * Ordern läses först (den säger vilken orderhantering, vilket produktionskort
 * och vilken kund det gäller), resten på en gång. En del som inte svarar gör
 * inte kortet tomt: den står som saknad i `saknas`, och resten visas.
 */
export async function hamtaOrderekonomi(inkioOrderId: string): Promise<(Orderekonomi & { saknas: string[]; marke: ReturnType<typeof ekonomiMarke> }) | null> {
  let order: InkioOrderhuvud;
  try {
    order = await inkioLas<InkioOrderhuvud>(`/api/records/sales-order/${encodeURIComponent(inkioOrderId)}`);
  } catch (e) {
    if (e instanceof Inkiofel && e.status === 404) return null;
    throw e;
  }

  const saknas: string[] = [];
  const del = async <T>(namn: string, f: () => Promise<T>, tom: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      // Ett produktionskort på en tavla tjänstekontot inte är med på ger 403/404: det är ett svar, inte ett fel.
      if (namn === "leverans" && e instanceof Inkiofel && (e.status === 403 || e.status === 404)) return tom;
      saknas.push(namn);
      return tom;
    }
  };

  const [hantering, avtal, kort, fakturor, filer, samtal, fortnox] = await Promise.all([
    order.handling?.id
      ? del<InkioHantering | null>("hantering", () => inkioLas<InkioHantering>("/api/order-handling/get-item", { id: order.handling!.id }), null)
      : Promise.resolve(null),
    del(
      "avtal",
      async () => (await inkioLas<{ contracts?: InkioAvtal[] }>("/api/contracts/get-contracts", { source_sales_order: inkioOrderId, page_size: 50 })).contracts ?? [],
      [] as InkioAvtal[],
    ),
    order.production_task_id
      ? del<InkioKort | null>("leverans", () => inkioLas<InkioKort>("/api/projects/get-task", { id: order.production_task_id! }), null)
      : Promise.resolve(null),
    // Inkios fakturor speglar Fortnox. Listan filtreras på kunden; ordern bär sina egna (`sales_order`).
    order.customer
      ? del(
          "fakturor",
          async () =>
            ((await inkioLas<{ invoices?: InkioFaktura[] }>("/api/invoices/get-invoices", { customer_id: order.customer!, page_size: 100 })).invoices ?? []).filter(
              (f) => f.sales_order === inkioOrderId,
            ),
          [] as InkioFaktura[],
        )
      : Promise.resolve([] as InkioFaktura[]),
    del("filer", async () => (await inkioLas<InkioFil[] | null>("/api/filehandler/get-files", { doctype: "Sales Order", record_id: inkioOrderId })) ?? [], [] as InkioFil[]),
    del("samtal", async () => (await inkioLas<{ calls?: InkioSamtal[] }>("/api/calls/get-calls", { sales_order: inkioOrderId })).calls ?? [], [] as InkioSamtal[]),
    del<{ connected?: boolean; last_successful_sync_at?: string | null } | null>("fortnox", () => inkioLas<{ connected?: boolean; last_successful_sync_at?: string | null }>("/api/fortnox/api/get-fortnox-status"), null),
  ]);

  const payout = utbetalningsId(hantering);
  const utbetalning = payout
    ? await del<InkioUtbetalning | null>("utbetalning", () => inkioLas<InkioUtbetalning>("/api/financing-payouts/get-payout", { id: payout }), null)
    : null;

  const e = orderekonomi({
    order,
    hantering,
    utbetalning,
    avtal,
    kort,
    kortStangt: !!order.production_task_id && !kort && !saknas.includes("leverans"),
    fakturor,
    filer: Array.isArray(filer) ? filer : [],
    samtal,
    fortnox,
    bas: inkioUrl(),
  });
  return { ...e, saknas, marke: ekonomiMarke(e) };
}

/**
 * Är ordern slutbetald i Inkio — alla fakturor i planen betalda? Bevakningen
 * frågar när en faktura blivit betald (`statusFranInkio`), innan Nav sätter
 * ordern som betald.
 */
export async function arSlutbetald(inkioOrderId: string): Promise<{ slutbetald: boolean; betalda: number; totalt: number } | null> {
  try {
    const o = await inkioLas<InkioOrderhuvud>(`/api/records/sales-order/${encodeURIComponent(inkioOrderId)}`);
    const p = o.invoicing?.progress;
    return { slutbetald: slutbetald(o.invoicing), betalda: p?.paid ?? 0, totalt: p?.total ?? o.invoicing?.invoices?.length ?? 0 };
  } catch (e) {
    if (e instanceof Inkiofel && e.status === 404) return null;
    throw e;
  }
}
