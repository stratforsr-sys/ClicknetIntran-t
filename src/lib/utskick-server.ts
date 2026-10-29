import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NOTIS_KALLOR, type Notis } from "@/lib/notiser";
import { nivaFor } from "@/lib/nav2/forma";
import {
  KANALER, LAGER, MORGON_AVSNITT, NIVAER, OMRADEN, SORT_NAMN, SORTER,
  andra, andraMedUnder, antalAv, avsnittId, far, kanalerFor, lastAvSuperadmin, nycklarFor, nycklarForAvsnitt, omradeFor, rensa,
  type Kanal, type Lager, type Niva, type Personlager, type Regler,
} from "@/lib/utskick";

/**
 * Utskicken på servern (0255): läser lagren och svarar på "får de här
 * personerna det här". Reglerna och hur lagren vägs står i `utskick.ts`.
 *
 * ===========================================================================
 * ETT FEL HÄR STÄNGER INGENTING
 *
 * Går tabellen inte att läsa (0255 inte körd, databasen svarar inte) går allt
 * ut som förut. En notis som uteblir för att en inställning inte gick att läsa
 * är ett tystare fel än ett mejl för mycket, och det är mejlet som syns.
 * Funktionerna här kastar aldrig, av samma skäl som `notifiera()`.
 * ===========================================================================
 */

type Rad = { lager: Lager; niva: Niva | null; employee_id: string | null; regler: unknown };

/** Lagren för personerna: bolagets, deras nivås, superadmins om dem och deras egna. */
export async function hamtaLager(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, Personlager>> {
  const unika = [...new Set(ids)].filter(Boolean);
  const ut = new Map<string, Personlager>();
  if (!unika.length) return ut;
  try {
    const [{ data: rader, error }, { data: roller }] = await Promise.all([
      db.from("notification_rule").select("lager, niva, employee_id, regler").or(`employee_id.is.null,employee_id.in.(${unika.join(",")})`),
      db.from("employee_role").select("employee_id, role").in("employee_id", unika),
    ]);
    if (error) return ut;
    const rollerAv = new Map<string, string[]>();
    for (const r of (roller ?? []) as { employee_id: string; role: string }[]) {
      rollerAv.set(r.employee_id, [...(rollerAv.get(r.employee_id) ?? []), r.role]);
    }
    let alla: Regler | undefined;
    const niva = new Map<string, Regler>();
    const person = new Map<string, Regler>();
    const egen = new Map<string, Regler>();
    for (const r of (rader ?? []) as Rad[]) {
      const regler = rensa(r.regler);
      if (r.lager === "alla") alla = regler;
      else if (r.lager === "niva" && r.niva) niva.set(r.niva, regler);
      else if (r.lager === "person" && r.employee_id) person.set(r.employee_id, regler);
      else if (r.lager === "egen" && r.employee_id) egen.set(r.employee_id, regler);
    }
    for (const id of unika) {
      ut.set(id, { alla, niva: niva.get(nivaFor(rollerAv.get(id) ?? [])), person: person.get(id), egen: egen.get(id) });
    }
  } catch {
    // Se rubriken: ingenting stängs.
  }
  return ut;
}

/** Vilka av mottagarna som får sorten i kanalen. `standard` är kanalens svar när ingen sagt något. */
export async function vilkaFar(
  ids: readonly string[],
  kanal: Kanal,
  kalla: string,
  standard: boolean,
  db: SupabaseClient = supabaseAdmin(),
): Promise<string[]> {
  const unika = [...new Set(ids)].filter(Boolean);
  if (!unika.length) return [];
  const lager = await hamtaLager(db, unika);
  const nycklar = nycklarFor(kalla);
  return unika.filter((id) => far(lager.get(id) ?? {}, kanal, nycklar, standard));
}

/** Sorterna som får pushas till personen, av `kandidater`. Underlaget till vad telefonen visar. */
export async function pushbaraFor(mig: string, kandidater: readonly string[], standard: (k: string) => boolean): Promise<string[]> {
  const l = (await hamtaLager(supabaseAdmin(), [mig])).get(mig) ?? {};
  return kandidater.filter((k) => far(l, "push", nycklarFor(k), standard(k)));
}

/** Morgonbrevet: släpper personen igenom avsnittet med den rubriken? */
export async function morgonFilter(db: SupabaseClient, ids: readonly string[]): Promise<(id: string, rubrik: string) => boolean> {
  const lager = await hamtaLager(db, ids);
  return (id, rubrik) => {
    const a = avsnittId(rubrik);
    return a ? far(lager.get(id) ?? {}, "morgon", nycklarForAvsnitt(a), true) : true;
  };
}

/* ------------------------------------------------------------------------- */
/* Klockan                                                                   */
/* ------------------------------------------------------------------------- */

const KALLOR_LANGST_FORST = [...NOTIS_KALLOR].sort((a, b) => b.length - a.length);

/** Sorten ur ett notis-id (`notisId`): den längsta källan som id:t börjar med. */
export function kallaUrNotisId(id: string): string | null {
  for (const k of KALLOR_LANGST_FORST) if (id === k || id.startsWith(`${k}-`)) return k;
  return null;
}

/** Tar bort det personen inte ska se i klockan. Läser lagren med service role. */
export async function filtreraKlockan(mig: string, notiser: Notis[]): Promise<Notis[]> {
  const l = (await hamtaLager(supabaseAdmin(), [mig])).get(mig);
  if (!l || (!l.alla?.klocka && !l.niva?.klocka && !l.person?.klocka && !l.egen?.klocka)) return notiser;
  return notiser.filter((n) => {
    const k = kallaUrNotisId(n.id);
    return !k || far(l, "klocka", nycklarFor(k), true);
  });
}

/* ------------------------------------------------------------------------- */
/* Inställningen: vad vyn visar och hur den sparar                           */
/* ------------------------------------------------------------------------- */

/** Standardläget per sort och kanal, utan några regler alls. Skickas med till vyn. */
export type Standard = (kanal: Kanal, kalla: string) => boolean;

export type Katalog = {
  kanaler: { id: Kanal; namn: string }[];
  omraden: { id: string; namn: string; sorter: { id: string; namn: string; kanaler: Kanal[]; standard: Partial<Record<Kanal, boolean>> }[] }[];
  avsnitt: { id: string; namn: string }[];
  nivaer: { id: Niva; namn: string }[];
};

export function katalog(standard: Standard): Katalog {
  return {
    kanaler: KANALER.map((id) => ({ id, namn: ({ klocka: "Klockan", mejl: "Mejl", push: "Telefonen", morgon: "Morgonbrevet" } as const)[id] })),
    omraden: OMRADEN.map((o) => ({
      id: o.id,
      namn: o.namn,
      sorter: SORTER.filter((s) => omradeFor(s) === o.id).map((s) => {
        const kanaler = kanalerFor(s);
        return { id: s, namn: SORT_NAMN[s] ?? s, kanaler, standard: Object.fromEntries(kanaler.map((k) => [k, standard(k, s)])) };
      }),
    })),
    avsnitt: MORGON_AVSNITT.map((a) => ({ id: a.id, namn: a.namn })),
    nivaer: NIVAER.map((id) => ({ id, namn: ({ salesperson: "Säljare", admin: "Admin", superadmin: "Superadmin" } as const)[id] })),
  };
}

export type Utskicksvy = {
  katalog: Katalog;
  /** Mina fyra lager. */
  mina: Personlager;
  /** Nycklar superadmin stängt för mig, per kanal: `kanal → nyckel[]`. Vyn låser dem. */
  last: Partial<Record<Kanal, string[]>>;
  superadmin: boolean;
  /** Bara för superadmin: bolagets och nivåernas lager, och alla aktiva med sina avvikelser. */
  bolaget?: {
    alla: Regler;
    nivaer: Partial<Record<Niva, Regler>>;
    personer: { id: string; namn: string; niva: Niva; person: Regler; egen: Regler; av: number }[];
  };
  /** Fel som vyn ska visa: tabellen saknas och liknande. */
  fel?: string;
};

const AKTIV = ["active", "onboarding"];
const UTAN_0255 = "Inställningen kräver migration 0255, som inte är körd än. Ingenting ändrades.";

export function arSuperadmin(user: CurrentUser): boolean {
  return nivaFor(user.roles) === "superadmin";
}

/** Alla nycklar vyn kan visa, per kanal. Används för att räkna ut vad som är låst. */
function allaNycklar(kanal: Kanal): string[][] {
  if (kanal === "morgon") return MORGON_AVSNITT.map((a) => nycklarForAvsnitt(a.id));
  const ut: string[][] = [["*"]];
  for (const o of OMRADEN) ut.push([`omrade:${o.id}`, "*"]);
  for (const s of SORTER) if (kanalerFor(s).includes(kanal)) ut.push(nycklarFor(s));
  return ut;
}

export async function utskicksvy(user: CurrentUser, standard: Standard): Promise<Utskicksvy> {
  const db = supabaseAdmin();
  const mig = user.employee?.id ?? "";
  const superadmin = arSuperadmin(user);
  const vy: Utskicksvy = { katalog: katalog(standard), mina: {}, last: {}, superadmin };
  const { error } = await db.from("notification_rule").select("id").limit(1);
  if (error) return { ...vy, fel: /notification_rule/.test(error.message) ? UTAN_0255.replace(" Ingenting ändrades.", "") : error.message };

  vy.mina = (await hamtaLager(db, [mig])).get(mig) ?? {};
  for (const k of KANALER) {
    const last = allaNycklar(k).filter((n) => lastAvSuperadmin(vy.mina, k, n)).map((n) => n[0]);
    if (last.length) vy.last[k] = last;
  }

  if (superadmin) {
    const [{ data: rader }, { data: personer }, { data: roller }] = await Promise.all([
      db.from("notification_rule").select("lager, niva, employee_id, regler"),
      db.from("employee").select("id, first_name, last_name").in("status", AKTIV).order("first_name"),
      db.from("employee_role").select("employee_id, role"),
    ]);
    const rollerAv = new Map<string, string[]>();
    for (const r of (roller ?? []) as { employee_id: string; role: string }[]) {
      rollerAv.set(r.employee_id, [...(rollerAv.get(r.employee_id) ?? []), r.role]);
    }
    const b: NonNullable<Utskicksvy["bolaget"]> = { alla: {}, nivaer: {}, personer: [] };
    const person = new Map<string, Regler>();
    const egen = new Map<string, Regler>();
    for (const r of (rader ?? []) as Rad[]) {
      const regler = rensa(r.regler);
      if (r.lager === "alla") b.alla = regler;
      else if (r.lager === "niva" && r.niva) b.nivaer[r.niva] = regler;
      else if (r.lager === "person" && r.employee_id) person.set(r.employee_id, regler);
      else if (r.lager === "egen" && r.employee_id) egen.set(r.employee_id, regler);
    }
    for (const p of (personer ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      const pr = person.get(p.id) ?? {};
      const eg = egen.get(p.id) ?? {};
      b.personer.push({
        id: p.id,
        namn: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Namnlös",
        niva: nivaFor(rollerAv.get(p.id) ?? []),
        person: pr,
        egen: eg,
        av: antalAv(pr) + antalAv(eg),
      });
    }
    vy.bolaget = b;
  }
  return vy;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Andring = { lager?: unknown; niva?: unknown; employeeId?: unknown; kanal?: unknown; nyckel?: unknown; varde?: unknown };
export type Sparat = { ok: true; regler: Regler } | { ok: false; fel: string; status: number };

/**
 * En brytare: lagret, kanalen, nyckeln och på/av/ärv (`null`).
 *
 * VEM FÅR VAD prövas här och ingen annanstans, så att gamla Navs action och
 * Nav 2.0:s rutt inte kan glida isär: det egna lagret bara för den inloggade
 * själv, de tre andra bara för superadmin. Allt bokförs i `audit_log`.
 */
export async function sparaUtskick(user: CurrentUser, a: Andring): Promise<Sparat> {
  if (!user.employee) return { ok: false, fel: "Du måste vara inloggad.", status: 401 };
  const mig = user.employee.id;
  const lager = String(a.lager ?? "egen") as Lager;
  if (!(LAGER as readonly string[]).includes(lager)) return { ok: false, fel: "Okänt lager.", status: 400 };
  if (lager !== "egen" && !arSuperadmin(user)) {
    return { ok: false, fel: "Bara en superadmin ställer in utskicken för andra.", status: 403 };
  }

  let niva: Niva | null = null;
  let employeeId: string | null = null;
  if (lager === "niva") {
    if (!(NIVAER as readonly string[]).includes(String(a.niva))) return { ok: false, fel: "Okänd nivå.", status: 400 };
    niva = a.niva as Niva;
  } else if (lager === "person") {
    if (!UUID.test(String(a.employeeId ?? ""))) return { ok: false, fel: "Okänd person.", status: 400 };
    employeeId = String(a.employeeId);
  } else if (lager === "egen") {
    employeeId = mig;
  }

  const db = supabaseAdmin();
  let q = db.from("notification_rule").select("id, regler").eq("lager", lager);
  q = niva ? q.eq("niva", niva) : q.is("niva", null);
  q = employeeId ? q.eq("employee_id", employeeId) : q.is("employee_id", null);
  const { data: fore, error: lasfel } = await q.maybeSingle();
  if (lasfel) return { ok: false, fel: /notification_rule/.test(lasfel.message) ? UTAN_0255 : lasfel.message, status: 500 };

  const nya = (lager === "egen" ? andraMedUnder : andra)(rensa(fore?.regler), a.kanal, a.nyckel, a.varde);
  if (!nya) return { ok: false, fel: "Ogiltig inställning.", status: 400 };

  const rad = { lager, niva, employee_id: employeeId, regler: nya, updated_by: mig, updated_at: new Date().toISOString() };
  const { error } = fore
    ? await db.from("notification_rule").update(rad).eq("id", fore.id as string)
    : await db.from("notification_rule").insert(rad);
  if (error) return { ok: false, fel: error.message, status: 500 };

  await db.from("audit_log").insert({
    actor_id: mig,
    action: "notification_rule.changed",
    object_type: "notification_rule",
    object_id: employeeId ?? niva ?? "alla",
    meta: { lager, kanal: a.kanal, nyckel: a.nyckel, varde: a.varde },
  });
  return { ok: true, regler: nya };
}
