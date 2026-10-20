import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { gallande, type Handelse } from "@/lib/tid";
import { svenskDygnsstart } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { leadTitel, nyckel, OPPNA } from "@/lib/leads";
import { SKRIVLAGE } from "./skrivlage";
import { forslag, median, svarstid, trettioDagar } from "./leadsforma";

/**
 * Nav 2.0: Leads i utkastets former (moduler/ld.js).
 *
 * ===========================================================================
 * RLS AVGÖR, som på /leads: säljchef, VD, teamledare och superadmin ser alla
 * leads och fördelar dem (superadmin sedan 0135, beställaren 2026-10-20),
 * säljaren ser de leads hen fått. En chef utanför den kretsen ser vyn som
 * säljaren gör, som i Order.
 *
 * Det nya i utkastet (försöken, nästa samtal, mötet, skälet, ordern och
 * Ångra) är 0135. Läsningen tål att 0135 inte är körd: då står leadsen som
 * 0076 har dem, utan steg, och `utan0135` säger varför.
 *
 * Namnen på den som gav leadet eller påminde läses med service role, och bara
 * för- och efternamn på de personer stegen säljaren redan ser pekar på. Samma
 * undantag som chefens namn i data.ts.
 * ===========================================================================
 */

export type NdLeadSteg = {
  id: string;
  at: string;
  typ: string;
  utfall: string | null;
  not: string | null;
  av: string | null;
  avId: string | null;
  till: string | null;
};

export type NdLead = {
  id: string;
  /** "YYYY-MM-DD HH:MM" i svensk tid, som utkastet. */
  at: string;
  bolag: string;
  namn: string;
  tel: string;
  epost: string;
  ort: string;
  msg: string;
  sida: string;
  kamp: string;
  status: string;
  dubbl: string | null;
  vem: string | null;
  vemId: string | null;
  tilldelad: string | null;
  nasta: string | null;
  mote: { d: string; s: string; plats: string } | null;
  skal: string | null;
  order: number | null;
  orderId: string | null;
  /** Mötet i Kalendern (0135), när det bokats i Nav 2.0. */
  moteId: string | null;
  /** När leadet blev kund, för chefens "Blev kund, 30 dagar". */
  kundD: string | null;
  not: string;
  steg: NdLeadSteg[];
};

export type NdLeads = {
  /** Fördelar (säljchef, VD, teamledare, superadmin). Annars säljarens vy. */
  chef: boolean;
  skriv: boolean;
  utan0135: boolean;
  /** Fördela automatiskt (`nav_setting` `leads.auto`). */
  auto: boolean;
  leads: NdLead[];
  /** De som kan få ett lead: säljarna i registret. */
  saljare: { id: string; namn: string }[];
  /** Per säljare, senaste 30 dagarna: antal, svarstid (median, min), möten, kunder. */
  stat: Record<string, [number, number | null, number, number]>;
  /** Lagets svarstid: snittet av säljarnas medianer, senaste 30 dagarna. */
  lag: number | null;
  /** Säljare som påminnts i dag (för "Påmind"). */
  pamind: string[];
};

export function farFordela(user: CurrentUser): boolean {
  return hasRole(user, "sales_manager", "ceo", "team_lead", "admin");
}

const saknas = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|could not find/i.test(e.message ?? "");

const TZ = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function lokal(iso: string): string {
  const p = Object.fromEntries(TZ.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

type BasRad = {
  id: string;
  created_at: string;
  source: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  extra: Record<string, string> | null;
  status: string;
  status_changed_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  note: string | null;
  duplicate_of: string | null;
};
type NyRad = {
  id: string;
  next_call_at: string | null;
  meeting_at: string | null;
  meeting_place: string | null;
  lost_reason: string | null;
  order_id: string | null;
  meeting_event_id: string | null;
};
type StegRad = {
  id: string;
  lead_id: string;
  at: string;
  actor_id: string | null;
  kind: string;
  outcome: string | null;
  note: string | null;
  till: string | null;
};
type PersonRad = { id: string; first_name: string; last_name: string; status: string; employee_role: { role: string }[] | null };

const BAS = "id, created_at, source, name, company, email, phone, message, page_url, utm_source, utm_campaign, extra, status, status_changed_at, assigned_to, assigned_at, note, duplicate_of";
const ORT = new Set(["ort", "stad", "city", "postort", "kommun", "town"]);

function ortAv(extra: Record<string, string> | null): string {
  for (const [k, v] of Object.entries(extra ?? {})) if (ORT.has(nyckel(k)) && typeof v === "string") return v.slice(0, 80);
  return "";
}
function sidaAv(url: string | null): string {
  return (url ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "").slice(0, 200);
}

/** Säljarna: rollen salesperson, inte avslutade. */
async function hamtaSaljare(db: SupabaseClient): Promise<{ id: string; namn: string }[]> {
  const { data } = await db.from("employee").select("id, first_name, last_name, status, employee_role!employee_role_employee_id_fkey(role)").neq("status", "offboarded");
  return ((data ?? []) as unknown as PersonRad[])
    .filter((p) => (p.employee_role ?? []).some((r) => r.role === "salesperson"))
    .map((p) => ({ id: p.id, namn: fullName(p) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
}

/** Lagets svarstid ur alla leads (service role): bara talet lämnar servern. */
async function lagetsSvarstid(saljare: { id: string }[], nu: number): Promise<number | null> {
  const db = supabaseAdmin();
  const sedan = new Date(nu - 30 * 864e5).toISOString();
  const { data: lr } = await db.from("lead").select("id, assigned_to, assigned_at, status, duplicate_of").gte("assigned_at", sedan);
  const { data: sr, error } = await db.from("lead_event").select("lead_id, at, kind, actor_id, outcome").eq("kind", "forsok").gte("at", sedan).order("at");
  if (error) return null;
  const leads = (lr ?? []) as unknown as { id: string; assigned_to: string | null; assigned_at: string | null; status: string; duplicate_of: string | null }[];
  const steg = (sr ?? []) as unknown as { lead_id: string; at: string; kind: string; actor_id: string | null; outcome: string | null }[];
  const med = saljare
    .map((s) => trettioDagar(s.id, leads.map((l) => ({ ...l, kundAt: null })), steg, nu)[1])
    .filter((x): x is number => x !== null);
  return med.length ? Math.round(med.reduce((a, b) => a + b, 0) / med.length) : null;
}

export async function byggLeads(supabase: SupabaseClient, user: CurrentUser): Promise<NdLeads> {
  const chef = farFordela(user);
  const mig = user.employee?.id ?? null;
  const tom: NdLeads = { chef, skriv: SKRIVLAGE.leads, utan0135: false, auto: false, leads: [], saljare: [], stat: {}, lag: null, pamind: [] };
  if (!mig) return tom;
  const nu = Date.now();

  const [basSvar, nySvar, stegSvar, autoSvar, saljare] = await Promise.all([
    supabase.from("lead").select(BAS).order("created_at", { ascending: false }).limit(500),
    supabase.from("lead").select("id, next_call_at, meeting_at, meeting_place, lost_reason, order_id, meeting_event_id").order("created_at", { ascending: false }).limit(500),
    supabase.from("lead_event").select("id, lead_id, at, actor_id, kind, outcome, note, till").order("at").limit(5000),
    supabase.from("nav_setting").select("value").eq("key", "leads.auto").maybeSingle(),
    chef ? hamtaSaljare(supabase) : Promise.resolve([] as { id: string; namn: string }[]),
  ]);

  const bas = (basSvar.data ?? []) as unknown as BasRad[];
  const utan0135 = saknas(nySvar.error) || saknas(stegSvar.error);
  const ny = new Map(((utan0135 ? [] : nySvar.data ?? []) as unknown as NyRad[]).map((r) => [r.id, r]));
  const steg = (utan0135 ? [] : stegSvar.data ?? []) as unknown as StegRad[];

  // Namnen: de som stegen och leadsen pekar på. Fördelarna läser registret med RLS, säljaren får bara namnen.
  const ids = new Set<string>([mig]);
  for (const l of bas) if (l.assigned_to) ids.add(l.assigned_to);
  for (const s of steg) {
    if (s.actor_id) ids.add(s.actor_id);
    if (s.till) ids.add(s.till);
  }
  for (const s of saljare) ids.delete(s.id);
  const namn = new Map(saljare.map((s) => [s.id, s.namn]));
  if (ids.size) {
    const { data: pr } = await supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...ids]);
    for (const p of (pr ?? []) as unknown as { id: string; first_name: string; last_name: string }[]) namn.set(p.id, fullName(p));
  }
  // Säljarens egen rad i säljarlistan, så att Dina 30 dagar har en nyckel.
  const minaSaljare = chef ? saljare : [{ id: mig, namn: namn.get(mig) ?? fullName(user.employee!) }];

  // Ordernumren för leads som blivit kund (RLS: säljaren ser sina order, fördelarna alla).
  const orderIds = [...new Set([...ny.values()].map((r) => r.order_id).filter((x): x is string => !!x))];
  const ordernr = new Map<string, number>();
  if (orderIds.length) {
    const { data: or } = await supabase.from("sales_order").select("id, order_number").in("id", orderIds);
    for (const o of (or ?? []) as unknown as { id: string; order_number: number | string | null }[]) if (o.order_number !== null) ordernr.set(o.id, Number(o.order_number));
  }

  const kundAt = (l: BasRad) => {
    if (l.status !== "won") return null;
    const k = [...steg].reverse().find((s) => s.lead_id === l.id && s.kind === "kund");
    return k?.at ?? l.status_changed_at;
  };

  const leads: NdLead[] = bas.map((l) => {
    const n = ny.get(l.id);
    const mote = n?.meeting_at && n.meeting_place ? lokal(n.meeting_at) : null;
    const k = kundAt(l);
    return {
      id: l.id,
      at: lokal(l.created_at),
      bolag: l.company ?? "",
      namn: l.name ?? l.email ?? l.phone ?? "",
      tel: l.phone ?? "",
      epost: l.email ?? "",
      ort: ortAv(l.extra),
      msg: l.message ?? "",
      sida: sidaAv(l.page_url),
      kamp: [l.utm_source, l.utm_campaign].filter(Boolean).join(" · "),
      status: l.status,
      dubbl: l.duplicate_of,
      vem: l.assigned_to ? (namn.get(l.assigned_to) ?? "Okänd") : null,
      vemId: l.assigned_to,
      tilldelad: l.assigned_at ? lokal(l.assigned_at) : null,
      nasta: n?.next_call_at ? lokal(n.next_call_at) : null,
      mote: mote ? { d: mote.slice(0, 10), s: mote.slice(11), plats: n!.meeting_place! } : null,
      skal: n?.lost_reason ?? null,
      order: n?.order_id ? (ordernr.get(n.order_id) ?? null) : null,
      orderId: n?.order_id ?? null,
      moteId: n?.meeting_event_id ?? null,
      kundD: k ? lokal(k).slice(0, 10) : null,
      not: l.note ?? "",
      steg: steg
        .filter((s) => s.lead_id === l.id)
        .map((s) => ({
          id: s.id,
          at: lokal(s.at),
          typ: s.kind,
          utfall: s.outcome,
          not: s.note,
          av: s.actor_id ? (namn.get(s.actor_id) ?? "Okänd") : null,
          avId: s.actor_id,
          till: s.till ? (namn.get(s.till) ?? "Okänd") : null,
        })),
    };
  });

  const raknas = bas.map((l) => ({ ...l, kundAt: kundAt(l) }));
  const stat: NdLeads["stat"] = {};
  for (const s of minaSaljare) stat[s.namn] = trettioDagar(s.id, raknas, steg, nu);
  // Den som fått ett lead utan att vara säljare (en chef) står också med.
  if (chef) for (const l of bas) if (l.assigned_to && !saljare.some((s) => s.id === l.assigned_to)) {
    const nm = namn.get(l.assigned_to) ?? "Okänd";
    if (!stat[nm]) stat[nm] = trettioDagar(l.assigned_to, raknas, steg, nu);
  }
  const lag = utan0135
    ? null
    : chef
      ? (() => {
          const m = Object.values(stat).map((v) => v[1]).filter((x): x is number => x !== null);
          return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null;
        })()
      : await lagetsSvarstid(await hamtaSaljare(supabaseAdmin()), nu);

  const idag = svenskDygnsstart(new Date(nu));
  const pamind = [...new Set(steg.filter((s) => s.kind === "paminn" && s.at >= idag && s.till).map((s) => namn.get(s.till!) ?? ""))].filter(Boolean);
  const auto = !!(autoSvar.data && (autoSvar.data.value as { pa?: boolean } | null)?.pa);

  return { chef, skriv: SKRIVLAGE.leads, utan0135, auto, leads, saljare: minaSaljare, stat, lag, pamind };
}

/* ---------------------------------------------------------------------------
 * Förslaget i servern: vem som är på plats nu. Samma regel som Tid (senaste
 * gällande stämpling i dag är "in"), bara säljare.
 * ------------------------------------------------------------------------- */

export async function paPlatsNu(): Promise<{ id: string; namn: string; oppna: number; svar: number | null }[]> {
  const db = supabaseAdmin();
  const nu = Date.now();
  const saljare = await hamtaSaljare(db);
  if (!saljare.length) return [];
  const ids = saljare.map((s) => s.id);
  const sedan = new Date(nu - 30 * 864e5).toISOString();
  const [{ data: st }, { data: lr }, { data: sr }] = await Promise.all([
    db.from("time_event").select("id, kind, occurred_at, source, supersedes_id, correction_state, employee_id").in("employee_id", ids).gte("occurred_at", svenskDygnsstart(new Date(nu))).in("kind", ["in", "out"]).order("occurred_at"),
    db.from("lead").select("id, assigned_to, assigned_at, status, duplicate_of").in("assigned_to", ids),
    db.from("lead_event").select("lead_id, at, kind, actor_id, outcome").eq("kind", "forsok").gte("at", sedan).order("at"),
  ]);
  const per = new Map<string, Handelse[]>();
  for (const h of (st ?? []) as unknown as (Handelse & { employee_id: string })[]) per.set(h.employee_id, [...(per.get(h.employee_id) ?? []), h]);
  const leads = (lr ?? []) as unknown as { id: string; assigned_to: string | null; assigned_at: string | null; status: string; duplicate_of: string | null }[];
  const steg = (sr ?? []) as unknown as { lead_id: string; at: string; kind: string; actor_id: string | null; outcome: string | null }[];
  const inne = saljare.filter((s) => {
    const g = gallande(per.get(s.id) ?? []);
    return g[g.length - 1]?.kind === "in";
  });
  return forslag(
    inne.map((s) => ({
      ...s,
      oppna: leads.filter((l) => l.assigned_to === s.id && (OPPNA as string[]).includes(l.status)).length,
      svar: median(leads.filter((l) => l.assigned_to === s.id && l.assigned_at && Date.parse(l.assigned_at) >= nu - 30 * 864e5).map((l) => svarstid(l, steg)).filter((x): x is number => x !== null)),
    })),
  );
}

/**
 * Fördela automatiskt (utkastets "Fördela automatiskt"): ett nytt lead går
 * till förslaget när brytaren är på. Anropas av mottagaren (`taEmotLead`) och
 * skriver ingenting förrän beställaren slagit på Leads (`SKRIVLAGE.leads`).
 * Ett fel här stoppar aldrig mottagningen.
 */
export async function fordelaNyttLead(leadId: string): Promise<void> {
  if (!SKRIVLAGE.leads) return;
  try {
    const db = supabaseAdmin();
    const { data: inst } = await db.from("nav_setting").select("value").eq("key", "leads.auto").maybeSingle();
    if (!(inst?.value as { pa?: boolean } | null)?.pa) return;
    const [forst] = await paPlatsNu();
    if (!forst) return;
    const { data: rad } = await db.from("lead").select("id, status, assigned_to, assigned_at, company, name, email, phone").eq("id", leadId).maybeSingle();
    const l = rad as unknown as { id: string; status: string; assigned_to: string | null; assigned_at: string | null; company: string | null; name: string | null; email: string | null; phone: string | null } | null;
    if (!l || l.assigned_to || l.status !== "new") return;
    const nar = new Date().toISOString();
    const { error } = await db.from("lead").update({ assigned_to: forst.id, assigned_at: nar }).eq("id", leadId).is("assigned_to", null);
    if (error) return;
    await db.from("lead_event").insert({ lead_id: leadId, actor_id: null, kind: "tilldelad", till: forst.id, fore: { assigned_to: null, assigned_at: null } });
    await skrivHandelse({ actorId: null, action: "lead.assigned", objectType: "lead", objectId: leadId, meta: { till: forst.id, fran: null, automatiskt: true } });
    await notifiera({
      till: forst.id,
      av: null,
      kalla: "lead-tilldelad",
      typ: "lead",
      rubrik: `Lead till dig: ${leadTitel(l)}`,
      detalj: [l.company ? l.name : null, l.phone ?? l.email].filter(Boolean).join(" · "),
      href: `/leads/${leadId}`,
      objekt: { typ: "lead", id: leadId },
    });
  } catch {
    // Leadet ligger kvar hos fördelarna, som utan automatiken.
  }
}
