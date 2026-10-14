import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaChefsbild, hamtaRegelverk, type Chefsbild } from "@/lib/franvaro-server";
import { datumPlus, sjukfrister, upprepadKorttid, type Franvarotyp, type Regelverk, type Sjukanmalan } from "@/lib/franvaro";
import { dagarBakat, svensktDatum, svenskKlocka } from "@/lib/klocka";

/**
 * Nav 2.0: Frånvaro, med samma funktioner som /franvaro, /franvaro/attest och
 * /franvaro/sjuk: hamtaRegelverk, hamtaChefsbild, sjukfrister och
 * upprepadKorttid.
 *
 * Den egna frånvaron läses med den inloggades token. Chefsbilden är repots
 * egen och avgör själv vem som syns och vad som går att besluta. Ringordningen
 * byggs som på /franvaro/sjuk.
 *
 * Säljaren får teamets bemanning som ett antal per dag och aldrig namnen,
 * räknat som hamtaProvunderlag räknar: godkänd ledighet som räknas i
 * bemanningen, inom takets team eller hela bolaget om taket är bolagets.
 */

export type NdFranvaroPost = {
  id: string;
  vem: string;
  pid: string;
  typ: string;
  fran: string;
  till: string | null;
  st: string;
  omf?: number;
  reg?: string;
  bekr?: string | null;
  skal?: string | null;
  inskickad?: string | null;
  inDag?: string | null;
  del?: string | null;
  egen: boolean;
};

export type NdFranvaro = {
  regler: Regelverk | null;
  typer: Franvarotyp[];
  sparrar: { l: string; fran: string; till: string; typer: string[] }[];
  tak: number | null;
  /** Andra som är borta per dag (godkänd ledighet), bara dagar med minst en. */
  bemanning: Record<string, number>;
  saldo: { vacation: { d: number; asof: string } | null; saved: { d: number; asof: string } | null };
  poster: NdFranvaroPost[];
  /** Som på /franvaro/sjuk: en rad per plats i ordningen, med numret om det finns. */
  ring: { vem: string; roll: string; antal: number; tel: string | null }[];
  frister: { kind: string; due_on: string }[];
  chef: null | {
    ko: Chefsbild["ko"];
    kommande: Chefsbild["kommande"];
    sjuka: Chefsbild["sjuka"];
    rehab: { namn: string; antal: number; sedan: string }[];
    team: number;
    /** De chefen ser i registret, utom hen själv: raderna i tavlan. */
    personer: string[];
    /** Teamets perioder: kön (beslutbar), godkänd ledighet och sjukperioder. */
    poster: NdFranvaroPost[];
  };
};

export async function byggFranvaro(supabase: SupabaseClient, user: CurrentUser): Promise<NdFranvaro> {
  const mig = user.employee!.id;
  const idag = svensktDatum();
  const rv = await hamtaRegelverk();

  const [{ data: egna }, { data: sjuk }, { data: saldon }, { data: sparrar }, { data: tak }, { data: ordning }, { data: jag }] = await Promise.all([
    supabase.from("absence_request").select("id, type_id, starts_on, ends_on, part_day_minutes, status, submitted_at, reason").eq("employee_id", mig).gte("ends_on", dagarBakat(idag, 365)).order("starts_on", { ascending: false }),
    supabase.from("sick_report").select("id, first_sick_day, last_sick_day, extent_percent, registered_at, confirmed_at, cancelled_at, escalated_at").eq("employee_id", mig).is("cancelled_at", null).order("first_sick_day", { ascending: false }),
    supabase.from("absence_balance").select("type_id, days, as_of").eq("employee_id", mig).order("as_of", { ascending: false }),
    supabase.from("absence_blackout").select("label, starts_on, ends_on, type_ids, team_ids").gte("ends_on", idag).order("starts_on"),
    supabase.from("staffing_cap").select("team_id, max_absent"),
    supabase.from("absence_call_order").select("sort, target_kind, role, employee_id, phone, team_id").eq("active", true).order("sort"),
    supabase.from("employee").select("manager_id, team_id").eq("id", mig).maybeSingle(),
  ]);

  // Ringordningen, byggd som på /franvaro/sjuk: teamets rader och bolagets,
  // chefen slås upp per person, en roll blir en rad med alla som har den, och
  // telefonnumret står på raden i ordningen. Namnen med service role: en
  // säljare får inte läsa registret, men navet visar redan vem hen ska ringa.
  const db = supabaseAdmin();
  const rader = (ordning ?? []).filter((o) => o.team_id === null || o.team_id === (jag?.team_id ?? null));
  const roller = rader.filter((o) => o.target_kind === "role").map((o) => o.role as string);
  const utpekade = rader.filter((o) => o.target_kind === "person").map((o) => o.employee_id as string);
  const [{ data: chefen }, { data: medRoll }, { data: namngivna }] = await Promise.all([
    jag?.manager_id ? db.from("employee").select("first_name, last_name").eq("id", jag.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    roller.length ? db.from("employee_role").select("role, employee!employee_role_employee_id_fkey(id, first_name, last_name, status)").in("role", roller) : Promise.resolve({ data: [] }),
    utpekade.length ? db.from("employee").select("id, first_name, last_name").in("id", utpekade) : Promise.resolve({ data: [] }),
  ]);
  const perRoll = new Map<string, { first_name: string; last_name: string }[]>();
  for (const r of (medRoll ?? []) as unknown as { role: string; employee: { first_name: string; last_name: string; status: string } }[]) {
    if (r.employee.status === "offboarded") continue;
    perRoll.set(r.role, [...(perRoll.get(r.role) ?? []), r.employee]);
  }
  const namngiven = new Map(((namngivna ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, p]));
  const ring: NdFranvaro["ring"] = rader
    .map((o) => {
      if (o.target_kind === "manager") return chefen ? { vem: fullName(chefen), roll: "Din närmaste chef", antal: 1, tel: o.phone ?? null } : null;
      if (o.target_kind === "role") {
        const folk = perRoll.get(o.role as string) ?? [];
        return folk.length ? { vem: folk.map(fullName).join(", "), roll: ROLE_LABEL[o.role as Role] ?? (o.role as string), antal: folk.length, tel: o.phone ?? null } : null;
      }
      const p = namngiven.get(o.employee_id as string);
      return p ? { vem: fullName(p), roll: "Utpekad mottagare", antal: 1, tel: o.phone ?? null } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const minNamn = [user.employee!.first_name, user.employee!.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  const poster: NdFranvaroPost[] = [
    ...(egna ?? []).map((a) => ({
      id: a.id,
      vem: minNamn,
      pid: mig,
      typ: a.type_id,
      fran: a.starts_on,
      till: a.ends_on,
      st: a.status,
      skal: a.reason ?? null,
      inskickad: a.submitted_at ? svenskKlocka(a.submitted_at) : null,
      inDag: a.submitted_at ? svensktDatum(a.submitted_at) : null,
      del: a.part_day_minutes !== null ? `${Math.round(a.part_day_minutes / 60 * 10) / 10} h` : null,
      egen: true,
    })),
    ...(sjuk ?? []).map((s) => ({
      id: s.id,
      vem: minNamn,
      pid: mig,
      typ: "sick",
      fran: s.first_sick_day,
      till: s.last_sick_day,
      st: "sick",
      omf: s.extent_percent,
      reg: svenskKlocka(s.registered_at),
      bekr: s.confirmed_at ? svenskKlocka(s.confirmed_at) : null,
      egen: true,
    })),
  ];

  const saldo = (typ: string) => {
    const s = (saldon ?? []).find((x) => x.type_id === typ);
    return s ? { d: Number(s.days), asof: s.as_of } : null;
  };
  // Teamets eget tak går före bolagets, som i hamtaProvunderlag.
  const mittTak = (tak ?? []).find((t) => t.team_id !== null && t.team_id === (jag?.team_id ?? null)) ?? (tak ?? []).find((t) => t.team_id === null) ?? null;

  // Bemanningen: antal andra som är borta per dag, ett år framåt. Läst med
  // service role som i hamtaProvunderlag, och bara antalet lämnar servern.
  const raknas = new Set((rv?.typer ?? []).filter((t) => t.counts_in_staffing).map((t) => t.id));
  const { data: andras } = await db
    .from("absence_request")
    .select("employee_id, type_id, starts_on, ends_on, employee!absence_request_employee_id_fkey(team_id)")
    .eq("status", "approved")
    .lte("starts_on", datumPlus(idag, 365))
    .gte("ends_on", idag);
  const bemanning: Record<string, number> = {};
  for (const p of (andras ?? []) as unknown as { employee_id: string; type_id: string; starts_on: string; ends_on: string; employee: { team_id: string | null } | null }[]) {
    if (p.employee_id === mig || !raknas.has(p.type_id)) continue;
    if (mittTak?.team_id != null && p.employee?.team_id !== mittTak.team_id) continue;
    for (let d = p.starts_on < idag ? idag : p.starts_on; d <= p.ends_on; d = datumPlus(d, 1)) bemanning[d] = (bemanning[d] ?? 0) + 1;
  }
  const oppen = (sjuk ?? []).find((s) => !s.last_sick_day || s.last_sick_day >= idag);

  const ut: NdFranvaro = {
    regler: rv?.regler ?? null,
    typer: rv?.typer ?? [],
    // En spärr med team gäller bara de teamen; tom lista gäller alla.
    sparrar: (sparrar ?? [])
      .filter((b) => !(b.team_ids ?? []).length || (jag?.team_id && (b.team_ids as string[]).includes(jag.team_id)))
      .map((b) => ({ l: b.label, fran: b.starts_on, till: b.ends_on, typer: b.type_ids ?? [] })),
    tak: mittTak ? mittTak.max_absent : null,
    bemanning,
    saldo: { vacation: saldo("vacation"), saved: saldo("saved_vacation") },
    poster,
    ring,
    frister: oppen && rv ? sjukfrister(oppen.first_sick_day, rv.regler) : [],
    chef: null,
  };

  // Chefens halva: repots egen chefsbild. Den som inte leder någon får en tom kö.
  if (hasRole(user, "sales_manager", "ceo", "team_lead", "admin")) {
    const bild = await hamtaChefsbild(user, rv?.regler ?? null, rv?.typer ?? [], idag, 30);
    const [{ data: allaSjuk }, { data: alla }, { data: godkanda }] = await Promise.all([
      supabase.from("sick_report").select("employee_id, first_sick_day, last_sick_day, registered_at, confirmed_at, cancelled_at, escalated_at, extent_percent, id").is("cancelled_at", null).gte("first_sick_day", dagarBakat(idag, 400)),
      supabase.from("employee").select("id, first_name, last_name, status"),
      supabase.from("absence_request").select("id, employee_id, type_id, starts_on, ends_on, part_day_minutes, reason").eq("status", "approved").gte("ends_on", dagarBakat(idag, 60)).lte("starts_on", datumPlus(idag, 335)).neq("employee_id", mig),
    ]);
    const namn = new Map((alla ?? []).map((p) => [p.id, fullName(p)]));
    const pers = (alla ?? []).filter((p) => p.status !== "offboarded");
    const per = new Map<string, Sjukanmalan[]>();
    for (const s of (allaSjuk ?? []) as unknown as (Sjukanmalan & { employee_id: string })[]) per.set(s.employee_id, [...(per.get(s.employee_id) ?? []), s]);
    const rehab: NonNullable<NdFranvaro["chef"]>["rehab"] = [];
    if (rv) for (const p of pers) { const u = upprepadKorttid(per.get(p.id) ?? [], rv.regler, idag); if (u) rehab.push({ namn: fullName(p), ...u }); }
    const del = (m: number | null) => (m !== null ? `${Math.round((m / 60) * 10) / 10} h` : null);
    const teamPoster: NdFranvaroPost[] = [
      ...bild.ko.map((a) => ({ id: a.id, vem: a.namn, pid: a.employeeId, typ: a.typId, fran: a.starts_on, till: a.ends_on, st: "submitted", skal: a.skal, inskickad: a.submitted_at ? svenskKlocka(a.submitted_at) : null, inDag: a.submitted_at ? svensktDatum(a.submitted_at) : null, del: del(a.part_day_minutes), egen: false })),
      ...(godkanda ?? []).map((a) => ({ id: a.id, vem: namn.get(a.employee_id) ?? "Okänd", pid: a.employee_id, typ: a.type_id, fran: a.starts_on, till: a.ends_on, st: "approved", skal: a.reason ?? null, del: del(a.part_day_minutes), egen: false })),
      ...(allaSjuk ?? [])
        .filter((s) => s.employee_id !== mig && (!s.last_sick_day || s.last_sick_day >= dagarBakat(idag, 60)))
        .map((s) => ({ id: s.id, vem: namn.get(s.employee_id) ?? "Okänd", pid: s.employee_id, typ: "sick", fran: s.first_sick_day, till: s.last_sick_day, st: "sick", omf: s.extent_percent, reg: svenskKlocka(s.registered_at), bekr: s.confirmed_at ? svenskKlocka(s.confirmed_at) : null, egen: false })),
    ];
    const personer = pers.filter((p) => p.id !== mig).map((p) => fullName(p)).sort((a, b) => a.localeCompare(b, "sv"));
    ut.chef = { ko: bild.ko, kommande: bild.kommande, sjuka: bild.sjuka, rehab, team: personer.length, personer, poster: teamPoster };
  }
  return ut;
}
