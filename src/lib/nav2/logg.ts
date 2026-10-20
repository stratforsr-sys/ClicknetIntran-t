import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { svenskKlocka, svensktDatum } from "@/lib/klocka";
import { heltNamn, nivaFor } from "./forma";
import { arUuid, formaLogg, LOGG_RADER, type NdLogg, type RaFil, type RaFilvisning, type RaHandelse, type Uppslag } from "./loggforma";

/**
 * Nav 2.0: händelseloggen (utkastets Händelselogg i moduler/rls.js, repots /logg).
 *
 * ===========================================================================
 * BARA CHEFEN, OCH RLS AVGÖR. `audit_log_read` släpper fram säljchef, VD och
 * admin, och `file_access_log_read` de filer den inloggade själv får öppna.
 * En säljare får ingenting (null), och vyn nås inte i utkastet.
 *
 * Loggen går inte att ändra: här finns ingen rutt och inget SKRIVLAGE.
 * Händelserna är repots `audit_log` och de öppnade filerna i
 * `file_access_log` (K36), som utkastets "Inspelning öppnad" visar.
 * Vad en rad får säga står i loggforma.ts.
 * ===========================================================================
 */

type RaPerson = { id: string; first_name: string | null; last_name: string | null };

export async function byggLogg(supabase: SupabaseClient, user: CurrentUser): Promise<NdLogg | null> {
  if (nivaFor(user.roles) === "salesperson") return null;

  const [{ data: hRader }, { data: fRader }, { data: pRader }] = await Promise.all([
    supabase.from("audit_log").select("id, actor_id, action, object_type, object_id, ts, meta").order("ts", { ascending: false }).limit(LOGG_RADER),
    supabase.from("file_access_log").select("id, file_id, actor_id, action, purpose, ts").neq("action", "upload").order("ts", { ascending: false }).limit(LOGG_RADER),
    supabase.from("employee").select("id, first_name, last_name"),
  ]);
  const handelser = (hRader ?? []) as unknown as RaHandelse[];
  const filer = (fRader ?? []) as unknown as RaFilvisning[];
  const namn = new Map(((pRader ?? []) as unknown as RaPerson[]).map((p) => [p.id, heltNamn(p.first_name ?? "", p.last_name ?? "")] as [string, string]));

  // Objekten slås upp per tabell, bara de som förekommer. object_id är text, så bara uuid går till frågan.
  const ids = (typer: string[]) => [...new Set(handelser.filter((h) => h.object_type && typer.includes(h.object_type) && arUuid(h.object_id)).map((h) => h.object_id as string))];
  const filIds = [...new Set(filer.map((f) => f.file_id).filter(arUuid))];
  const tom = Promise.resolve({ data: [] as unknown[] });
  const las = (tabell: string, kolumner: string, lista: string[]) => (lista.length ? supabase.from(tabell).select(kolumner).in("id", lista) : tom);

  const [lead, rutin, nyhet, kurs, team, avtal, fel, kandidat, lonperiod, fil] = await Promise.all([
    las("lead", "id, company, name", ids(["lead"])),
    las("document", "id, title", ids(["document"])),
    las("news_post", "id, title", ids(["news_post", "news"])),
    las("course", "id, title", ids(["course"])),
    las("team", "id, name", ids(["team"])),
    las("contract", "id, employee_id", ids(["contract"])),
    las("error_report", "id, public_title, occurrences", ids(["error_report"])),
    las("candidate", "id, role_title", ids(["candidate"])),
    las("payroll_period", "id, period_start, period_end", ids(["payroll_period"])),
    las("file_object", "id, purpose, subject_employee_id, sales_order_id", filIds),
  ]);
  const filer2 = (fil.data ?? []) as unknown as RaFil[];
  const orderIds = [...new Set([...ids(["sales_order"]), ...filer2.map((f) => f.sales_order_id).filter(arUuid)])];
  const order = await las("sales_order", "id, company_name", orderIds);

  const karta = <T,>(data: unknown, f: (r: T) => [string, string] | null) =>
    new Map(((data ?? []) as T[]).map(f).filter((x): x is [string, string] => x !== null));
  const u: Uppslag = {
    namn,
    order: karta<{ id: string; company_name: string | null }>(order.data, (r) => (r.company_name ? [r.id, r.company_name] : null)),
    lead: karta<{ id: string; company: string | null; name: string | null }>(lead.data, (r) => (r.company || r.name ? [r.id, (r.company || r.name) as string] : null)),
    rutin: karta<{ id: string; title: string | null }>(rutin.data, (r) => (r.title ? [r.id, r.title] : null)),
    nyhet: karta<{ id: string; title: string | null }>(nyhet.data, (r) => (r.title ? [r.id, r.title] : null)),
    kurs: karta<{ id: string; title: string | null }>(kurs.data, (r) => (r.title ? [r.id, r.title] : null)),
    team: karta<{ id: string; name: string | null }>(team.data, (r) => (r.name ? [r.id, r.name] : null)),
    avtal: karta<{ id: string; employee_id: string | null }>(avtal.data, (r) => (r.employee_id ? [r.id, r.employee_id] : null)),
    kandidat: karta<{ id: string; role_title: string | null }>(kandidat.data, (r) => (r.role_title ? [r.id, r.role_title] : null)),
    lonperiod: karta<{ id: string; period_start: string | null; period_end: string | null }>(lonperiod.data, (r) =>
      r.period_start && r.period_end ? [r.id, `Löneperioden ${r.period_start} – ${r.period_end}`] : null),
    fel: new Map(((fel.data ?? []) as { id: string; public_title: string | null; occurrences: number | null }[]).map((r) => [r.id, { titel: r.public_title, ganger: r.occurrences ?? 1 }] as [string, { titel: string | null; ganger: number }])),
    fil: new Map(filer2.map((f) => [f.id, f] as [string, RaFil])),
  };

  return formaLogg(handelser, filer, u, svensktDatum(), { dag: (ts) => svensktDatum(ts), klocka: (ts) => svenskKlocka(ts) });
}
